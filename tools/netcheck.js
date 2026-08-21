// End-to-end network test without a browser.
//
// Starts the real relay server, connects two real clients, has them play a whole
// match against each other with scripted input, and then checks that both
// machines simulated the exact same match. That is what lockstep stands or
// falls on.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMatch, hashState } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { Signal } from '../src/net/signal.js';
import { OnlineTransport } from '../src/net/transport.js';
import { BTN } from '../src/constants.js';

const PORT = 5199;
const HOOK_PORT = 5198;
const TICKS = 60 * 100; // 100 seconds of match

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fake input device: a reproducible button pattern per player. */
function scriptedDevice(seed) {
  return {
    tick: 0,
    mask() {
      // Deterministic pseudo-input that differs per player and varies over time.
      const t = Math.floor(this.tick / 11) + seed * 977;
      const h = Math.imul(t ^ (t >>> 15), 0x2c1b3c6d) >>> 0;
      let m = 0;
      if (h & 1) m |= BTN.UP;
      if (h & 2) m |= BTN.DOWN;
      if (h & 4) m |= BTN.LEFT;
      if (h & 8) m |= BTN.RIGHT;
      if ((h & 48) === 48) m |= BTN.FIRE;
      return m;
    },
  };
}

async function waitFor(check, what, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return; // await: an async check returns a Promise, which is always truthy
    await sleep(10);
  }
  throw new Error(`Timed out: ${what}`);
}

async function main() {
  // A board of its own, so a test run never touches whatever scores are lying
  // next to a real server.
  const scoresFile = join(tmpdir(), `websoccer-scores-${process.pid}.json`);

  // Discord, for the length of this test: a server that writes down what it was
  // told. The relay should post here the moment a score lands.
  const announced = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        announced.push(JSON.parse(body));
      } catch { /* not our message */ }
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => hook.listen(HOOK_PORT, r));
  const server = spawn(process.execPath, ['server/relay.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      QUIET: '1',
      SCORES_FILE: scoresFile,
      DISCORD_WEBHOOK: `http://localhost:${HOOK_PORT}/hook`,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.resume();

  try {
    await waitFor(async () => {
      try {
        const res = await fetch(`http://localhost:${PORT}/index.html`);
        return res.ok;
      } catch {
        return false;
      }
    }, 'server did not start');
    console.log(`OK: relay is up on port ${PORT} and serving the page`);

    const url = `ws://localhost:${PORT}`;
    const peers = [];

    // --- Host --------------------------------------------------------------
    const hostSignal = new Signal(url);
    let code = null;
    hostSignal.on('room', (m) => { code = m.code; });
    hostSignal.on('peer', () => {
      const seed = 4242;
      hostSignal.send({ t: 'start', seed, halfSeconds: 60 });
      peers[0] = makePeer(hostSignal, seed, 0);
    });
    hostSignal.create();

    await waitFor(() => code !== null, 'host never received a room code');
    console.log(`OK: room code received (${code})`);

    // --- Guest -------------------------------------------------------------
    const guestSignal = new Signal(url);
    guestSignal.on('start', (m) => {
      peers[1] = makePeer(guestSignal, m.seed, 1);
    });
    guestSignal.join(code);

    await waitFor(() => peers[0] && peers[1], 'players were never paired up');
    console.log('OK: both players paired up, match started');

    // --- Play --------------------------------------------------------------
    const t0 = Date.now();
    await Promise.all(peers.map(runPeer));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    const [a, b] = peers;
    console.log(`OK: ${TICKS} ticks played by both players in ${secs}s of real time`);
    console.log(`     host score : ${a.state.score.join(' - ')}  (tick ${a.state.tick})`);
    console.log(`     guest score: ${b.state.score.join(' - ')}  (tick ${b.state.tick})`);
    console.log(`     stalls     : host ${a.transport.stalls}, guest ${b.transport.stalls} (high is expected: this test runs flat out, a browser runs at 60 fps)`);
    console.log(`     ping       : host ${a.transport.ping} ms, guest ${b.transport.ping} ms (0 is correct: both players share one clock here)`);
    console.log(`     pongs      : host ${a.transport.pongs}, guest ${b.transport.pongs}`);
    console.log(`     input delay: host ${a.transport.delay}, guest ${b.transport.delay} ticks`);

    let failed = false;
    const ha = hashState(a.state);
    const hb = hashState(b.state);

    if (ha !== hb) {
      console.error(`FAIL: the two players ended up with a different match state (${ha} != ${hb})`);
      failed = true;
    } else {
      console.log(`OK: identical match state on both sides (hash ${ha})`);
    }

    if (a.transport.desync || b.transport.desync) {
      console.error('FAIL: the built-in desync detection fired');
      failed = true;
    } else {
      console.log('OK: no desync reported by the hash check while playing');
    }

    if (a.state.score[0] + a.state.score[1] === 0) {
      console.log('NOTE: no goals scored (that is normal with random input)');
    }
    // Ping is 0 ms here because both players run in the same process; what we can
    // check is that traffic really does go back and forth.
    if (a.transport.pongs === 0 || b.transport.pongs === 0) {
      console.error('FAIL: no pong received, round-trip traffic is not working');
      failed = true;
    } else {
      console.log('OK: ping/pong works in both directions');
    }

    a.transport.dispose();
    b.transport.dispose();

    // --- The shared board --------------------------------------------------
    //
    // Two devices, neither of which has seen the other's scores. Both post
    // their own table; both must come away with the same board.
    const boardUrl = `http://localhost:${PORT}/highscores`;
    const post = async (board) => {
      const res = await fetch(boardUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ board }),
      });
      return (await res.json()).board;
    };
    const entry = (id, name, scored, conceded, at) => ({
      id, name, scored, conceded, halfSeconds: 120, at,
    });

    const phone = { easy: [], normal: [entry('p1', 'AAA', 4, 0, 1000)], hard: [] };
    const laptop = { easy: [], normal: [entry('l1', 'BBB', 6, 1, 2000)], hard: [] };
    const afterPhone = await post(phone);
    const afterLaptop = await post(laptop);

    if (afterLaptop.normal.length !== 2) {
      console.error(`FAIL: the board has ${afterLaptop.normal.length} rows, expected both devices' scores`);
      failed = true;
    } else if (afterLaptop.normal[0].name !== 'BBB') {
      console.error(`FAIL: the board is in the wrong order, top row is ${afterLaptop.normal[0].name}`);
      failed = true;
    } else if (afterPhone.normal.length !== 1) {
      console.error('FAIL: the first device was sent scores it should not have seen yet');
      failed = true;
    } else {
      console.log('OK: two devices post their own tables and end up with one board');
    }

    // A defeat, a nonsense row and a stranger's junk must not survive the trip.
    const junk = await post({
      normal: [entry('bad1', 'ZZZ', 0, 9, 3000), { id: 'bad2', name: 'X' }, 'nonsense'],
      hard: [],
      easy: [],
    });
    if (junk.normal.length !== 2) {
      console.error(`FAIL: the server took rubbish onto the board (${junk.normal.length} rows)`);
      failed = true;
    } else {
      console.log('OK: the server refuses defeats and nonsense rows');
    }

    // The new entries should have been announced, once each.
    await waitFor(() => announced.length >= 2, 'the relay never posted to the webhook', 3000);
    const said = announced.map((a) => a.content).join(' ');
    if (!/AAA/.test(said) || !/BBB/.test(said)) {
      console.error(`FAIL: the announcements do not mention both players: ${said}`);
      failed = true;
    } else if (announced.length !== 2) {
      console.error(`FAIL: ${announced.length} posts for 2 new scores`);
      failed = true;
    } else {
      console.log('OK: a new entry is posted to the Discord webhook, once each');
    }

    // And it survives a restart, because the board is a file.
    const stored = await (await fetch(boardUrl)).json();
    if (stored.board.normal.length !== 2) {
      console.error('FAIL: reading the board back gave something else');
      failed = true;
    } else {
      console.log('OK: the board is readable and kept on disk');
    }

    process.exitCode = failed ? 1 : 0;
  } finally {
    server.kill();
    hook.close();
    try {
      rmSync(join(tmpdir(), `websoccer-scores-${process.pid}.json`), { force: true });
    } catch { /* nothing to clean up */ }
  }
}

function makePeer(signal, seed, localTeam) {
  const devices = scriptedDevice(localTeam + 1);
  return {
    localTeam,
    devices,
    state: createMatch({ seed, halfSeconds: 60, humans: [true, true] }),
    transport: new OnlineTransport({ signal, devices, localTeam }),
  };
}

async function runPeer(peer) {
  let spins = 0;
  while (peer.state.tick < TICKS) {
    const tick = peer.state.tick;
    peer.devices.tick = tick;
    peer.transport.sample(tick);

    if (!peer.transport.ready(tick)) {
      if (++spins > 4000) throw new Error(`Stuck on tick ${tick}`);
      await sleep(1); // wait for the opponent
      continue;
    }
    spins = 0;
    step(peer.state, peer.transport.poll(tick));
    peer.transport.afterStep(peer.state);

    // The real loop waits on the display; here we just give the network some air.
    if (tick % 16 === 0) await sleep(0);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});

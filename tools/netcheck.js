// End-to-end netwerktest zonder browser.
//
// Start de echte relay-server, verbindt twee echte clients, laat ze een hele
// wedstrijd tegen elkaar spelen met gescripte input, en controleert daarna of
// beide machines exact dezelfde wedstrijd hebben gesimuleerd. Dat is precies
// waar lockstep op staat of valt.

import { spawn } from 'node:child_process';
import { createMatch, hashState } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { Signal } from '../src/net/signal.js';
import { OnlineTransport } from '../src/net/transport.js';
import { BTN } from '../src/constants.js';

const PORT = 5199;
const TICKS = 60 * 100; // 100 seconden wedstrijd

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nep-invoerapparaat: een reproduceerbaar knoppenpatroon per speler. */
function scriptedDevice(seed) {
  return {
    tick: 0,
    mask() {
      // Deterministische pseudo-input die per speler verschilt en varieert.
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
    if (await check()) return; // await: een async check geeft een Promise, en die is altijd truthy
    await sleep(10);
  }
  throw new Error(`Time-out bij: ${what}`);
}

async function main() {
  const server = spawn(process.execPath, ['server/relay.js'], {
    env: { ...process.env, PORT: String(PORT), QUIET: '1' },
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
    }, 'server start niet');
    console.log(`OK: relay draait op poort ${PORT} en serveert de pagina`);

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

    await waitFor(() => code !== null, 'host krijgt geen kamercode');
    console.log(`OK: kamercode ontvangen (${code})`);

    // --- Gast --------------------------------------------------------------
    const guestSignal = new Signal(url);
    guestSignal.on('start', (m) => {
      peers[1] = makePeer(guestSignal, m.seed, 1);
    });
    guestSignal.join(code);

    await waitFor(() => peers[0] && peers[1], 'spelers zijn niet gekoppeld');
    console.log('OK: beide spelers gekoppeld, wedstrijd gestart');

    // --- Spelen ------------------------------------------------------------
    const t0 = Date.now();
    await Promise.all(peers.map(runPeer));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    const [a, b] = peers;
    console.log(`OK: ${TICKS} ticks gespeeld door beide spelers in ${secs}s echte tijd`);
    console.log(`     stand host : ${a.state.score.join(' - ')}  (tick ${a.state.tick})`);
    console.log(`     stand gast : ${b.state.score.join(' - ')}  (tick ${b.state.tick})`);
    console.log(`     wachtbeurten: host ${a.transport.stalls}, gast ${b.transport.stalls} (hoog is normaal: deze test rent zo hard als hij kan, een browser loopt op 60 fps)`);
    console.log(`     ping        : host ${a.transport.ping} ms, gast ${b.transport.ping} ms (0 klopt: beide spelers delen hier één klok)`);
    console.log(`     pong-antwoorden: host ${a.transport.pongs}, gast ${b.transport.pongs}`);
    console.log(`     input-delay : host ${a.transport.delay}, gast ${b.transport.delay} ticks`);

    let failed = false;
    const ha = hashState(a.state);
    const hb = hashState(b.state);

    if (ha !== hb) {
      console.error(`FAIL: de twee spelers hebben een andere wedstrijdstand (${ha} != ${hb})`);
      failed = true;
    } else {
      console.log(`OK: identieke wedstrijdstand aan beide kanten (hash ${ha})`);
    }

    if (a.transport.desync || b.transport.desync) {
      console.error('FAIL: de ingebouwde desync-detectie sloeg aan');
      failed = true;
    } else {
      console.log('OK: geen desync gemeld door de hash-controle tijdens het spelen');
    }

    if (a.state.score[0] + a.state.score[1] === 0) {
      console.log('LET OP: geen doelpunten gevallen (met willekeurige input is dat normaal)');
    }
    // Ping is hier 0 ms omdat beide spelers in hetzelfde proces draaien; wat we
    // wel kunnen controleren is dat het verkeer echt heen én weer gaat.
    if (a.transport.pongs === 0 || b.transport.pongs === 0) {
      console.error('FAIL: geen pong ontvangen, heen-en-weerverkeer werkt niet');
      failed = true;
    } else {
      console.log('OK: ping/pong loopt in beide richtingen');
    }

    a.transport.dispose();
    b.transport.dispose();
    process.exitCode = failed ? 1 : 0;
  } finally {
    server.kill();
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
      if (++spins > 4000) throw new Error(`Vastgelopen op tick ${tick}`);
      await sleep(1); // wachten op de tegenstander
      continue;
    }
    spins = 0;
    step(peer.state, peer.transport.poll(tick));
    peer.transport.afterStep(peer.state);

    // De echte loop wacht op het beeldscherm; hier geven we het netwerk lucht.
    if (tick % 16 === 0) await sleep(0);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});

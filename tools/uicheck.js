// Smoke test for the browser side, without a browser.
//
// Runs src/main.js against a fake DOM and uses it to play a real online match
// against a second player in the same process, through the real relay. Catches
// exactly the failures the other tests cannot see: menu buttons that were never
// wired up, a renderer that trips over something missing, or an online flow that
// never starts a match.

import { spawn } from 'node:child_process';
import { createMatch } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { Signal } from '../src/net/signal.js';
import { OnlineTransport } from '../src/net/transport.js';
import { TRACK, noteFreq } from '../src/audio.js';
import { TouchControls } from '../src/touch.js';
import { BTN } from '../src/constants.js';

const PORT = 5196;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Fake DOM ---------------------------------------------------------------

const listeners = new Map();
const addListener = (ev, fn) => {
  if (!listeners.has(ev)) listeners.set(ev, []);
  listeners.get(ev).push(fn);
};

// Every canvas command is an empty function; we only count them.
let canvasCalls = 0;
const ctx = new Proxy({}, {
  get(_, prop) {
    if (prop === 'measureText') return () => ({ width: 40 });
    if (prop === 'canvas') return { width: 900, height: 620 };
    return () => { canvasCalls++; };
  },
  set: () => true,
});

function makeEl(id = '', tag = 'div') {
  const classes = new Set();
  const el = {
    id,
    tagName: tag,
    width: 900,
    height: 620,
    value: '120',
    textContent: '',
    disabled: false,
    selected: false,
    className: '',
    dataset: {},
    children: [],
    handlers: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c),
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(ev, fn) {
      (this.handlers[ev] ||= []).push(fn);
      const key = `${id}:${ev}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    getContext: () => ctx,
    focus: () => {},
    querySelectorAll: () => [],
  };
  // Assigning innerHTML = '' is how the real code clears a table body.
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(v) {
      html = v;
      if (v === '') el.children.length = 0;
    },
  });
  return el;
}

const els = new Map();
const el = (id) => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};

const modeButtons = ['1', '2', 'online'].map((m) => {
  const b = makeEl(`mode-${m}`);
  b.dataset.mode = m;
  return b;
});

const presetSelects = ['0', '1'].map((slot) => {
  const b = makeEl(`preset-${slot}`, 'select');
  b.dataset.preset = slot;
  return b;
});

// Just enough localStorage for the bindings to be saved and read back.
const store = new Map();
Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  configurable: true,
});

global.document = {
  createElement: (tag) => makeEl('', tag),
  getElementById: el,
  querySelectorAll: (sel) => {
    if (sel === '[data-mode]') return modeButtons;
    if (sel === '[data-preset]') return presetSelects;
    return [];
  },
};
global.window = {
  addEventListener: addListener,
  removeEventListener: (ev, fn) => {
    const list = listeners.get(ev);
    if (list) listeners.set(ev, list.filter((f) => f !== fn));
  },
};

// Enough Web Audio to run the tune's scheduler and count what it plays.
let scheduledTones = 0;
const audioParam = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = (extra = {}) => ({
  connect(next) { return next; },
  gain: audioParam(),
  frequency: audioParam(),
  ...extra,
});
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = node();
  }
  createGain() { return node(); }
  createOscillator() {
    scheduledTones++;
    return node({ start() {}, stop() {}, setPeriodicWave() {}, type: 'square' });
  }
  createPeriodicWave() { return {}; }
  createBiquadFilter() { return node({ type: 'bandpass' }); }
  createBuffer(_c, frames) { return { getChannelData: () => new Float32Array(frames) }; }
  createBufferSource() { return node({ start() {}, stop() {}, buffer: null }); }
  resume() {}
  suspend() {}
}
Object.defineProperty(global, 'AudioContext', { value: FakeAudioContext, configurable: true });
Object.defineProperty(global, 'navigator', {
  value: { getGamepads: () => [null, null] },
  configurable: true,
});
Object.defineProperty(global, 'location', {
  value: { protocol: 'http:', host: `localhost:${PORT}` },
  configurable: true,
});

let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

function click(element) {
  for (const fn of listeners.get(`${element.id}:click`) || []) fn();
}

/** Every window keydown listener sees the key, exactly as in a browser. */
function press(code) {
  for (const fn of listeners.get('keydown') || []) {
    fn({ code, preventDefault: () => {}, stopPropagation: () => {} });
  }
}

/** One display frame of the fake browser. */
let clock = 0;
function pumpFrame() {
  clock += 16.7;
  const cb = rafCb;
  rafCb = null;
  if (!cb) throw new Error('main.js never asked for a requestAnimationFrame');
  cb(clock);
}

// --- Test -------------------------------------------------------------------

async function waitFor(check, what, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(10);
  }
  throw new Error(`Timed out: ${what}`);
}

async function main() {
  const server = spawn(process.execPath, ['server/relay.js'], {
    env: { ...process.env, PORT: String(PORT), QUIET: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.resume();

  let failed = false;
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://localhost:${PORT}/`)).ok;
      } catch {
        return false;
      }
    }, 'server did not start');

    await import('../src/main.js');
    const game = global.window.__game;
    if (!game) throw new Error('main.js did not expose the __game hook');

    // 1. Local match: menu -> kickoff -> render a couple of hundred frames.
    click(el('start'));
    if (!game.state) throw new Error('the KICK OFF button does not start a local match');
    for (let i = 0; i < 200; i++) pumpFrame();
    if (game.state.tick < 100) throw new Error(`the local simulation is not running (tick ${game.state.tick})`);
    console.log(`OK: local match is running (tick ${game.state.tick}, ${canvasCalls} canvas commands)`);

    click(el('quit'));
    if (game.state) throw new Error('returning to the menu does not work');

    // 1b. Rebinding a key: click the binding, press a key, see it take.
    const upRow = el('keysBody').children[0];
    const p1Up = upRow.children[1].children[0];
    if (p1Up.textContent !== 'W') throw new Error(`player 1 up should start on W, not ${p1Up.textContent}`);
    p1Up.handlers.click[0]();
    press('ArrowUp');
    const rebound = el('keysBody').children[0].children[1].children[0];
    if (rebound.textContent !== '↑') {
      throw new Error(`rebinding did not take: player 1 up shows ${rebound.textContent}`);
    }
    if (!(store.get('websoccer.bindings') || '').includes('ArrowUp')) {
      throw new Error('the new binding was not saved');
    }
    console.log('OK: a key can be rebound, and it is remembered');

    // 1c. The tune. Cannot be listened to from here, so check what can be
    // checked: that the notes are sane and that the sequencer really schedules.
    if (noteFreq('A4') !== 440) throw new Error(`A4 should be 440 Hz, got ${noteFreq('A4')}`);
    if (TRACK.steps !== 128) throw new Error(`expected 8 bars of 16 steps, got ${TRACK.steps}`);
    const voiced = [...TRACK.lead, ...TRACK.arp, ...TRACK.bass].filter(Boolean);
    for (const n of voiced) {
      if (!Number.isFinite(n.freq) || n.freq < 30 || n.freq > 4000) {
        throw new Error(`a note landed outside the audible range: ${n.freq} Hz`);
      }
      if (!(n.dur > 0)) throw new Error('a note has no length');
    }
    const beforeTones = scheduledTones;
    const tune = new (await import('../src/audio.js')).Chiptune();
    tune.start();
    tune.ctx.currentTime = TRACK.step * TRACK.steps; // one full loop
    tune.schedule();
    tune.stop();
    const played = scheduledTones - beforeTones;
    if (played < TRACK.steps) throw new Error(`the sequencer only scheduled ${played} voices in a full loop`);
    console.log(`OK: title tune sequences (${voiced.length} notes per loop, ${played} voices scheduled)`);

    // 1d. The on-screen controls: a thumb on the stick has to come out as the
    // same bitmask a keyboard would produce.
    const pad = () => {
      const el = makeEl('', 'div');
      el.style = {};
      el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 130, height: 130 });
      el.setPointerCapture = () => {};
      return el;
    };
    const stick = pad();
    const knob = pad();
    const kick = pad();
    const swap = pad();
    const controls = new TouchControls();
    controls.attach({ root: pad(), stick, knob, kick, swap });

    const point = (el, ev, x, y) => {
      for (const fn of el.handlers[ev] || []) {
        fn({ pointerId: 1, clientX: x, clientY: y, preventDefault: () => {} });
      }
    };
    // Centre of the stick is (165, 165); push the thumb straight up.
    point(stick, 'pointerdown', 165, 105);
    if (!(controls.mask & BTN.UP) || (controls.mask & BTN.DOWN)) {
      throw new Error(`pushing the stick up gave mask ${controls.mask}`);
    }
    point(stick, 'pointermove', 225, 165); // now straight right
    if (!(controls.mask & BTN.RIGHT) || (controls.mask & BTN.UP)) {
      throw new Error(`pushing the stick right gave mask ${controls.mask}`);
    }
    point(stick, 'pointerup', 225, 165);
    if (controls.mask !== 0) throw new Error(`letting go left mask ${controls.mask}`);
    point(kick, 'pointerdown', 0, 0);
    if (!(controls.mask & BTN.FIRE)) throw new Error('the kick button does not press');
    point(kick, 'pointerup', 0, 0);
    point(swap, 'pointerdown', 0, 0);
    if (!(controls.mask & BTN.SWITCH)) throw new Error('the switch button does not press');
    console.log('OK: on-screen stick and buttons produce the same input as the keyboard');

    // 2. Online: pick the mode and open a match.
    click(modeButtons[2]);
    click(el('host'));

    await waitFor(() => el('roomCode').textContent.length === 4, 'no room code on screen');
    const code = el('roomCode').textContent;
    console.log(`OK: online match opened, code ${code} is on screen`);

    // 3. Let an opponent join (same client code, no fake DOM).
    const opponent = await joinAs(code);
    await waitFor(() => game.state !== null, 'the host does not start the match when the opponent joins');
    console.log('OK: match started as soon as the opponent joined');

    if (game.transport.localTeam !== 0) throw new Error('the host should be team 0 (blue)');
    if (opponent.transport.localTeam !== 1) throw new Error('the guest should be team 1 (red)');

    // 4. Let both play: the fake browser at 60 fps, the opponent at its own pace.
    const TARGET = 700;
    const opponentLoop = runOpponent(opponent, TARGET);
    for (let i = 0; i < 1400 && game.state.tick < TARGET; i++) {
      pumpFrame();
      if (i % 4 === 0) await sleep(0); // give the network some air
    }
    await opponentLoop;

    console.log(`OK: ${game.state.tick} ticks in the fake browser, ${opponent.state.tick} at the opponent`);
    console.log(`     ping ${game.transport.ping} ms, delay ${game.transport.delay} ticks, stalls ${game.transport.stalls}`);

    if (game.state.tick < TARGET * 0.8) {
      console.error(`FAIL: the online match is not progressing (tick ${game.state.tick})`);
      failed = true;
    }
    if (game.transport.desync || opponent.transport.desync) {
      console.error('FAIL: desync between the two players');
      failed = true;
    } else {
      console.log('OK: both players compute the same match');
    }
    if (el('netend').classList.contains('hidden') === false) {
      console.error('FAIL: the error overlay (connection lost / desync) is on screen');
      failed = true;
    }
    if (el('menu').classList.contains('hidden') !== true) {
      console.error('FAIL: the menu is still on screen during the match');
      failed = true;
    }

    // 5. Opponent leaves -> the error overlay should appear.
    opponent.transport.dispose();
    await waitFor(() => {
      pumpFrame();
      return !el('netend').classList.contains('hidden');
    }, 'the error overlay does not appear when the opponent leaves', 4000);
    console.log('OK: "opponent gone" is handled cleanly');
  } finally {
    server.kill();
  }

  process.exitCode = failed ? 1 : 0;
}

async function joinAs(code) {
  const signal = new Signal(`ws://localhost:${PORT}`);
  const peer = { state: null, transport: null, devices: { mask: () => 0 } };
  signal.on('start', (m) => {
    peer.state = createMatch({ seed: m.seed, halfSeconds: m.halfSeconds, humans: [true, true] });
    peer.transport = new OnlineTransport({ signal, devices: peer.devices, localTeam: 1 });
  });
  signal.join(code);
  await waitFor(() => peer.state !== null, 'the opponent never got a kickoff');
  return peer;
}

async function runOpponent(peer, target) {
  while (peer.state.tick < target) {
    const tick = peer.state.tick;
    peer.transport.sample(tick);
    if (!peer.transport.ready(tick)) {
      await sleep(1);
      continue;
    }
    step(peer.state, peer.transport.poll(tick));
    peer.transport.afterStep(peer.state);
    if (tick % 16 === 0) await sleep(0);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});

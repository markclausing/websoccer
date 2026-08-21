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
import { AudioEngine, Chiptune, Sfx, TRACK, noteFreq } from '../src/audio.js';
import { Speech } from '../src/speech.js';
import * as commentary from '../src/commentary.js';
import { TouchControls } from '../src/touch.js';
import { BTN } from '../src/constants.js';
import { lineupFrom, shapeOf } from '../src/game/formations.js';
import { KEY as SCORES_KEY } from '../src/highscores.js';

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
    style: {},
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
    // The line-up editor drags players around on a canvas.
    getBoundingClientRect: () => ({ left: 0, top: 0, width: el.width, height: el.height }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
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
let scheduledNodes = 0;
const audioParam = () => ({
  value: 0,
  setValueAtTime() {},
  exponentialRampToValueAtTime() {},
  cancelScheduledValues() {},
  linearRampToValueAtTime() {},
  // The commentator slides its filters around with this one.
  setTargetAtTime() {},
});
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
  createGain() { scheduledNodes++; return node({ gain: audioParam() }); }
  createOscillator() {
    scheduledTones++;
    scheduledNodes++;
    return node({ start() {}, stop() {}, setPeriodicWave() {}, type: 'square' });
  }
  createPeriodicWave() { return {}; }
  createBiquadFilter() {
    scheduledNodes++;
    return node({ type: 'bandpass', Q: audioParam(), frequency: audioParam() });
  }
  createBuffer(_c, frames) { return { getChannelData: () => new Float32Array(frames) }; }
  createBufferSource() { scheduledNodes++; return node({ start() {}, stop() {}, buffer: null, loop: false }); }
  resume() {}
  suspend() {}
}
Object.defineProperty(global, 'AudioContext', { value: FakeAudioContext, configurable: true });
Object.defineProperty(global, 'navigator', {
  value: { getGamepads: () => [null, null] },
  configurable: true,
});
Object.defineProperty(global, 'location', {
  // hostname as well as host: a real page has both, and config.js uses it to
  // decide whether this page is being served locally.
  //
  // The relay is pinned in the query string as well, and that is not belt and
  // braces: with DEFAULT_RELAY filled in and a stub location missing one field,
  // this suite posted its test scores to the live board three times before
  // anyone noticed. A test must not be able to reach the internet by accident.
  value: {
    protocol: 'http:',
    host: `localhost:${PORT}`,
    hostname: 'localhost',
    search: `?relay=ws://localhost:${PORT}`,
  },
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

/** A typed character, which is what the name picker listens for. */
function type(key) {
  for (const fn of listeners.get('keydown') || []) {
    fn({ key, code: `Key${key}`, preventDefault: () => {}, stopPropagation: () => {} });
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

    // A line-up saved from an earlier session, so the menu has to read it back
    // and the match has to be played with it.
    store.set('websoccer.lineup.0', JSON.stringify({
      key: '442diamond',
      spots: lineupFrom('442diamond').map(({ x, y }) => ({ x, y })),
    }));

    await import('../src/main.js');
    const game = global.window.__game;
    if (!game) throw new Error('main.js did not expose the __game hook');

    // 1. Local match: menu -> kickoff -> render a couple of hundred frames.
    click(el('start'));
    if (!game.state) throw new Error('the KICK OFF button does not start a local match');
    for (let i = 0; i < 200; i++) pumpFrame();
    if (game.state.tick < 100) throw new Error(`the local simulation is not running (tick ${game.state.tick})`);
    console.log(`OK: local match is running (tick ${game.state.tick}, ${canvasCalls} canvas commands)`);

    const localShape = shapeOf(game.state.teams[0].formation);
    if (localShape !== shapeOf(lineupFrom('442diamond'))) {
      throw new Error(`the saved line-up was ignored: team 0 is playing ${localShape}`);
    }
    console.log(`OK: the line-up saved last time is the one that takes the field (${localShape})`);

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
    const engine = new AudioEngine();
    const tune = new Chiptune(engine);
    tune.start();
    tune.ctx.currentTime = TRACK.step * TRACK.steps; // one full loop
    tune.schedule();
    tune.stop();
    const played = scheduledTones - beforeTones;
    if (played < TRACK.steps) throw new Error(`the sequencer only scheduled ${played} voices in a full loop`);
    console.log(`OK: title tune sequences (${voiced.length} notes per loop, ${played} voices scheduled)`);

    // 1e. The match sounds. Again unlistenable from here, so check that each
    // event actually reaches the synthesiser and builds something.
    const effects = new Sfx(engine);
    const counted = (fn) => {
      const before = scheduledNodes;
      fn();
      return scheduledNodes - before;
    };
    // The clock has to move between whistles: one refuses to start within a
    // second of the last, which is what keeps the final whistle to three blasts.
    const later = () => { engine.ctx.currentTime += 2; };
    const built = {
      whistle: counted(() => effects.whistle('start')),
      repeat: counted(() => effects.whistle('start')), // too soon, must be silent
      fullTime: (later(), counted(() => effects.whistle('end'))),
      kick: counted(() => effects.kick(900)),
      slide: counted(() => effects.slide()),
      cheer: counted(() => effects.cheer()),
    };
    if (built.repeat !== 0) {
      throw new Error(`a whistle inside a second of the last one still sounded (${built.repeat} nodes)`);
    }
    delete built.repeat;
    for (const [name, nodes] of Object.entries(built)) {
      if (nodes < 1) throw new Error(`the ${name} sound built nothing`);
    }
    if (built.fullTime <= built.whistle) {
      throw new Error('the full time whistle should be more than a single blast');
    }
    // Driven from the events the simulation reports, not from the UI.
    const viaEvents = counted(() => effects.play([
      { type: 'kick', power: 800 }, { type: 'kick', power: 800 }, { type: 'slide' },
    ]));
    if (viaEvents < 2) throw new Error('events did not reach the synthesiser');
    console.log(`OK: match sounds build (whistle ${built.whistle}, kick ${built.kick}, slide ${built.slide}, crowd ${built.cheer} nodes)`);

    // The commentator. Speech is formant synthesis, so a line is a handful of
    // filter moves rather than a sample: what can be checked here is that it
    // builds something, that it keeps quiet when it should, and that the gap
    // between lines holds.
    const talker = new Sfx(engine, new Speech(engine, commentary));
    talker.talking = true;
    engine.ctx.currentTime += 30;
    const spoken = counted(() => talker.commentary('save'));
    const tooSoon = counted(() => talker.commentary('run'));
    engine.ctx.currentTime += 10;
    const later2 = counted(() => talker.commentary('run'));
    if (spoken < 3) throw new Error(`a line of commentary built ${spoken} nodes`);
    if (tooSoon !== 0) throw new Error('two lines of commentary ran into each other');
    if (later2 < 3) throw new Error('the commentator went quiet after the gap had passed');
    // A goal is the one thing that never waits its turn.
    const overGoal = counted(() => talker.commentary('goal'));
    if (overGoal < 3) throw new Error('a goal did not get a word');
    talker.talking = false;
    if (counted(() => talker.commentary('goal')) !== 0) {
      throw new Error('commentary still speaks when it is switched off');
    }
    console.log(`OK: the commentator speaks (${spoken} filter moves a line), waits ${6}s between lines, and can be switched off`);

    // What he actually says, driven by the events the simulation reports. The
    // wording is the point here, so the voice is replaced by a notebook.
    const heard = [];
    const scribe = new Sfx(engine, {
      say: (event) => { heard.push(`<${event}>`); return 5; },
      line: (text) => { heard.push(text); return 5; },
    });
    scribe.talking = true;
    const hear = (events) => {
      heard.length = 0;
      engine.ctx.currentTime += 30; // past the gap between lines
      scribe.play(events);
      return heard.join(' | ');
    };

    const saidStart = hear([{ type: 'kickoff', reason: 'start', score: [0, 0] }]);
    const saidThrow = hear([{ type: 'restart', kind: 'THROW-IN', team: 1 }]);
    const saidKick = hear([{ type: 'restart', kind: 'GOAL KICK', team: 0 }]);
    const saidScore = hear([{ type: 'kickoff', reason: 'goal', score: [2, 0] }]);
    const saidEnd = hear([{ type: 'fulltime', score: [3, 1] }]);
    const saidHalf = hear([{ type: 'kickoff', reason: 'half', score: [1, 1] }]);

    const expected = {
      'the match start': [saidStart, '<start>'],
      'a throw-in to red': [saidThrow, 'throw in for red'],
      'a goal kick to blue': [saidKick, 'goal kick for blue'],
      'the score after a goal': [saidScore, 'blue two red nil'],
      'full time': [saidEnd, 'full time blue three red one'],
      'half time': [saidHalf, ''],
    };
    for (const [what, [got, want]] of Object.entries(expected)) {
      if (got !== want) throw new Error(`${what}: said "${got}", expected "${want}"`);
    }
    // Two goals caught in one frame must not talk over themselves, but the
    // scoreline that follows a goal is never held back.
    const back2back = hear([
      { type: 'restart', kind: 'CORNER', team: 0 },
      { type: 'kickoff', reason: 'goal', score: [4, 4] },
    ]);
    if (back2back !== 'corner for blue | blue four red four') {
      throw new Error(`a scoreline was held back behind a restart: "${back2back}"`);
    }
    console.log('OK: he names the side at a restart, reads the score after a goal, and says nil');

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

    // 1c. Win a match and the three letter picker should appear, take the name
    //     from the keyboard, and put the result on the board.
    if (!game.state) click(el('start'));
    pumpFrame();
    game.state.score[0] = 5;
    game.state.score[1] = 1;
    game.state.phase = 'fulltime';
    pumpFrame();
    if (el('hiscore').classList.contains('hidden')) {
      throw new Error('a 5-1 win did not offer a place on the high score table');
    }
    for (const letter of ['M', 'J', 'C']) type(letter);
    type('Enter');
    if (!el('hiscore').classList.contains('hidden')) {
      throw new Error('the picker stayed up after the name was confirmed');
    }
    const saved = JSON.parse(store.get(SCORES_KEY) || '{}');
    const top = saved.normal?.[0];
    if (!top || top.name !== 'MJC' || top.scored !== 5 || top.conceded !== 1) {
      throw new Error(`the result did not reach the table: ${JSON.stringify(top)}`);
    }
    if (!el('scoresBody').children.length) {
      throw new Error('the menu table is empty after a score was set');
    }
    console.log(`OK: a 5-1 win asks for three letters and lands on the board as ${top.name}`);

    // A defeat must not ask for anything.
    click(el('start'));
    game.state.score[0] = 0;
    game.state.score[1] = 4;
    game.state.phase = 'fulltime';
    pumpFrame();
    if (!el('hiscore').classList.contains('hidden')) {
      throw new Error('a 0-4 defeat was offered a place on the table');
    }
    press('Enter');
    pumpFrame();
    console.log('OK: a defeat is not a high score');

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
    const hostShapes = game.state.teams.map((t) => shapeOf(t.formation));
    const guestShapes = opponent.state.teams.map((t) => shapeOf(t.formation));
    const want = [shapeOf(lineupFrom('442diamond')), shapeOf(lineupFrom(GUEST_LINEUP))];
    if (hostShapes.join(' ') !== want.join(' ')) {
      console.error(`FAIL: the host is playing ${hostShapes.join(' vs ')}, expected ${want.join(' vs ')}`);
      failed = true;
    } else if (guestShapes.join(' ') !== want.join(' ')) {
      console.error(`FAIL: the guest is playing ${guestShapes.join(' vs ')}, expected ${want.join(' vs ')}`);
      failed = true;
    } else {
      console.log(`OK: both machines lined up ${want.join(' vs ')} - each side's own choice, agreed over the wire`);
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

const GUEST_LINEUP = '532';

async function joinAs(code) {
  const signal = new Signal(`ws://localhost:${PORT}`);
  const peer = { state: null, transport: null, devices: { mask: () => 0 } };
  signal.on('room', () => {
    signal.send({ t: 'lineup', spots: lineupFrom(GUEST_LINEUP).map(({ x, y }) => ({ x, y })) });
  });
  signal.on('start', (m) => {
    peer.state = createMatch({
      seed: m.seed, halfSeconds: m.halfSeconds, humans: [true, true], formations: m.formations,
    });
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

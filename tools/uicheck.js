// Rooktest voor de browserkant zonder browser.
//
// Draait src/main.js tegen een namaak-DOM en speelt daarmee een échte online
// wedstrijd tegen een tweede speler in hetzelfde proces, via de echte relay.
// Vangt precies de fouten die de andere tests niet zien: menuknoppen die niet
// gekoppeld zijn, een renderer die op iets ontbrekends valt, of een online-flow
// die nooit een wedstrijd start.

import { spawn } from 'node:child_process';
import { createMatch } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { Signal } from '../src/net/signal.js';
import { OnlineTransport } from '../src/net/transport.js';

const PORT = 5196;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Namaak-DOM -------------------------------------------------------------

const listeners = new Map();
const addListener = (ev, fn) => {
  if (!listeners.has(ev)) listeners.set(ev, []);
  listeners.get(ev).push(fn);
};

// Elk canvas-commando is een lege functie; we tellen ze alleen.
let canvasCalls = 0;
const ctx = new Proxy({}, {
  get(_, prop) {
    if (prop === 'measureText') return () => ({ width: 40 });
    if (prop === 'canvas') return { width: 900, height: 620 };
    return () => { canvasCalls++; };
  },
  set: () => true,
});

function makeEl(id = '') {
  const classes = new Set();
  return {
    id,
    width: 900,
    height: 620,
    value: '120',
    textContent: '',
    disabled: false,
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c),
    },
    addEventListener: (ev, fn) => {
      const key = `${id}:${ev}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    getContext: () => ctx,
    focus: () => {},
    querySelectorAll: () => [],
  };
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

global.document = {
  createElement: () => makeEl(),
  getElementById: el,
  querySelectorAll: (sel) => (sel === '[data-mode]' ? modeButtons : []),
};
global.window = { addEventListener: addListener };
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

/** Eén beeldframe van de namaakbrowser. */
let clock = 0;
function pumpFrame() {
  clock += 16.7;
  const cb = rafCb;
  rafCb = null;
  if (!cb) throw new Error('main.js heeft geen requestAnimationFrame gevraagd');
  cb(clock);
}

// --- Test -------------------------------------------------------------------

async function waitFor(check, what, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
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

  let failed = false;
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://localhost:${PORT}/`)).ok;
      } catch {
        return false;
      }
    }, 'server start niet');

    await import('../src/main.js');
    const game = global.window.__game;
    if (!game) throw new Error('main.js heeft geen __game-haakje gezet');

    // 1. Lokale wedstrijd: menu -> aftrap -> een paar honderd frames renderen.
    click(el('start'));
    if (!game.state) throw new Error('lokale wedstrijd start niet via de AFTRAP-knop');
    for (let i = 0; i < 200; i++) pumpFrame();
    if (game.state.tick < 100) throw new Error(`lokale simulatie loopt niet (tick ${game.state.tick})`);
    console.log(`OK: lokale wedstrijd draait (tick ${game.state.tick}, ${canvasCalls} canvas-commando's)`);

    click(el('quit'));
    if (game.state) throw new Error('terug naar menu werkt niet');

    // 2. Online: modus kiezen en een wedstrijd openen.
    click(modeButtons[2]);
    click(el('host'));

    await waitFor(() => el('roomCode').textContent.length === 4, 'geen kamercode in beeld');
    const code = el('roomCode').textContent;
    console.log(`OK: online wedstrijd geopend, code ${code} staat in beeld`);

    // 3. Tegenstander laten binnenkomen (dezelfde clientcode, geen namaak-DOM).
    const opponent = await joinAs(code);
    await waitFor(() => game.state !== null, 'de host start de wedstrijd niet als de tegenstander binnenkomt');
    console.log('OK: wedstrijd gestart zodra de tegenstander binnenkwam');

    if (game.transport.localTeam !== 0) throw new Error('de host hoort team 0 (blauw) te zijn');
    if (opponent.transport.localTeam !== 1) throw new Error('de gast hoort team 1 (rood) te zijn');

    // 4. Allebei laten spelen: de namaakbrowser op 60 fps, de tegenstander op eigen tempo.
    const TARGET = 700;
    const opponentLoop = runOpponent(opponent, TARGET);
    for (let i = 0; i < 1400 && game.state.tick < TARGET; i++) {
      pumpFrame();
      if (i % 4 === 0) await sleep(0); // het netwerk lucht geven
    }
    await opponentLoop;

    console.log(`OK: ${game.state.tick} ticks in de namaakbrowser, ${opponent.state.tick} bij de tegenstander`);
    console.log(`     ping ${game.transport.ping} ms, delay ${game.transport.delay} ticks, wachtbeurten ${game.transport.stalls}`);

    if (game.state.tick < TARGET * 0.8) {
      console.error(`FAIL: de online wedstrijd komt niet vooruit (tick ${game.state.tick})`);
      failed = true;
    }
    if (game.transport.desync || opponent.transport.desync) {
      console.error('FAIL: desync tussen de twee spelers');
      failed = true;
    } else {
      console.log('OK: beide spelers berekenen dezelfde wedstrijd');
    }
    if (el('netend').classList.contains('hidden') === false) {
      console.error('FAIL: het foutscherm (verbinding weg / desync) staat in beeld');
      failed = true;
    }
    if (el('menu').classList.contains('hidden') !== true) {
      console.error('FAIL: het menu staat nog in beeld tijdens de wedstrijd');
      failed = true;
    }

    // 5. Tegenstander weg -> foutscherm hoort te verschijnen.
    opponent.transport.dispose();
    await waitFor(() => {
      pumpFrame();
      return !el('netend').classList.contains('hidden');
    }, 'foutscherm verschijnt niet als de tegenstander weggaat', 4000);
    console.log('OK: "tegenstander weg" wordt netjes afgevangen');
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
  await waitFor(() => peer.state !== null, 'de tegenstander krijgt geen aftrap');
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

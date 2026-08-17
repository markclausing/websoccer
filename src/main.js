import { FRAME_TIME } from './constants.js';
import {
  ACTIONS, ACTION_LABELS, InputDevices, PRESETS, findConflicts, keyLabel, loadBindings, saveBindings,
} from './input.js';
import { createMatch } from './game/state.js';
import { step } from './game/sim.js';
import { Renderer } from './render/renderer.js';
import { LocalTransport, OnlineTransport } from './net/transport.js';
import { Signal } from './net/signal.js';
import { Chiptune } from './audio.js';
import { TouchControls, isTouchDevice } from './touch.js';

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const pauseBox = document.getElementById('pause');
const netendBox = document.getElementById('netend');
const localSetup = document.getElementById('localSetup');
const onlineSetup = document.getElementById('onlineSetup');
const onlineStatus = document.getElementById('onlineStatus');
const roomCode = document.getElementById('roomCode');
const difficultyRow = document.getElementById('difficultyRow');

const music = new Chiptune();
let musicOn = globalThis.localStorage?.getItem('websoccer.music') !== 'off';

const bindings = loadBindings();
const devices = new InputDevices(bindings);
devices.attach();

const touch = new TouchControls();
const onTouchDevice = isTouchDevice();
if (onTouchDevice) {
  touch.attach({
    root: document.getElementById('touch'),
    stick: document.getElementById('stick'),
    knob: document.getElementById('knob'),
    kick: document.getElementById('btnKick'),
    swap: document.getElementById('btnSwap'),
  });
  devices.touch = touch;
  // A keyboard table is no use to a thumb; the on-screen controls replace it.
  document.getElementById('keysTable')?.classList.add('hidden');
  document.getElementById('bindHint')?.classList.add('hidden');
}

const renderer = new Renderer(canvas);

const game = {
  state: null,
  transport: null,
  signal: null,
  paused: false,
  acc: 0,
  last: performance.now(),
  ended: false,
};

// --- Starting a match -------------------------------------------------------

function beginMatch(state, transport) {
  game.state = state;
  game.transport = transport;
  game.paused = false;
  game.ended = false;
  game.acc = 0;
  game.last = performance.now();
  renderer.updateCamera(state, true);

  menu.classList.add('hidden');
  pauseBox.classList.add('hidden');
  netendBox.classList.add('hidden');
  canvas.focus();
  if (onTouchDevice) touch.show(true);
  music.stop(); // title tune only: nobody wants a loop over ninety minutes
}

function startLocal({ players, halfSeconds }) {
  const state = createMatch({
    seed: (Date.now() & 0x7fffffff) || 1,
    halfSeconds,
    humans: [true, players === 2],
    difficulty,
    offside,
  });
  beginMatch(state, new LocalTransport(devices, players === 2 ? [0, 1] : [0]));
}

function startOnline(opts) {
  const { seed, halfSeconds, localTeam, signal } = opts;
  // Both teams are "human": no CPU, and exactly the same simulation on both
  // sides. Only the seed and the team assignment come from the host.
  const state = createMatch({ seed, halfSeconds, humans: [true, true], offside: opts.offside });
  const transport = new OnlineTransport({ signal, devices, localTeam });
  beginMatch(state, transport);
}

function toMenu() {
  if (game.transport) game.transport.dispose();
  else if (game.signal) game.signal.close();
  game.state = null;
  game.transport = null;
  game.signal = null;
  menu.classList.remove('hidden');
  pauseBox.classList.add('hidden');
  netendBox.classList.add('hidden');
  touch.show(false);
  if (musicOn) music.start();
  setOnlineStatus('');
  roomCode.classList.add('hidden');
  document.getElementById('host').disabled = false;
}

// --- Game loop --------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - game.last) / 1000);
  game.last = now;

  if (!game.state) return;

  if (!game.paused) {
    game.acc += elapsed;

    let guard = 0;
    while (game.acc >= FRAME_TIME && guard < 8) {
      const tick = game.state.tick;

      // Always record and send our own input first - even when we have to wait
      // ourselves. Otherwise two waiting players would block each other.
      game.transport.sample(tick);

      if (!game.transport.ready(tick)) break;

      step(game.state, game.transport.poll(tick));
      game.transport.afterStep(game.state);
      game.acc -= FRAME_TIME;
      guard++;
    }

    // Do not let the backlog grow: after a hiccup we catch up a few ticks, but
    // we never fast-forward through ten seconds of football.
    if (guard >= 8 || game.acc > FRAME_TIME * 8) game.acc = Math.min(game.acc, FRAME_TIME * 8);
  }

  renderer.draw(game.state, netInfo());
  checkNetEnd();

  if (game.state.phase === 'fulltime' && devices.isDown('Enter') && !game.transport.online) {
    toMenu();
  }
}

function netInfo() {
  const t = game.transport;
  if (!t || !t.online) return null;
  return {
    online: true,
    ping: t.ping,
    stalling: t.stalling,
    desync: t.desync,
    peerLeft: t.peerLeft,
    team: t.localTeam,
  };
}

function checkNetEnd() {
  const t = game.transport;
  if (!t || !t.online || game.ended) return;

  const finished = game.state.phase === 'fulltime';
  if (!t.peerLeft && !t.desync && !finished) return;

  let title;
  let text;
  if (t.desync) {
    title = 'DESYNC';
    text = 'The two players computed a different match state. The match has been stopped.';
  } else if (t.peerLeft) {
    title = 'OPPONENT GONE';
    text = 'The connection to your opponent has been lost.';
  } else {
    title = 'FULL TIME';
    text = `${game.state.teams[0].name} ${game.state.score[0]} - ${game.state.score[1]} ${game.state.teams[1].name}`;
  }

  game.ended = true;
  document.getElementById('netendTitle').textContent = title;
  document.getElementById('netendText').textContent = text;
  netendBox.classList.remove('hidden');
}

// --- Controls -----------------------------------------------------------------

const keysBody = document.getElementById('keysBody');
const bindHint = document.getElementById('bindHint');
let listeningFor = null; // {slot, action} while waiting for a key to be pressed

function setBindHint(text, warn = false) {
  bindHint.textContent = text;
  bindHint.classList.toggle('warn', warn);
}

function renderBindings() {
  const clashing = new Set();
  for (const clash of findConflicts(bindings)) {
    clashing.add(`${clash.a.slot}:${clash.a.action}`);
    clashing.add(`${clash.b.slot}:${clash.b.action}`);
  }

  keysBody.innerHTML = '';
  for (const action of ACTIONS) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = ACTION_LABELS[action];
    row.appendChild(name);

    for (let slot = 0; slot < 2; slot++) {
      const cell = document.createElement('td');
      const button = document.createElement('button');
      const id = `${slot}:${action}`;
      button.className = 'bind';
      button.dataset.bind = id;
      button.textContent = listeningFor && listeningFor.slot === slot && listeningFor.action === action
        ? 'press a key'
        : keyLabel(bindings[slot][action]);
      if (listeningFor && button.textContent === 'press a key') button.classList.add('listening');
      if (clashing.has(id)) button.classList.add('clash');
      button.addEventListener('click', () => startListening(slot, action));
      cell.appendChild(button);
      row.appendChild(cell);
    }
    keysBody.appendChild(row);
  }

  for (const select of document.querySelectorAll('[data-preset]')) {
    const slot = Number(select.dataset.preset);
    const current = PRESETS.find((p) => ACTIONS.every((a) => p.bindings[a] === bindings[slot][a]));
    select.innerHTML = '';
    for (const preset of PRESETS) {
      const option = document.createElement('option');
      option.value = preset.key;
      option.textContent = preset.label;
      if (current && current.key === preset.key) option.selected = true;
      select.appendChild(option);
    }
    if (!current) {
      const option = document.createElement('option');
      option.value = 'custom';
      option.textContent = 'Custom';
      option.selected = true;
      select.appendChild(option);
    }
  }

  if (clashing.size) {
    setBindHint('Those keys overlap. Fine for one player, but two players need separate keys.', true);
  } else if (!listeningFor) {
    setBindHint('Click a key to change it.');
  }
}

function startListening(slot, action) {
  listeningFor = { slot, action };
  setBindHint('Press the key you want to use, or Escape to cancel.');
  renderBindings();
}

function applyKey(code) {
  const { slot, action } = listeningFor;
  listeningFor = null;
  bindings[slot][action] = code;
  devices.setBindings(bindings);
  devices.down.clear(); // the key we just captured never gets a keyup we care about
  saveBindings(bindings);
  renderBindings();
}

// Capture phase, and always prevented: otherwise pressing Space would activate
// the button that is still focused and immediately ask for another key.
window.addEventListener('keydown', (e) => {
  if (!listeningFor) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') {
    listeningFor = null;
    renderBindings();
    return;
  }
  applyKey(e.code);
}, true);

for (const select of document.querySelectorAll('[data-preset]')) {
  select.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.key === select.value);
    if (!preset) return;
    bindings[Number(select.dataset.preset)] = { ...preset.bindings };
    devices.setBindings(bindings);
    saveBindings(bindings);
    renderBindings();
  });
}

renderBindings();

// --- Menu -------------------------------------------------------------------

let mode = '1';
let difficulty = 'normal';
let offside = true;

document.querySelectorAll('[data-music]').forEach((btn) => {
  btn.classList.toggle('active', (btn.dataset.music === 'on') === musicOn);
  btn.addEventListener('click', () => {
    musicOn = btn.dataset.music === 'on';
    document.querySelectorAll('[data-music]').forEach((b) => b.classList.toggle('active', b === btn));
    try {
      globalThis.localStorage?.setItem('websoccer.music', musicOn ? 'on' : 'off');
    } catch { /* private mode: the setting just will not stick */ }
    music.toggle(musicOn && !game.state);
  });
});

document.querySelectorAll('[data-offside]').forEach((btn) => {
  btn.addEventListener('click', () => {
    offside = btn.dataset.offside === 'on';
    document.querySelectorAll('[data-offside]').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.querySelectorAll('[data-difficulty]').forEach((btn) => {
  btn.addEventListener('click', () => {
    difficulty = btn.dataset.difficulty;
    document.querySelectorAll('[data-difficulty]').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
    localSetup.classList.toggle('hidden', mode === 'online');
    onlineSetup.classList.toggle('hidden', mode !== 'online');
    renderBindings();
    // Only worth choosing when there is a CPU to play against.
    difficultyRow.classList.toggle('hidden', mode !== '1');

    // Switching mode releases any room we had opened.
    if (game.signal && !game.state) {
      game.signal.close();
      game.signal = null;
      roomCode.classList.add('hidden');
      setOnlineStatus('');
      document.getElementById('host').disabled = false;
    }
  });
});

document.getElementById('start').addEventListener('click', () => {
  const players = Number(mode);
  // Sharing keys is fine for one player, impossible for two.
  if (players === 2 && findConflicts(bindings).length) {
    setBindHint('Both players are using the same keys. Give them separate ones first.', true);
    return;
  }
  startLocal({ players, halfSeconds: halfSeconds() });
});

document.getElementById('resume').addEventListener('click', () => {
  game.paused = false;
  pauseBox.classList.add('hidden');
});

document.getElementById('quit').addEventListener('click', toMenu);
document.getElementById('netendQuit').addEventListener('click', toMenu);

function halfSeconds() {
  return Number(document.getElementById('duration').value);
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text;
}

/**
 * Where to find the relay. By default it is the server that served this page,
 * which is what `npm start` gives you. On a static host (GitHub Pages and the
 * like) there is no relay, so `?relay=wss://your-relay.example` lets you point
 * at one running elsewhere without rebuilding anything.
 */
function relayUrl() {
  const override = new URLSearchParams(location.search || '').get('relay');
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + location.host;
}

const NO_RELAY_HINT = 'Could not reach a relay server. This page is hosted as static files, '
  + 'so online play needs a relay running somewhere: start one with "npm start" and add '
  + '?relay=wss://your-relay to this URL. One and two player modes work without it.';

function connect() {
  // An earlier attempt (say a room nobody ever joined) must not linger.
  if (game.signal) game.signal.close();
  const signal = new Signal(relayUrl());
  game.signal = signal;
  signal.on('error', (m) => setOnlineStatus(m.transport ? NO_RELAY_HINT : (m.msg || 'Connection error')));
  signal.on('close', () => {
    if (!game.state) setOnlineStatus(NO_RELAY_HINT);
  });
  return signal;
}

// Opening a match: we are the host, so we pick the seed.
document.getElementById('host').addEventListener('click', () => {
  const secs = halfSeconds();
  const signal = connect();

  signal.on('room', (m) => {
    roomCode.textContent = m.code;
    roomCode.classList.remove('hidden');
    setOnlineStatus('Share this code and wait for your opponent...');
  });

  signal.on('peer', () => {
    const seed = (Date.now() & 0x7fffffff) || 1;
    // Goes over the wire so both sides start from identical settings.
    signal.send({ t: 'start', seed, halfSeconds: secs, offside });
    startOnline({ seed, halfSeconds: secs, localTeam: 0, signal, offside });
  });

  document.getElementById('host').disabled = true;
  signal.create();
});

// Joining: we get the seed from the host and play red.
document.getElementById('join').addEventListener('click', () => {
  const code = document.getElementById('joinCode').value.toUpperCase().trim();
  if (code.length < 4) {
    setOnlineStatus('Enter the four-character code.');
    return;
  }
  const signal = connect();

  signal.on('room', () => setOnlineStatus('Connected. Waiting for kickoff...'));
  signal.on('start', (m) => {
    startOnline({
      seed: m.seed, halfSeconds: m.halfSeconds, localTeam: 1, signal, offside: m.offside !== false,
    });
  });

  setOnlineStatus('Connecting...');
  signal.join(code);
});

document.getElementById('joinCode').addEventListener('keydown', (e) => {
  if (e.code === 'Enter') document.getElementById('join').click();
  e.stopPropagation();
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !game.state) return;
  // Pausing online is not possible: it would leave the opponent hanging.
  if (game.transport.online) return;
  game.paused = !game.paused;
  pauseBox.classList.toggle('hidden', !game.paused);
  game.acc = 0;
});

// Browsers refuse to make a sound until the visitor has interacted with the
// page, so the tune waits for the first click or key press rather than being
// started on load and silently failing.
function startMusicOnFirstGesture() {
  if (musicOn && !game.state) music.start();
  window.removeEventListener('pointerdown', startMusicOnFirstGesture);
  window.removeEventListener('keydown', startMusicOnFirstGesture);
}
window.addEventListener('pointerdown', startMusicOnFirstGesture);
window.addEventListener('keydown', startMusicOnFirstGesture);

// Handy when digging into network behaviour: from the console you can inspect
// __game.transport.ping / .delay / .stalls / .desync.
if (typeof window !== 'undefined') window.__game = game;

requestAnimationFrame(frame);

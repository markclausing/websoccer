import { DT } from './constants.js';
import { InputDevices } from './input.js';
import { createMatch } from './game/state.js';
import { step } from './game/sim.js';
import { Renderer } from './render/renderer.js';
import { LocalTransport, OnlineTransport } from './net/transport.js';
import { Signal } from './net/signal.js';

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const pauseBox = document.getElementById('pause');
const netendBox = document.getElementById('netend');
const localSetup = document.getElementById('localSetup');
const onlineSetup = document.getElementById('onlineSetup');
const onlineStatus = document.getElementById('onlineStatus');
const roomCode = document.getElementById('roomCode');

const devices = new InputDevices();
devices.attach();

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
}

function startLocal({ players, halfSeconds }) {
  const state = createMatch({
    seed: (Date.now() & 0x7fffffff) || 1,
    halfSeconds,
    humans: [true, players === 2],
  });
  beginMatch(state, new LocalTransport(devices, players === 2 ? [0, 1] : [0]));
}

function startOnline({ seed, halfSeconds, localTeam, signal }) {
  // Both teams are "human": no CPU, and exactly the same simulation on both
  // sides. Only the seed and the team assignment come from the host.
  const state = createMatch({ seed, halfSeconds, humans: [true, true] });
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
    while (game.acc >= DT && guard < 8) {
      const tick = game.state.tick;

      // Always record and send our own input first - even when we have to wait
      // ourselves. Otherwise two waiting players would block each other.
      game.transport.sample(tick);

      if (!game.transport.ready(tick)) break;

      step(game.state, game.transport.poll(tick));
      game.transport.afterStep(game.state);
      game.acc -= DT;
      guard++;
    }

    // Do not let the backlog grow: after a hiccup we catch up a few ticks, but
    // we never fast-forward through ten seconds of football.
    if (guard >= 8 || game.acc > DT * 8) game.acc = Math.min(game.acc, DT * 8);
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

// --- Menu -------------------------------------------------------------------

let mode = '1';

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
    localSetup.classList.toggle('hidden', mode === 'online');
    onlineSetup.classList.toggle('hidden', mode !== 'online');

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
  startLocal({ players: Number(mode), halfSeconds: halfSeconds() });
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

function connect() {
  // An earlier attempt (say a room nobody ever joined) must not linger.
  if (game.signal) game.signal.close();
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const signal = new Signal(proto + location.host);
  game.signal = signal;
  signal.on('error', (m) => setOnlineStatus(m.msg || 'Connection error'));
  signal.on('close', () => {
    if (!game.state) setOnlineStatus('Lost the connection to the server.');
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
    signal.send({ t: 'start', seed, halfSeconds: secs });
    startOnline({ seed, halfSeconds: secs, localTeam: 0, signal });
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
    startOnline({ seed: m.seed, halfSeconds: m.halfSeconds, localTeam: 1, signal });
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

// Handy when digging into network behaviour: from the console you can inspect
// __game.transport.ping / .delay / .stalls / .desync.
if (typeof window !== 'undefined') window.__game = game;

requestAnimationFrame(frame);

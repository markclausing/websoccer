// Runs the Cloudflare Worker's logic without Cloudflare.
//
//   node tools/workercheck.js
//
// The Durable Object is a plain class, so the only things standing between it
// and node are a socket pair, a Response and a storage bucket. All three are
// stubbed here, which means the room protocol and the shared board are checked
// on every run rather than the first time somebody deploys it.

import { Arena } from '../worker/index.js';

// --- The bits of Cloudflare this needs --------------------------------------

class FakeSocket {
  constructor(name) {
    this.name = name;
    this.sent = [];
    this.handlers = {};
  }

  accept() {}

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  addEventListener(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }

  last() {
    return this.sent[this.sent.length - 1];
  }
}

globalThis.WebSocketPair = function WebSocketPair() {
  return { 0: new FakeSocket('client'), 1: new FakeSocket('server') };
};

const realResponse = globalThis.Response;
globalThis.Response = class extends realResponse {
  constructor(body, init = {}) {
    // A 101 is exactly what a WebSocket upgrade answers with, and exactly what
    // node's Response refuses to build.
    if (init.status === 101) {
      super(null, { ...init, status: 204 });
      this.upgraded = true;
      this.webSocket = init.webSocket;
    } else {
      super(body, init);
    }
  }
};

function fakeState() {
  const store = new Map();
  return {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => store.set(k, v),
    },
    store,
  };
}

function request(method, path, body) {
  return {
    method,
    url: `https://relay.example${path}`,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// --- Checks ------------------------------------------------------------------

let failed = false;
function check(ok, message) {
  if (ok) {
    console.log(`OK: ${message}`);
  } else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

const state = fakeState();
const arena = new Arena(state);

// Two players, each with their own socket, exactly as the Worker would make them.
const host = { socket: new FakeSocket('host'), room: null, role: null };
const guest = { socket: new FakeSocket('guest'), room: null, role: null };
const stranger = { socket: new FakeSocket('stranger'), room: null, role: null };

arena.receive(host, JSON.stringify({ t: 'create' }));
const opened = host.socket.last();
check(opened?.t === 'room' && /^[A-Z2-9]{4}$/.test(opened.code || ''),
  `opening a match gives a four character code (${opened?.code})`);

arena.receive(guest, JSON.stringify({ t: 'join', code: 'ZZZZ' }));
check(guest.socket.last()?.t === 'error', 'joining a room that does not exist is refused');

arena.receive(guest, JSON.stringify({ t: 'join', code: opened.code.toLowerCase() }));
check(host.socket.last()?.t === 'peer' && guest.socket.last()?.t === 'peer',
  'both players are told the opponent has arrived, whatever case the code was typed in');

arena.receive(stranger, JSON.stringify({ t: 'join', code: opened.code }));
check(stranger.socket.last()?.t === 'error' && /full/i.test(stranger.socket.last().msg),
  'a third player cannot walk into a full room');

// Everything else is passed through untouched - that is the whole job.
const start = { t: 'start', seed: 42, halfSeconds: 120, formations: [null, null] };
arena.receive(host, JSON.stringify(start));
check(JSON.stringify(guest.socket.last()) === JSON.stringify(start),
  'the kickoff message reaches the other player unchanged');

arena.receive(guest, JSON.stringify({ t: 'input', frames: [[1, 16]] }));
check(host.socket.last()?.t === 'input', 'input travels the other way too');

arena.receive(host, 'not json at all');
check(true, 'rubbish on the wire does not bring the relay down');

arena.leave(host);
check(guest.socket.last()?.t === 'peerleft', 'the other player is told when someone leaves');
check(arena.rooms.size === 1, 'the room stays while one player is still in it');
arena.leave(guest);
check(arena.rooms.size === 0, 'an empty room is forgotten');

// --- The board ---------------------------------------------------------------

const entry = (id, name, scored, conceded, at) => ({
  id, name, scored, conceded, halfSeconds: 120, at,
});

const phone = { normal: [entry('p1', 'AAA', 4, 0, 1000)], easy: [], hard: [] };
const laptop = { normal: [entry('l1', 'BBB', 6, 1, 2000)], easy: [], hard: [] };

const first = await (await arena.scores(request('POST', '/highscores', { board: phone }))).json();
const second = await (await arena.scores(request('POST', '/highscores', { board: laptop }))).json();
check(second.board.normal.length === 2 && second.board.normal[0].name === 'BBB',
  'two devices post their own tables and the board holds both, best first');
check(first.board.normal.length === 1, 'the first device only sees what existed when it asked');

const junk = await (await arena.scores(request('POST', '/highscores', {
  board: { normal: [entry('bad', 'ZZZ', 0, 9, 3000), 'nonsense'], easy: [], hard: [] },
}))).json();
check(junk.board.normal.length === 2, 'defeats and nonsense rows are refused');

const read = await (await arena.scores(request('GET', '/highscores'))).json();
check(read.board.normal.length === 2, 'the board reads back');
check(JSON.stringify(state.store.get('board')) === JSON.stringify(read.board),
  'the board is written to durable storage, so a restart keeps it');

const again = await (await arena.scores(request('POST', '/highscores', { board: laptop }))).json();
check(again.board.normal.length === 2, 'posting the same table twice does not duplicate rows');

// A body that is not a board at all.
const huge = {
  method: 'POST',
  url: 'https://relay.example/highscores',
  headers: { get: () => null },
  text: async () => 'x'.repeat(70 * 1024),
};
check((await arena.scores(huge)).status === 413, 'an oversized body is turned away');

const upgrade = await arena.fetch({
  method: 'GET',
  url: 'https://relay.example/',
  headers: { get: (h) => (h === 'Upgrade' ? 'websocket' : null) },
});
check(upgrade.upgraded === true && !!upgrade.webSocket,
  'a websocket upgrade is answered with the other end of the pair');

console.log('');
console.log(failed ? 'WORKER SUITE FAILED' : 'WORKER SUITE PASSED');
process.exit(failed ? 1 : 0);

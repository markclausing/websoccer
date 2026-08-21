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

// Discord, as far as this test is concerned: a list of what was posted.
const posted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('discord')) {
    posted.push(JSON.parse(init.body));
    return new realResponse('{}', { status: 204 });
  }
  return realFetch(url, init);
};

const state = fakeState();
const arena = new Arena(state, {
  ADMIN_KEY: 'letmein',
  DISCORD_WEBHOOK: 'https://discord.example/api/webhooks/1/abc',
});

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

// --- Telling Discord ---------------------------------------------------------

check(posted.length === 2, `a post per result that landed (${posted.length})`);
const embed = posted[1]?.embeds?.[0];
check(/BBB/.test(embed?.description || '') && /6-1/.test(embed.description)
  && /top of the table/.test(embed.description),
  `the message says who, what and where: ${JSON.stringify(embed?.description)}`);
check(posted[1]?.username === 'WebSoccer' && /WebSoccer/.test(embed?.title || ''),
  'the post says which game it came from');
check(/^https?:\/\/\S+$/.test(embed?.url || '') && /Play at/.test(embed?.footer?.text || ''),
  `the title links to the game (${embed?.url})`);
check(posted.every((p) => p.allowed_mentions?.parse?.length === 0),
  'the post cannot ping anybody');

const quiet = posted.length;
await arena.scores(request('POST', '/highscores', { board: laptop }));
check(posted.length === quiet, 'the same result arriving again is not announced');

await arena.scores(request('POST', '/highscores', {
  board: { normal: [entry('lost', 'QQQ', 0, 5, 4000)], easy: [], hard: [] },
}));
check(posted.length === quiet, 'a result that does not make the board is not announced');

// A silent Worker, for anyone who has not set a webhook.
const mute = new Arena(fakeState(), {});
await mute.scores(request('POST', '/highscores', { board: phone }));
check(posted.length === quiet, 'with no webhook configured nothing is sent');

// And Discord falling over must not cost anybody their score.
globalThis.fetch = async () => { throw new Error('discord is down'); };
const survives = await arena.scores(request('POST', '/highscores', {
  board: { hard: [entry('h1', 'ZZZ', 2, 0, 5000)], easy: [], normal: [] },
}));
check((await survives.json()).board.hard.length === 1,
  'a score still lands when Discord is unreachable');
globalThis.fetch = realFetch;

// A body that is not a board at all.
const huge = {
  method: 'POST',
  url: 'https://relay.example/highscores',
  headers: { get: () => null },
  text: async () => 'x'.repeat(70 * 1024),
};
check((await arena.scores(huge)).status === 413, 'an oversized body is turned away');

// --- Sweeping the board ------------------------------------------------------

const noKey = await arena.reset({ method: 'POST', url: 'x', headers: { get: () => null } });
check(noKey.status === 403, 'resetting without the key is refused');
const wrongKey = await arena.reset({
  method: 'POST', url: 'x', headers: { get: (h) => (h === 'x-admin-key' ? 'guess' : null) },
});
check(wrongKey.status === 403, 'resetting with the wrong key is refused');
const cleared = await arena.reset({
  method: 'POST', url: 'x', headers: { get: (h) => (h === 'x-admin-key' ? 'letmein' : null) },
});
const clearedBody = await cleared.json();
check(cleared.status === 200 && clearedBody.board.normal.length === 0,
  'the right key empties the board');
check((await (await arena.scores(request('GET', '/highscores'))).json()).board.normal.length === 0,
  'and it stays empty when read back');

// The rows that were just wiped must not be allowed straight back in by a
// browser that still has them - which is what happened the first time a real
// board was cleaned.
await arena.scores(request('POST', '/highscores', { board: laptop }));
check((await (await arena.scores(request('GET', '/highscores'))).json()).board.normal.length === 0,
  'a browser reposting scores from before the wipe cannot refill the board');

const afterWipe = { normal: [entry('new1', 'NEW', 3, 0, Date.now() + 1000)], easy: [], hard: [] };
await arena.scores(request('POST', '/highscores', { board: afterWipe }));
check((await (await arena.scores(request('GET', '/highscores'))).json()).board.normal.length === 1,
  'but a score set after the wipe still counts');

// Taking one row off without touching the others, and keeping it off.
const future = Date.now() + 2000;
const keep = { normal: [entry('keeper', 'GUD', 4, 0, future)], easy: [], hard: [] };
const junky = { normal: [entry('junk', 'BAD', 9, 0, future)], easy: [], hard: [] };
await arena.scores(request('POST', '/highscores', { board: keep }));
const withJunk = await (await arena.scores(request('POST', '/highscores', { board: junky }))).json();
const namesBefore = withJunk.board.normal.map((r) => r.name);
check(namesBefore.includes('BAD') && namesBefore.includes('GUD'),
  'both rows are on the board to begin with');

const removed = await arena.remove({
  method: 'POST',
  url: 'x',
  headers: { get: (h) => (h === 'x-admin-key' ? 'letmein' : null) },
  text: async () => JSON.stringify({ ids: ['junk'] }),
});
const left = (await removed.json()).board.normal.map((r) => r.name);
check(!left.includes('BAD') && left.includes('GUD'),
  `one row comes off while the rest of the board stands (${left.join(', ')})`);

await arena.scores(request('POST', '/highscores', { board: junky }));
const after = (await (await arena.scores(request('GET', '/highscores'))).json()).board.normal;
check(!after.some((r) => r.id === 'junk'),
  'and the browser that set it cannot post it back');

const noKeyRemove = await arena.remove({
  method: 'POST', url: 'x', headers: { get: () => null }, text: async () => '{"ids":["keeper"]}',
});
check(noKeyRemove.status === 403, 'removing a row needs the key too');

// A Worker with no key set has no reset door at all.
const locked = new Arena(fakeState());
check((await locked.reset({ method: 'POST', url: 'x', headers: { get: () => 'anything' } })).status === 404,
  'with no key configured the reset does not exist');

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

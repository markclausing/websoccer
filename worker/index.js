/**
 * The same relay, as a Cloudflare Worker.
 *
 * One deployment does both jobs the game cannot do from static files: it pairs
 * two browsers up for an online match, and it keeps the shared high score board.
 * It speaks exactly the protocol server/relay.js speaks, so the browser cannot
 * tell the difference and neither can the tests.
 *
 * Everything lives in a single Durable Object. A Worker on its own is stateless
 * and cannot hold two sockets together, and one object for the whole game is
 * plenty: this is a football game for friends, not a service.
 *
 * See README.md next door for the two commands that put it live.
 */

import { merge } from '../src/highscores.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const MAX_BODY = 64 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
});

export class Arena {
  constructor(state) {
    this.state = state;
    /** @type {Map<string, {host: object|null, guest: object|null}>} */
    this.rooms = new Map();
    this.board = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/highscores') return this.scores(request);
    if (request.headers.get('Upgrade') === 'websocket') return this.open();
    return new Response('WebSoccer relay. Point the game at this address.', {
      headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS },
    });
  }

  // --- Pairing players up ----------------------------------------------------

  open() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const conn = { socket: server, room: null, role: null };
    server.addEventListener('message', (ev) => {
      this.receive(conn, typeof ev.data === 'string' ? ev.data : '');
    });
    server.addEventListener('close', () => this.leave(conn));
    server.addEventListener('error', () => this.leave(conn));

    return new Response(null, { status: 101, webSocket: client });
  }

  code() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  static send(conn, obj) {
    try {
      conn.socket.send(JSON.stringify(obj));
    } catch { /* the socket has gone; the close handler will tidy up */ }
  }

  peerOf(conn) {
    const room = conn.room && this.rooms.get(conn.room);
    if (!room) return null;
    return conn.role === 'host' ? room.guest : room.host;
  }

  leave(conn) {
    if (!conn.room) return;
    const room = this.rooms.get(conn.room);
    if (!room) return;
    if (room.host === conn) room.host = null;
    if (room.guest === conn) room.guest = null;

    const other = room.host || room.guest;
    if (other) Arena.send(other, { t: 'peerleft' });
    else this.rooms.delete(conn.room);
    conn.room = null;
  }

  receive(conn, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      case 'create': {
        this.leave(conn);
        const code = this.code();
        this.rooms.set(code, { host: conn, guest: null });
        conn.room = code;
        conn.role = 'host';
        Arena.send(conn, { t: 'room', code, role: 'host' });
        break;
      }

      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = this.rooms.get(code);
        if (!room) {
          Arena.send(conn, { t: 'error', msg: `Room ${code} does not exist` });
          return;
        }
        if (room.guest || !room.host) {
          Arena.send(conn, { t: 'error', msg: `Room ${code} is full` });
          return;
        }
        this.leave(conn);
        room.guest = conn;
        conn.room = code;
        conn.role = 'guest';
        Arena.send(conn, { t: 'room', code, role: 'guest' });
        Arena.send(room.host, { t: 'peer' });
        Arena.send(room.guest, { t: 'peer' });
        break;
      }

      default: {
        // Input, start, line-ups, hashes, pings: passed on untouched. The relay
        // does not know what any of it means, and does not need to.
        const peer = this.peerOf(conn);
        if (peer) Arena.send(peer, msg);
        break;
      }
    }
  }

  // --- The shared board ------------------------------------------------------

  async load() {
    if (!this.board) this.board = merge({}, (await this.state.storage.get('board')) || {});
    return this.board;
  }

  async scores(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET') return json({ board: await this.load() });
    if (request.method !== 'POST') {
      return json({ error: 'GET to read the board, POST to add to it' }, 405);
    }

    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'that is not a high score table' }, 413);

    let sent;
    try {
      sent = JSON.parse(text);
    } catch {
      return json({ error: 'not JSON' }, 400);
    }

    // The same merge the browser runs, so the two cannot disagree about what a
    // board is: rows that are not a real result do not survive it.
    const before = await this.load();
    const after = merge(before, sent?.board || {});
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      this.board = after;
      await this.state.storage.put('board', after);
    }
    return json({ board: after });
  }
}

export default {
  fetch(request, env) {
    // Everything goes to the one object. Rooms have to share it to find each
    // other, and thirty rows of high scores are not worth sharding.
    const id = env.ARENA.idFromName('global');
    return env.ARENA.get(id).fetch(request);
  },
};

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeFrame, createParser, encodeFrame, handshake } from './ws.js';

// One process does two things: serve the static files and pass inputs between
// two players. The server knows nothing about the game and keeps no score - it
// is a relay. All the logic runs on the players' own machines, because the
// simulation is deterministic.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

// --- Relay -----------------------------------------------------------------

/** @type {Map<string, {host: Conn|null, guest: Conn|null}>} */
const rooms = new Map();
let nextId = 1;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

class Conn {
  constructor(socket) {
    this.id = nextId++;
    this.socket = socket;
    this.room = null;
    this.role = null;
    this.alive = true;
  }

  send(obj) {
    if (!this.alive) return;
    try {
      this.socket.write(encodeFrame(JSON.stringify(obj)));
    } catch {
      this.close();
    }
  }

  peer() {
    const room = this.room && rooms.get(this.room);
    if (!room) return null;
    return this.role === 'host' ? room.guest : room.host;
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.socket.write(closeFrame());
      this.socket.end();
    } catch { /* socket was already gone */ }
    leaveRoom(this);
  }
}

function leaveRoom(conn) {
  if (!conn.room) return;
  const room = rooms.get(conn.room);
  if (!room) return;

  if (room.host === conn) room.host = null;
  if (room.guest === conn) room.guest = null;

  const other = room.host || room.guest;
  if (other) other.send({ t: 'peerleft' });
  else rooms.delete(conn.room);

  log(`player ${conn.id} left room ${conn.room}`);
  conn.room = null;
}

function handleMessage(conn, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.t) {
    case 'create': {
      leaveRoom(conn);
      const code = makeCode();
      rooms.set(code, { host: conn, guest: null });
      conn.room = code;
      conn.role = 'host';
      conn.send({ t: 'room', code, role: 'host' });
      log(`player ${conn.id} opened room ${code}`);
      break;
    }

    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        conn.send({ t: 'error', msg: `Room ${code} does not exist` });
        return;
      }
      if (room.guest || !room.host) {
        conn.send({ t: 'error', msg: `Room ${code} is full` });
        return;
      }
      leaveRoom(conn);
      room.guest = conn;
      conn.room = code;
      conn.role = 'guest';
      conn.send({ t: 'room', code, role: 'guest' });
      // Tell both sides the opponent has arrived; the host kicks off after that.
      room.host.send({ t: 'peer' });
      room.guest.send({ t: 'peer' });
      log(`player ${conn.id} joined room ${code}`);
      break;
    }

    default: {
      // Everything else (input, start, hash, ping, pong) is passed on untouched.
      const peer = conn.peer();
      if (peer) peer.send(msg);
      break;
    }
  }
}

server.on('upgrade', (req, socket) => {
  if (!handshake(req, socket)) return;

  const conn = new Conn(socket);
  log(`player ${conn.id} connected`);

  const feed = createParser({
    onMessage: (text) => handleMessage(conn, text),
    onClose: () => conn.close(),
    onPing: () => socket.write(encodeFrame('', { opcode: 0xa })),
  });

  socket.on('data', (chunk) => {
    try {
      feed(chunk);
    } catch (err) {
      log(`parser error for player ${conn.id}: ${err.message}`);
      conn.close();
    }
  });
  socket.on('error', () => conn.close());
  socket.on('close', () => {
    conn.alive = false;
    leaveRoom(conn);
    log(`player ${conn.id} disconnected`);
  });
});

function log(text) {
  if (process.env.QUIET) return;
  console.log(`[relay] ${text}`);
}

server.listen(PORT, () => {
  console.log(`WebSoccer running at http://localhost:${PORT}/`);
  console.log('To play online: open the page in two tabs (or on two computers on the same network).');
});

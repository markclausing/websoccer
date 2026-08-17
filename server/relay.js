import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeFrame, createParser, encodeFrame, handshake } from './ws.js';

// Eén proces doet twee dingen: de statische bestanden serveren en de inputs
// tussen twee spelers doorgeven. De server kent het spel niet en houdt geen
// wedstrijdstand bij - hij is een doorgeefluik. Alle logica draait bij de
// spelers zelf, want de simulatie is deterministisch.

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
    res.writeHead(403).end('Verboden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Niet gevonden');
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

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // zonder I/O/0/1

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
    } catch { /* socket was al weg */ }
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

  log(`speler ${conn.id} verlaat kamer ${conn.room}`);
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
      log(`speler ${conn.id} opent kamer ${code}`);
      break;
    }

    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        conn.send({ t: 'error', msg: `Kamer ${code} bestaat niet` });
        return;
      }
      if (room.guest || !room.host) {
        conn.send({ t: 'error', msg: `Kamer ${code} is vol` });
        return;
      }
      leaveRoom(conn);
      room.guest = conn;
      conn.room = code;
      conn.role = 'guest';
      conn.send({ t: 'room', code, role: 'guest' });
      // Allebei laten weten dat de tegenstander er is; de host begint daarna.
      room.host.send({ t: 'peer' });
      room.guest.send({ t: 'peer' });
      log(`speler ${conn.id} komt binnen in kamer ${code}`);
      break;
    }

    default: {
      // Al het andere (input, start, hash, ping, pong) gaat ongewijzigd door.
      const peer = conn.peer();
      if (peer) peer.send(msg);
      break;
    }
  }
}

server.on('upgrade', (req, socket) => {
  if (!handshake(req, socket)) return;

  const conn = new Conn(socket);
  log(`speler ${conn.id} verbonden`);

  const feed = createParser({
    onMessage: (text) => handleMessage(conn, text),
    onClose: () => conn.close(),
    onPing: () => socket.write(encodeFrame('', { opcode: 0xa })),
  });

  socket.on('data', (chunk) => {
    try {
      feed(chunk);
    } catch (err) {
      log(`parserfout bij speler ${conn.id}: ${err.message}`);
      conn.close();
    }
  });
  socket.on('error', () => conn.close());
  socket.on('close', () => {
    conn.alive = false;
    leaveRoom(conn);
    log(`speler ${conn.id} losgekoppeld`);
  });
});

function log(text) {
  if (process.env.QUIET) return;
  console.log(`[relay] ${text}`);
}

server.listen(PORT, () => {
  console.log(`WebSoccer draait op http://localhost:${PORT}/`);
  console.log('Online spelen: open de pagina in twee tabbladen (of op twee computers in hetzelfde netwerk).');
});

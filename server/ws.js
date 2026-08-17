import crypto from 'node:crypto';

// Minimale WebSocket-implementatie (RFC 6455), genoeg voor tekstberichten.
// Bewust zonder npm-dependencies: `node server/relay.js` en klaar.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

/** Antwoordt op een HTTP Upgrade-verzoek en maakt er een WebSocket van. */
export function handshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return false;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  // Zonder Nagle: inputpakketjes zijn klein en moeten meteen weg.
  socket.setNoDelay(true);
  return true;
}

/**
 * Bouwt een frame. Client->server moet gemaskeerd zijn, server->client niet.
 */
export function encodeFrame(text, { mask = false, opcode = 0x1 } = {}) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;

  if (!mask) return Buffer.concat([header, payload]);

  header[1] |= 0x80;
  const key = crypto.randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= key[i & 3];
  return Buffer.concat([header, key, masked]);
}

export function closeFrame() {
  return Buffer.from([0x88, 0x00]);
}

/**
 * Streaming parser: TCP levert geen berichten maar bytes, dus frames kunnen
 * gesplitst of geplakt aankomen. Geeft een functie terug die je per chunk voert.
 */
export function createParser({ onMessage, onClose, onPing }) {
  let buf = Buffer.alloc(0);
  let fragments = [];

  return function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;

    for (;;) {
      if (buf.length < 2) return;

      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;

      if (len === 126) {
        if (buf.length < off + 2) return;
        len = buf.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) return;
        len = Number(buf.readBigUInt64BE(off));
        off += 8;
      }

      let key = null;
      if (masked) {
        if (buf.length < off + 4) return;
        key = buf.subarray(off, off + 4);
        off += 4;
      }

      if (buf.length < off + len) return; // frame nog niet compleet

      const payload = Buffer.from(buf.subarray(off, off + len));
      if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      buf = buf.subarray(off + len);

      switch (opcode) {
        case 0x0: // vervolgframe
          fragments.push(payload);
          if (fin) {
            onMessage(Buffer.concat(fragments).toString('utf8'));
            fragments = [];
          }
          break;
        case 0x1: // tekst
        case 0x2: // binair
          if (fin) onMessage(payload.toString('utf8'));
          else fragments = [payload];
          break;
        case 0x8:
          onClose?.();
          return;
        case 0x9:
          onPing?.(payload);
          break;
        default:
          break; // pong en de rest negeren we
      }
    }
  };
}

/**
 * Thin layer on top of the WebSocket: create/join rooms and route messages by
 * their `t` field. Knows nothing about the game.
 *
 * WSImpl is injectable so the headless network test (tools/netcheck.js) can run
 * the exact same client code as the browser.
 */
export class Signal {
  constructor(url, WSImpl = globalThis.WebSocket) {
    this.url = url;
    this.handlers = new Map();
    this.queue = [];
    this.open = false;
    this.code = null;
    this.role = null;

    this.ws = new WSImpl(url);
    this.ws.onopen = () => {
      this.open = true;
      for (const msg of this.queue) this.ws.send(JSON.stringify(msg));
      this.queue.length = 0;
      this.emit('open', {});
    };
    this.ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.t === 'room') {
        this.code = msg.code;
        this.role = msg.role;
      }
      this.emit(msg.t, msg);
    };
    this.ws.onclose = () => {
      this.open = false;
      this.emit('close', {});
    };
    // transport: true means the socket itself failed, not the server rejecting us.
    this.ws.onerror = () => this.emit('error', { msg: 'No connection to the server', transport: true });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, msg) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const fn of list) fn(msg);
  }

  send(msg) {
    if (!this.open) {
      this.queue.push(msg);
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch { /* connection is gone; onclose handles the rest */ }
  }

  create() {
    this.send({ t: 'create' });
  }

  join(code) {
    this.send({ t: 'join', code: String(code).toUpperCase().trim() });
  }

  close() {
    this.handlers.clear();
    try {
      this.ws.close();
    } catch { /* already closed */ }
  }
}

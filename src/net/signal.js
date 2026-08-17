/**
 * Dunne laag boven de WebSocket: kamers openen/joinen en berichten routeren op
 * hun `t`-veld. Kent het spel niet.
 *
 * WSImpl is injecteerbaar zodat de headless netwerktest (tools/netcheck.js)
 * dezelfde clientcode kan draaien als de browser.
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
    this.ws.onerror = () => this.emit('error', { msg: 'Geen verbinding met de server' });
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
    } catch { /* verbinding is weg; onclose regelt de rest */ }
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
    } catch { /* al dicht */ }
  }
}

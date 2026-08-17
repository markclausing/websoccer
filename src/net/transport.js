import { hashState } from '../game/state.js';

/**
 * Transport = de laag die per tick de inputs van ALLE spelers levert.
 * De game-loop kent alleen deze interface:
 *
 *    transport.sample(tick)   input van deze machine vastleggen (en versturen)
 *    transport.ready(tick)    mogen we deze tick simuleren?
 *    transport.poll(tick)  -> [maskTeam0, maskTeam1]
 *    transport.afterStep(state)
 *
 * Lokaal komt alles van het toetsenbord; online komt de helft van de
 * tegenstander. De simulatie merkt het verschil niet - daarom hoefde er voor
 * online multiplayer niets aan sim.js te veranderen.
 */

/** Beide spelers op één machine. */
export class LocalTransport {
  constructor(devices, humanSlots = [0]) {
    this.devices = devices;
    this.humanSlots = humanSlots; // humanSlots[controller] = team-index
    this.online = false;
  }

  sample() {}

  ready() {
    return true;
  }

  poll() {
    const out = [0, 0];
    this.humanSlots.forEach((teamIdx, controllerIdx) => {
      out[teamIdx] = this.devices.mask(controllerIdx);
    });
    return out;
  }

  afterStep() {}
  dispose() {}
}

/**
 * Ringbuffer met inputs per tick. Slaat het ticknummer op naast de waarde, zodat
 * een oude waarde na een omwenteling nooit voor een nieuwe kan doorgaan.
 */
export class InputBuffer {
  constructor(size = 1024) {
    this.size = size;
    this.masks = new Int32Array(size);
    this.ticks = new Int32Array(size).fill(-1);
  }

  set(tick, mask) {
    if (tick < 0) return;
    const i = tick % this.size;
    if (this.ticks[i] === tick) return; // eerst binnengekomen waarde wint
    this.masks[i] = mask;
    this.ticks[i] = tick;
  }

  get(tick) {
    const i = ((tick % this.size) + this.size) % this.size;
    return this.ticks[i] === tick ? this.masks[i] : null;
  }

  /** Laatst bekende input herhalen. Nog niet in gebruik; basis voor rollback. */
  predict(tick) {
    for (let t = tick; t > tick - 40 && t >= 0; t--) {
      const v = this.get(t);
      if (v !== null) return v;
    }
    return 0;
  }
}

/**
 * Online multiplayer: lockstep met input-delay.
 *
 * Beide machines draaien dezelfde deterministische simulatie en sturen elkaar
 * alleen hun eigen knoppen - nooit posities of standen. De input van tick T
 * wordt DELAY ticks van tevoren verstuurd, zodat hij op tijd aan de overkant is.
 * Is hij er toch niet, dan wacht de simulatie (een "stall") in plaats van te
 * gokken; dat kan niet uit de pas lopen.
 */
export class OnlineTransport {
  constructor({ signal, devices, localTeam, delay = 4, minDelay = 3, maxDelay = 12 }) {
    this.signal = signal;
    this.devices = devices;
    this.localTeam = localTeam;
    this.remoteTeam = 1 - localTeam;
    this.delay = delay;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.online = true;

    this.local = new InputBuffer();
    this.remote = new InputBuffer();
    this.lastSent = -1;

    this.stalls = 0;
    this.stallWindow = 0;
    this.calmSeconds = 0;
    this.stalling = false;
    this.ping = 0;
    this.pongs = 0;
    this.desync = false;
    this.peerLeft = false;
    this.remoteTick = 0;

    this.myHashes = new Map();
    this.theirHashes = new Map();

    // De eerste DELAY ticks heeft niemand nog input kunnen sturen. Beide kanten
    // vullen daar dezelfde nullen in, anders wacht iedereen op elkaar.
    for (let t = 0; t < delay; t++) {
      this.local.set(t, 0);
      this.remote.set(t, 0);
    }

    signal.on('input', (m) => {
      for (const [tick, mask] of m.frames) {
        this.remote.set(tick, mask);
        if (tick > this.remoteTick) this.remoteTick = tick;
      }
    });
    signal.on('hash', (m) => this.onRemoteHash(m));
    signal.on('ping', (m) => signal.send({ t: 'pong', id: m.id }));
    signal.on('pong', (m) => {
      this.ping = Math.max(0, Math.round(now() - m.id));
      this.pongs++;
    });
    signal.on('peerleft', () => {
      this.peerLeft = true;
    });
  }

  /** Leg de input van deze machine vast voor tick+DELAY en stuur hem op. */
  sample(tick) {
    const target = tick + this.delay;
    if (target <= this.lastSent) return;

    // Online bestuur je maar één team, dus beide toetsenbordhelften (en beide
    // gamepads) sturen dezelfde speler aan.
    const mask = this.devices.mask(0) | this.devices.mask(1);

    // Alle ticks tot en met `target` vullen. Meestal is dat er precies één, maar
    // als de delay net omhoog is gegaan mag er geen gat vallen: op een ontbrekende
    // tick zou de tegenstander eeuwig staan wachten.
    for (let t = Math.max(this.lastSent + 1, 0); t <= target; t++) this.local.set(t, mask);
    this.lastSent = target;

    // De laatste paar ticks gaan telkens mee: verloren pakketjes repareren
    // zichzelf zonder dat er iets opnieuw gevraagd hoeft te worden.
    const frames = [];
    for (let t = Math.max(0, target - 7); t <= target; t++) {
      const v = this.local.get(t);
      if (v !== null) frames.push([t, v]);
    }
    this.signal.send({ t: 'input', frames });
  }

  ready(tick) {
    const ok = this.local.get(tick) !== null && this.remote.get(tick) !== null;
    if (ok) {
      this.stalling = false;
    } else {
      this.stalls++;
      this.stallWindow++;
      this.stalling = true;
    }
    return ok;
  }

  /**
   * De input-delay past zich aan de verbinding aan: haperen we vaak, dan sturen
   * we onze input verder vooruit (iets tragere besturing, maar vloeiend beeld).
   * Dit mag per speler verschillen - elke input draagt zijn eigen ticknummer,
   * dus de simulatie blijft aan beide kanten gelijk.
   */
  tuneDelay() {
    if (this.stallWindow > 8 && this.delay < this.maxDelay) {
      this.delay++;
      this.calmSeconds = 0;
    } else if (this.stallWindow === 0) {
      this.calmSeconds++;
      if (this.calmSeconds >= 8 && this.delay > this.minDelay) {
        this.delay--;
        this.calmSeconds = 0;
      }
    } else {
      this.calmSeconds = 0;
    }
    this.stallWindow = 0;
  }

  poll(tick) {
    const out = [0, 0];
    out[this.localTeam] = this.local.get(tick) ?? 0;
    out[this.remoteTeam] = this.remote.get(tick) ?? 0;
    return out;
  }

  /** Elke seconde de toestand vergelijken; bij verschil is er een desync. */
  afterStep(state) {
    if (state.tick % 60 !== 0) return;
    this.tuneDelay();

    const mine = hashState(state);
    this.myHashes.set(state.tick, mine);
    if (this.myHashes.size > 40) {
      this.myHashes.delete(this.myHashes.keys().next().value);
    }

    this.signal.send({ t: 'hash', tick: state.tick, hash: mine });
    this.signal.send({ t: 'ping', id: now() });

    const theirs = this.theirHashes.get(state.tick);
    if (theirs !== undefined) {
      this.theirHashes.delete(state.tick);
      if (theirs !== mine) this.desync = true;
    }
  }

  onRemoteHash(m) {
    const mine = this.myHashes.get(m.tick);
    if (mine === undefined) {
      this.theirHashes.set(m.tick, m.hash);
      if (this.theirHashes.size > 40) {
        this.theirHashes.delete(this.theirHashes.keys().next().value);
      }
    } else if (mine !== m.hash) {
      this.desync = true;
    }
  }

  dispose() {
    this.signal.close();
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

import { hashState } from '../game/state.js';

/**
 * A transport supplies the inputs of ALL players, per tick.
 * The game loop only knows this interface:
 *
 *    transport.sample(tick)   record (and send) this machine's input
 *    transport.ready(tick)    are we allowed to simulate this tick?
 *    transport.poll(tick)  -> [maskTeam0, maskTeam1]
 *    transport.afterStep(state)
 *
 * Locally everything comes from the keyboard; online half of it comes from the
 * opponent. The simulation cannot tell the difference - which is why adding
 * online multiplayer needed no changes to sim.js at all.
 */

/** Both players on one machine. */
export class LocalTransport {
  constructor(devices, humanSlots = [0]) {
    this.devices = devices;
    this.humanSlots = humanSlots; // humanSlots[controller] = team index
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
 * Ring buffer of inputs per tick. Stores the tick number alongside the value, so
 * a stale entry can never pass for a fresh one after the buffer wraps around.
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
    if (this.ticks[i] === tick) return; // first value to arrive wins
    this.masks[i] = mask;
    this.ticks[i] = tick;
  }

  get(tick) {
    const i = ((tick % this.size) + this.size) % this.size;
    return this.ticks[i] === tick ? this.masks[i] : null;
  }

  /** Repeat the last known input. Unused for now; the basis for rollback. */
  predict(tick) {
    for (let t = tick; t > tick - 40 && t >= 0; t--) {
      const v = this.get(t);
      if (v !== null) return v;
    }
    return 0;
  }
}

/**
 * Online multiplayer: lockstep with input delay.
 *
 * Both machines run the same deterministic simulation and send each other only
 * their own buttons - never positions or scores. The input for tick T is sent
 * DELAY ticks ahead of time so it arrives before it is needed. If it is not
 * there anyway, the simulation waits (a "stall") instead of guessing; that way
 * the two sides cannot drift apart.
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

    // For the first DELAY ticks nobody has been able to send anything yet. Both
    // sides fill in the same zeroes, otherwise everyone waits for everyone.
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

  /** Record this machine's input for tick+DELAY and send it off. */
  sample(tick) {
    const target = tick + this.delay;
    if (target <= this.lastSent) return;

    // Online you control just one team, so both keyboard halves (and both
    // gamepads) drive the same player.
    const mask = this.devices.mask(0) | this.devices.mask(1);

    // Fill every tick up to and including `target`. Usually that is exactly one,
    // but if the delay has just gone up there must be no gap: a missing tick
    // would leave the opponent waiting forever.
    for (let t = Math.max(this.lastSent + 1, 0); t <= target; t++) this.local.set(t, mask);
    this.lastSent = target;

    // The last few ticks ride along every time: lost packets repair themselves
    // without anything ever having to be re-requested.
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
   * The input delay adapts to the connection: if we stall often we send our input
   * further ahead (slightly laggier controls, but a smooth picture). This may
   * differ per player - every input carries its own tick number, so the
   * simulation stays identical on both sides.
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

  /** Compare state once a second; any difference means a desync. */
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

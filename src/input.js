import { BTN } from './constants.js';

// Input is compressed into a single integer (bitmask) per player per tick.
// That is exactly what goes over the wire: one byte per player per frame.
//
// Bindings are stored the way the settings screen needs them - action to key -
// and turned into a key-to-bitmask lookup for reading input, which is the way
// the game loop needs them.

export const ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'switch'];

export const ACTION_BIT = {
  up: BTN.UP,
  down: BTN.DOWN,
  left: BTN.LEFT,
  right: BTN.RIGHT,
  fire: BTN.FIRE,
  switch: BTN.SWITCH,
};

export const ACTION_LABELS = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  fire: 'Kick / slide',
  switch: 'Switch player',
};

export const PRESETS = [
  {
    key: 'wasd',
    label: 'W A S D + Space',
    bindings: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', fire: 'Space', switch: 'KeyQ' },
  },
  {
    key: 'arrows',
    label: 'Arrows + Enter',
    bindings: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'Enter', switch: 'ShiftRight' },
  },
  {
    key: 'arrowsSpace',
    label: 'Arrows + Space',
    bindings: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'Space', switch: 'ControlRight' },
  },
  {
    key: 'ijkl',
    label: 'I J K L + Shift',
    bindings: { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', fire: 'ShiftRight', switch: 'KeyU' },
  },
];

export function defaultBindings() {
  return [{ ...PRESETS[0].bindings }, { ...PRESETS[1].bindings }];
}

// Keys the browser does something else with. Swallowed whether or not they are
// bound, so the page never scrolls or re-clicks a button mid-match.
const ALWAYS_SWALLOW = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'];

/**
 * Where the key bindings live, unless the game says otherwise.
 *
 * It has to be said otherwise when two games share an origin, which websoccer
 * and webtennis do - both on the same github.io domain. One key would mean
 * rebinding in one game silently rebinding the other, and the two do not even
 * mean the same things by the same buttons.
 */
const STORAGE_KEY = 'bindings.v1';

export function loadBindings(key = STORAGE_KEY) {
  const fallback = defaultBindings();
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return fallback;
    // Copied across one key at a time: anything missing or malformed in storage
    // quietly keeps its default rather than breaking the controls.
    for (let slot = 0; slot < fallback.length; slot++) {
      for (const action of ACTIONS) {
        const code = saved[slot]?.[action];
        if (typeof code === 'string' && code) fallback[slot][action] = code;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveBindings(bindings, key = STORAGE_KEY) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(bindings));
  } catch { /* private mode, storage full: not worth interrupting a game for */ }
}

/**
 * Keys bound to more than one action. Sharing keys is allowed - one player using
 * the arrows and space is perfectly sensible - but two players cannot share.
 */
export function findConflicts(bindings) {
  const seen = new Map();
  const clashes = [];
  bindings.forEach((slotBindings, slot) => {
    for (const action of ACTIONS) {
      const code = slotBindings[action];
      if (!code) continue;
      const earlier = seen.get(code);
      if (earlier && earlier.slot !== slot) clashes.push({ code, a: earlier, b: { slot, action } });
      else if (!earlier) seen.set(code, { slot, action });
    }
  });
  return clashes;
}

/** 'KeyW' -> 'W', 'ArrowUp' -> '↑'. What ends up on the button in the menu. */
export function keyLabel(code) {
  if (!code) return '—';
  const named = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Enter: 'Enter',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    AltLeft: 'L Alt',
    AltRight: 'R Alt',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Slash: '/',
    Backslash: '\\',
    Comma: ',',
    Period: '.',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export class InputDevices {
  constructor(bindings = loadBindings()) {
    this.down = new Set();
    this.enabled = true;
    this.touch = null; // on-screen controls, when there are any
    this.setBindings(bindings);

    this._onKeyDown = (e) => {
      if (this.swallow.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
  }

  setBindings(bindings) {
    this.bindings = bindings;
    this.lookup = bindings.map((slotBindings) => {
      const map = {};
      for (const action of ACTIONS) {
        const code = slotBindings[action];
        if (code) map[code] = (map[code] || 0) | ACTION_BIT[action];
      }
      return map;
    });
    this.swallow = new Set(ALWAYS_SWALLOW);
    for (const map of this.lookup) for (const code of Object.keys(map)) this.swallow.add(code);
  }

  attach(target = window) {
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  detach(target = window) {
    target.removeEventListener('keydown', this._onKeyDown);
    target.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  isDown(code) {
    return this.down.has(code);
  }

  /** Bitmask for one local slot (0 or 1), keyboard and gamepad merged. */
  mask(slot) {
    if (!this.enabled) return 0;
    let m = 0;
    const map = this.lookup[slot] || {};
    for (const code of this.down) {
      const bit = map[code];
      if (bit) m |= bit;
    }
    // The on-screen controls drive the first slot, which is the one every
    // single player and online match uses.
    const touch = slot === 0 && this.touch ? this.touch.mask : 0;
    return m | touch | this.gamepadMask(slot);
  }

  gamepadMask(slot) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
    const pads = navigator.getGamepads();
    const pad = pads ? pads[slot] : null;
    if (!pad) return 0;
    let m = 0;
    const dz = 0.35;
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    if (ay < -dz) m |= BTN.UP;
    if (ay > dz) m |= BTN.DOWN;
    if (ax < -dz) m |= BTN.LEFT;
    if (ax > dz) m |= BTN.RIGHT;
    const b = pad.buttons;
    if (b[12] && b[12].pressed) m |= BTN.UP;
    if (b[13] && b[13].pressed) m |= BTN.DOWN;
    if (b[14] && b[14].pressed) m |= BTN.LEFT;
    if (b[15] && b[15].pressed) m |= BTN.RIGHT;
    for (const i of [0, 1, 2, 3, 6, 7]) {
      if (b[i] && b[i].pressed) m |= BTN.FIRE;
    }
    return m;
  }
}

/** Bitmask -> direction. Diagonals are normalised. */
export function maskToDir(mask) {
  let x = 0;
  let y = 0;
  if (mask & BTN.LEFT) x -= 1;
  if (mask & BTN.RIGHT) x += 1;
  if (mask & BTN.UP) y -= 1;
  if (mask & BTN.DOWN) y += 1;
  if (x && y) {
    const k = Math.SQRT1_2;
    x *= k;
    y *= k;
  }
  return { x, y };
}

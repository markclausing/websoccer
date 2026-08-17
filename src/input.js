import { BTN } from './constants.js';

// Input wordt gecomprimeerd tot één integer (bitmask) per speler per tick.
// Dat is precies wat je later over het net stuurt: 1 byte per speler per frame.

export const DEFAULT_KEYMAP = [
  // Slot 0 - links op het toetsenbord
  { KeyW: BTN.UP, KeyS: BTN.DOWN, KeyA: BTN.LEFT, KeyD: BTN.RIGHT, Space: BTN.FIRE, ShiftLeft: BTN.FIRE },
  // Slot 1 - rechts op het toetsenbord
  {
    ArrowUp: BTN.UP,
    ArrowDown: BTN.DOWN,
    ArrowLeft: BTN.LEFT,
    ArrowRight: BTN.RIGHT,
    Enter: BTN.FIRE,
    Numpad0: BTN.FIRE,
    ShiftRight: BTN.FIRE,
    Slash: BTN.FIRE,
  },
];

const SWALLOW = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Slash', 'Numpad0',
]);

export class InputDevices {
  constructor(keymap = DEFAULT_KEYMAP) {
    this.keymap = keymap;
    this.down = new Set();
    this.enabled = true;
    this._onKeyDown = (e) => {
      if (SWALLOW.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
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

  /** Bitmask voor één lokaal slot (0 of 1), toetsenbord + gamepad samengevoegd. */
  mask(slot) {
    if (!this.enabled) return 0;
    let m = 0;
    const map = this.keymap[slot] || {};
    for (const code of this.down) {
      const bit = map[code];
      if (bit) m |= bit;
    }
    return m | this.gamepadMask(slot);
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

/** Bitmask -> richting. Diagonalen worden genormaliseerd. */
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

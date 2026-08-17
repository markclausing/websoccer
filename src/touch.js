import { BTN } from './constants.js';

/**
 * On-screen controls for phones and tablets: a thumbstick on the left, a kick
 * button and a switch button on the right.
 *
 * They produce the same five-bit mask as the keyboard, so the simulation, the
 * netcode and the replay of a match cannot tell which one you used. Holding the
 * kick button charges the shot exactly as holding the key does.
 *
 * Pointer events rather than touch events: one code path covers finger, stylus
 * and mouse, and each pointer is tracked by id so the stick and the button work
 * at the same time.
 */

const DEAD_ZONE = 10; // px of slack in the middle of the stick
const MAX_THROW = 46; // px at which the stick is fully deflected

export class TouchControls {
  constructor() {
    this.mask = 0;
    this.stickPointer = null;
    this.origin = { x: 0, y: 0 };
    this.elements = null;
    this.visible = false;
  }

  /** @param {{root: Element, stick: Element, knob: Element, kick: Element, swap: Element}} elements */
  attach(elements) {
    this.elements = elements;
    const { stick, knob, kick, swap } = elements;

    stick.addEventListener('pointerdown', (e) => {
      stick.setPointerCapture(e.pointerId);
      this.stickPointer = e.pointerId;
      const box = stick.getBoundingClientRect();
      this.origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      this.moveStick(e, knob);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.moveStick(e, knob);
      e.preventDefault();
    });
    const release = (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.mask &= ~(BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
      knob.style.transform = 'translate(-50%, -50%)';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    this.button(kick, BTN.FIRE);
    this.button(swap, BTN.SWITCH);
  }

  button(el, bit) {
    const down = (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.mask |= bit;
      el.classList.add('pressed');
      e.preventDefault();
    };
    const up = () => {
      this.mask &= ~bit;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  moveStick(e, knob) {
    const dx = e.clientX - this.origin.x;
    const dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);

    this.mask &= ~(BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
    if (len > DEAD_ZONE) {
      // Eight ways, like the joysticks this is imitating: the mask has no room
      // for anything finer, and the simulation normalises the diagonals.
      const angle = Math.atan2(dy, dx);
      const sector = Math.round((angle * 4) / Math.PI); // -4..4, an eighth each
      const table = {
        '-4': BTN.LEFT,
        '-3': BTN.LEFT | BTN.UP,
        '-2': BTN.UP,
        '-1': BTN.UP | BTN.RIGHT,
        0: BTN.RIGHT,
        1: BTN.RIGHT | BTN.DOWN,
        2: BTN.DOWN,
        3: BTN.DOWN | BTN.LEFT,
        4: BTN.LEFT,
      };
      this.mask |= table[String(sector)] || 0;
    }

    const clamped = Math.min(len, MAX_THROW);
    const kx = len ? (dx / len) * clamped : 0;
    const ky = len ? (dy / len) * clamped : 0;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }

  show(on) {
    this.visible = on;
    this.elements?.root.classList.toggle('hidden', !on);
    if (!on) this.mask = 0;
  }
}

/** Does this look like a device you drive with your fingers? */
export function isTouchDevice() {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches;
}

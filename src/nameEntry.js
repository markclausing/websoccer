/**
 * Three letters, the way an arcade cabinet asks for them.
 *
 * Driven by the game's own input mask rather than a text box, so the stick and
 * the kick button work - which matters most on a phone, where a text box would
 * throw the software keyboard over the screen. Typing works too, because
 * everyone with a keyboard will try it first.
 */

import { ALPHABET, NAME_LENGTH } from './highscores.js';
import { BTN } from './constants.js';

/** How long a held direction waits before it starts repeating, and how fast. */
const REPEAT_DELAY = 24; // frames
const REPEAT_EVERY = 6;

export class NameEntry {
  constructor(container, onDone) {
    this.container = container;
    this.onDone = onDone;
    this.letters = [0, 0, 0];
    this.slot = 0;
    this.prevMask = 0;
    this.held = 0;
    this.active = false;
    this.typedFor = 0;
    this.cells = [];

    for (let i = 0; i < NAME_LENGTH; i++) {
      const cell = document.createElement('span');
      cell.className = 'letter';
      container.appendChild(cell);
      this.cells.push(cell);
    }
  }

  /** Opens the picker, starting from the last name this browser used. */
  start(previous) {
    const from = String(previous || 'AAA').toUpperCase();
    this.letters = [0, 1, 2].map((i) => Math.max(0, ALPHABET.indexOf(from[i] ?? 'A')));
    this.slot = 0;
    this.prevMask = 0;
    this.held = 0;
    this.active = true;
    this.render();
  }

  stop() {
    this.active = false;
  }

  name() {
    return this.letters.map((i) => ALPHABET[i]).join('');
  }

  /** One frame of input. Returns true while the picker is still open. */
  step(mask) {
    if (!this.active) return false;

    // Someone typing "AAA" is also holding the key that means "left" on the
    // default bindings. For a moment after a keystroke the stick is ignored, so
    // one letter does not arrive twice over.
    if (this.typedFor > 0) {
      this.typedFor--;
      this.prevMask = mask;
      this.render();
      return true;
    }

    const pressed = mask & ~this.prevMask;
    // A held direction repeats, or picking a letter far down the alphabet means
    // tapping up twenty times.
    const repeating = mask && mask === this.prevMask;
    this.held = repeating ? this.held + 1 : 0;
    const repeat = this.held > REPEAT_DELAY && (this.held - REPEAT_DELAY) % REPEAT_EVERY === 0;
    const acts = repeat ? mask : pressed;

    if (acts & BTN.UP) this.cycle(-1);
    if (acts & BTN.DOWN) this.cycle(1);
    if (acts & BTN.LEFT) this.slot = (this.slot + NAME_LENGTH - 1) % NAME_LENGTH;
    if (acts & BTN.RIGHT) this.slot = (this.slot + 1) % NAME_LENGTH;

    this.prevMask = mask;

    if (pressed & (BTN.FIRE | BTN.SWITCH)) {
      this.confirm();
      return false;
    }
    this.render();
    return true;
  }

  cycle(by) {
    const n = ALPHABET.length;
    this.letters[this.slot] = (this.letters[this.slot] + by + n) % n;
  }

  /** A typed key: letters and digits fill the slot and move on. */
  type(key) {
    if (!this.active) return false;
    const ch = String(key || '').toUpperCase();
    if (ch === 'ENTER') {
      this.confirm();
      return true;
    }
    if (ch === 'BACKSPACE') {
      this.slot = Math.max(0, this.slot - 1);
      this.letters[this.slot] = ALPHABET.length - 1; // the dash
      this.render();
      return true;
    }
    const at = ALPHABET.indexOf(ch);
    if (ch.length !== 1 || at < 0) return false;
    this.typedFor = 12;
    this.letters[this.slot] = at;
    if (this.slot < NAME_LENGTH - 1) this.slot++;
    this.render();
    return true;
  }

  confirm() {
    if (!this.active) return;
    this.active = false;
    this.render();
    this.onDone(this.name());
  }

  render() {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].textContent = ALPHABET[this.letters[i]];
      this.cells[i].classList.toggle('on', this.active && i === this.slot);
    }
  }
}

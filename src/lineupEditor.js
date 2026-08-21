/**
 * The line-up editor: a pitch you can drag your players around on.
 *
 * Your own goal is at the bottom and you attack upwards, the same way round as
 * the match itself, so a player you drag towards the top is a player you have
 * pushed forward.
 *
 * It only ever hands out plain spots. What those spots mean - who is a defender,
 * who is a hanging ten - is decided by game/formations.js from where they stand,
 * so this file has no opinion about roles beyond colouring them in.
 */

import { normaliseLineup, roleFor, shapeOf } from './game/formations.js';

const ROLE_COLOUR = {
  gk: '#f2d43c',
  df: '#7fb2ff',
  dm: '#9ad0ff',
  mf: '#ffffff',
  am: '#ffd07f',
  fw: '#ff8b6b',
};

const GRAB = 18; // how near your finger has to land, in canvas pixels

export class LineupEditor {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.spots = normaliseLineup(null);
    this.dragging = -1;
    this.kit = '#2f6fd0';

    canvas.addEventListener('pointerdown', (e) => this.grab(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.drop(e));
    canvas.addEventListener('pointercancel', (e) => this.drop(e));
    // Otherwise dragging a player scrolls the menu on a phone.
    canvas.style.touchAction = 'none';
  }

  set(spots, kit) {
    this.spots = normaliseLineup(spots);
    if (kit) this.kit = kit;
    this.draw();
  }

  get() {
    return this.spots.map(({ x, y }) => ({ x, y }));
  }

  /** Canvas coordinates for a spot, and back again. */
  toCanvas(spot) {
    const { width, height } = this.canvas;
    return {
      x: width / 2 + spot.x * (width / 2 - 14),
      y: height - 10 - spot.y * (height - 20),
    };
  }

  fromCanvas(px, py) {
    const { width, height } = this.canvas;
    return {
      x: (px - width / 2) / (width / 2 - 14),
      y: (height - 10 - py) / (height - 20),
    };
  }

  at(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  grab(e) {
    const p = this.at(e);
    let best = -1;
    let bestD = GRAB * GRAB;
    // The keeper is left out: his job is his line, and letting him be dragged
    // up the pitch only ever produced an empty net.
    for (let i = 1; i < this.spots.length; i++) {
      const c = this.toCanvas(this.spots[i]);
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    this.dragging = best;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  move(e) {
    if (this.dragging < 0) return;
    const p = this.at(e);
    const spot = this.fromCanvas(p.x, p.y);
    const i = this.dragging;
    this.spots[i] = {
      x: Math.max(-1, Math.min(1, spot.x)),
      // Nobody may stand in the keeper's lap, or off the far end.
      y: Math.max(0.06, Math.min(0.95, spot.y)),
      role: this.spots[i].role,
    };
    this.spots[i].role = roleFor(this.spots[i].y, i);
    this.draw();
    e.preventDefault();
  }

  drop(e) {
    if (this.dragging < 0) return;
    this.dragging = -1;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.onChange) this.onChange(this.get());
  }

  draw() {
    const g = this.canvas.getContext('2d');
    const { width: w, height: h } = this.canvas;

    g.fillStyle = '#1d6b2c';
    g.fillRect(0, 0, w, h);
    // Mown stripes, so it reads as a pitch at a glance.
    g.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let i = 0; i < 8; i += 2) g.fillRect(0, (i * h) / 8, w, h / 8);

    g.strokeStyle = 'rgba(232, 242, 232, 0.55)';
    g.lineWidth = 1;
    g.strokeRect(6.5, 6.5, w - 13, h - 13);
    g.beginPath();
    g.moveTo(6.5, h / 2);
    g.lineTo(w - 6.5, h / 2);
    g.stroke();
    g.beginPath();
    g.arc(w / 2, h / 2, 26, 0, Math.PI * 2);
    g.stroke();
    // Both boxes: your own at the bottom, theirs at the top.
    for (const top of [true, false]) {
      const boxH = 40;
      const y = top ? 6.5 : h - 6.5 - boxH;
      g.strokeRect(w / 2 - 44, y, 88, boxH);
    }

    for (let i = 0; i < this.spots.length; i++) {
      const spot = this.spots[i];
      const c = this.toCanvas(spot);
      const role = spot.role || roleFor(spot.y, i);
      g.beginPath();
      g.arc(c.x, c.y, i === this.dragging ? 9 : 7, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? ROLE_COLOUR.gk : this.kit;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = ROLE_COLOUR[role] || '#ffffff';
      g.stroke();
    }
  }

  shape() {
    return shapeOf(this.spots);
  }
}

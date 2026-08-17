import {
  ARC_R, CENTER_R, CORNER_R, FIELD, FIELD_H, FIELD_W, GOAL_DEPTH, GOAL_W,
  PEN_D, PEN_SPOT, PEN_W, SIX_D, SIX_W, WORLD_H, WORLD_W,
} from '../constants.js';

// Het veld verandert nooit, dus tekenen we het één keer naar een offscreen canvas
// en blitten daarna alleen het zichtbare stuk.

export function buildPitch() {
  const c = document.createElement('canvas');
  c.width = WORLD_W;
  c.height = WORLD_H;
  const g = c.getContext('2d');

  g.fillStyle = '#1b5f27';
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  const stripe = 62;
  for (let y = FIELD.top; y < FIELD.bottom; y += stripe) {
    const i = Math.floor((y - FIELD.top) / stripe);
    g.fillStyle = i % 2 ? '#2b8b3c' : '#268036';
    g.fillRect(FIELD.left, y, FIELD_W, Math.min(stripe, FIELD.bottom - y));
  }

  g.strokeStyle = 'rgba(255,255,255,0.88)';
  g.lineWidth = 3;
  g.lineCap = 'butt';

  // Buitenlijnen
  g.strokeRect(FIELD.left, FIELD.top, FIELD_W, FIELD_H);

  // Middenlijn + cirkel
  line(g, FIELD.left, FIELD.cy, FIELD.right, FIELD.cy);
  circle(g, FIELD.cx, FIELD.cy, CENTER_R);
  dot(g, FIELD.cx, FIELD.cy);

  for (const side of [-1, 1]) {
    const gy = side < 0 ? FIELD.top : FIELD.bottom;
    const dir = side < 0 ? 1 : -1; // richting het veld in

    // Strafschopgebied
    g.strokeRect(FIELD.cx - PEN_W / 2, side < 0 ? gy : gy - PEN_D, PEN_W, PEN_D);
    // Doelgebied
    g.strokeRect(FIELD.cx - SIX_W / 2, side < 0 ? gy : gy - SIX_D, SIX_W, SIX_D);
    // Strafschopstip
    dot(g, FIELD.cx, gy + dir * PEN_SPOT);

    // Boog buiten het strafschopgebied
    g.save();
    g.beginPath();
    if (side < 0) g.rect(FIELD.left, gy + PEN_D, FIELD_W, 200);
    else g.rect(FIELD.left, gy - PEN_D - 200, FIELD_W, 200);
    g.clip();
    circle(g, FIELD.cx, gy + dir * PEN_SPOT, ARC_R);
    g.restore();

    // Hoekbogen
    for (const sx of [-1, 1]) {
      const cxp = sx < 0 ? FIELD.left : FIELD.right;
      g.beginPath();
      g.arc(cxp, gy, CORNER_R, 0, Math.PI * 2);
      g.stroke();
    }

    // Doel + net
    const gx0 = FIELD.cx - GOAL_W / 2;
    const gy0 = side < 0 ? gy - GOAL_DEPTH : gy;
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(gx0, gy0, GOAL_W, GOAL_DEPTH);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    for (let x = gx0; x <= gx0 + GOAL_W; x += 8) line(g, x, gy0, x, gy0 + GOAL_DEPTH);
    for (let y = gy0; y <= gy0 + GOAL_DEPTH; y += 8) line(g, gx0, y, gx0 + GOAL_W, y);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.strokeRect(gx0, gy0, GOAL_W, GOAL_DEPTH);
    g.restore();
  }

  return c;
}

function line(g, x0, y0, x1, y1) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
}

function dot(g, x, y) {
  g.beginPath();
  g.arc(x, y, 2.5, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
}

/**
 * The picture behind the menu: a night match seen from the top of the stand.
 *
 * Drawn once into a small offscreen canvas - 240 by 166 - and then blown up with
 * smoothing switched off, which is what gives it real chunky pixels rather than
 * a blurred illustration. No image file, same as everything else here.
 *
 * The crowd is placed with a seeded generator, so the same faces sit in the same
 * seats every time instead of shimmering on each redraw.
 */

import { TINY_H, TINY_W, kitSprites } from './sprites.js';

const ART_W = 240;
const ART_H = 166;

const SKY_TOP = '#080c26';
const SKY_LOW = '#1a2352';
const STAND_BACK = '#161b38';
const STAND_FRONT = '#20284d';
const CONCRETE = '#2c3358';
const TOWER = '#232a45';
const LAMP = '#ffe89a';
const GRASS_DARK = '#1d6b2c';
const GRASS_LIGHT = '#2b8b3c';
const SURROUND = '#14401f';
const LINE = '#e8f2e8';

const SHIRTS = ['#d33b3b', '#2f6fd0', '#f2d43c', '#e8e8e8', '#3ad07a', '#c06de0'];

// The same kits the teams wear on the pitch, so the figures below belong here.
const HOME = { shirt: '#2f6fd0', shorts: '#1b3f7a', skin: '#e8b98a', hair: '#3a2415' };
const AWAY = { shirt: '#d33b3b', shorts: '#7a1b1b', skin: '#8d5524', hair: '#221109' };
const KEEPER = { shirt: '#f2d43c', shorts: '#3a3a3a', skin: '#e8b98a', hair: '#3a2415' };

/** Same seed, same crowd, every time. */
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawScene(g) {
  const rand = rng(20260817);

  // Sky, banded rather than smoothly graded: a gradient would betray the era.
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    g.fillStyle = mix(SKY_TOP, SKY_LOW, t);
    g.fillRect(0, Math.round((i * 46) / bands), ART_W, Math.ceil(46 / bands) + 1);
  }

  // Stars, thinning out towards the floodlit part of the sky.
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * ART_W);
    const y = Math.floor(rand() * 40);
    if (rand() < y / 44) continue;
    g.fillStyle = rand() < 0.25 ? '#8f9ad0' : '#cfd8ff';
    g.fillRect(x, y, 1, 1);
  }

  // Floodlight pylons, one either side, with their glow spilling onto the sky.
  for (const x of [26, ART_W - 30]) {
    g.fillStyle = 'rgba(255, 232, 154, 0.07)';
    g.beginPath();
    g.moveTo(x + 2, 16);
    g.lineTo(x - 46, 96);
    g.lineTo(x + 50, 96);
    g.closePath();
    g.fill();

    g.fillStyle = TOWER;
    g.fillRect(x, 14, 4, 44); // mast
    for (let row = 0; row < 2; row++) {
      for (let lamp = 0; lamp < 4; lamp++) {
        g.fillStyle = LAMP;
        g.fillRect(x - 7 + lamp * 5, 8 + row * 4, 3, 3);
      }
    }
    g.fillStyle = 'rgba(255, 232, 154, 0.22)';
    g.fillRect(x - 9, 6, 22, 11);
  }

  // The far stand: two tiers, a roof line, and a crowd of single pixels.
  g.fillStyle = STAND_BACK;
  g.fillRect(0, 46, ART_W, 20);
  g.fillStyle = CONCRETE;
  g.fillRect(0, 44, ART_W, 3);
  g.fillStyle = STAND_FRONT;
  g.fillRect(0, 66, ART_W, 22);

  for (let y = 49; y < 86; y += 2) {
    for (let x = 2; x < ART_W - 2; x += 2) {
      if (rand() < 0.42) continue;
      g.fillStyle = rand() < 0.13 ? SHIRTS[Math.floor(rand() * SHIRTS.length)] : shade(rand());
      g.fillRect(x, y, 1, 1);
    }
  }

  // A dark rail between the crowd and the grass.
  g.fillStyle = CONCRETE;
  g.fillRect(0, 87, ART_W, 3);
  g.fillStyle = SURROUND;
  g.fillRect(0, 90, ART_W, 8);

  // Everything below the rail is ground, so the grass has something to sit on
  // instead of the sky showing through beside the pitch.
  g.fillStyle = SURROUND;
  g.fillRect(0, 90, ART_W, ART_H - 90);

  // The pitch, in perspective: each row is a touch wider than the one above it.
  const top = 98;
  const bottom = ART_H;
  const halfAt = (y) => 52 + ((y - top) / (bottom - top)) * 108;
  for (let y = top; y < bottom; y++) {
    const t = (y - top) / (bottom - top);
    const half = halfAt(y);
    const x0 = Math.round(ART_W / 2 - half);
    const x1 = Math.round(ART_W / 2 + half);
    // Stripes that widen as they come towards you.
    const stripe = Math.floor((t * t * 5 + t * 4) % 2);
    g.fillStyle = stripe ? GRASS_LIGHT : GRASS_DARK;
    g.fillRect(x0, y, x1 - x0, 1);
    // Touchlines, one pixel each, following the same taper.
    g.fillStyle = LINE;
    g.fillRect(x0, y, 1, 1);
    g.fillRect(x1 - 1, y, 1, 1);
  }

  // Centre circle, squashed by the perspective, and low enough to be seen: the
  // menu panel sits over the middle of the picture.
  g.strokeStyle = 'rgba(232, 242, 232, 0.85)';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(ART_W / 2, 143.5, 34, 9, 0, 0, Math.PI * 2);
  g.stroke();

  // The goal at the far end: posts, bar, and a net you can see the crowd through.
  const goalW = 30;
  const gx = Math.round(ART_W / 2 - goalW / 2);
  g.fillStyle = 'rgba(20, 30, 22, 0.45)';
  g.fillRect(gx, 88, goalW, 10);
  g.fillStyle = 'rgba(232, 242, 232, 0.4)';
  for (let x = gx; x <= gx + goalW; x += 3) g.fillRect(x, 88, 1, 10);
  for (let y = 88; y <= 98; y += 3) g.fillRect(gx, y, goalW, 1);
  g.fillStyle = LINE;
  g.fillRect(gx, 88, 1, 11); // left post
  g.fillRect(gx + goalW, 88, 1, 11); // right post
  g.fillRect(gx, 87, goalW + 1, 1); // crossbar

  // Penalty box: two lines converging towards the goal, closed off at the front.
  g.strokeStyle = 'rgba(232, 242, 232, 0.85)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(ART_W / 2 - 40, 112.5);
  g.lineTo(ART_W / 2 - 26, 98.5);
  g.moveTo(ART_W / 2 + 40, 112.5);
  g.lineTo(ART_W / 2 + 26, 98.5);
  g.moveTo(ART_W / 2 - 40, 112.5);
  g.lineTo(ART_W / 2 + 40, 112.5);
  g.stroke();

  // Six yard box, nested inside the penalty area.
  g.beginPath();
  g.moveTo(ART_W / 2 - 22, 105.5);
  g.lineTo(ART_W / 2 - 16, 98.5);
  g.moveTo(ART_W / 2 + 22, 105.5);
  g.lineTo(ART_W / 2 + 16, 98.5);
  g.moveTo(ART_W / 2 - 22, 105.5);
  g.lineTo(ART_W / 2 + 22, 105.5);
  g.stroke();

  // Penalty spot, and the halfway line running across the near half.
  g.fillStyle = LINE;
  g.fillRect(ART_W / 2, 110, 1, 1);
  for (let y = 142; y <= 144; y++) {
    const half = halfAt(y);
    g.fillRect(Math.round(ART_W / 2 - half), y, Math.round(half * 2), 1);
  }

  // Centre spot, right in the middle of that line.
  g.fillRect(ART_W / 2 - 1, 142, 3, 3);

  // Corner arcs at the near corners, where there is room to see them.
  g.strokeStyle = 'rgba(232, 242, 232, 0.7)';
  for (const side of [-1, 1]) {
    const x = ART_W / 2 + side * halfAt(ART_H - 1);
    g.beginPath();
    g.arc(x, ART_H - 1, 7, 0, Math.PI * 2);
    g.stroke();
  }

  // And the players. Small ones at the far end where the pitch is narrow, full
  // sized ones near the bottom - the same sprite the match itself draws.
  const home = kitSprites(HOME, 1, 'art-home');
  const away = kitSprites(AWAY, 1, 'art-away');
  const keeper = kitSprites(KEEPER, 1, 'art-gk');

  const tiny = [
    [keeper, ART_W / 2 + 2, 97],
    [away, ART_W / 2 - 30, 104],
    [home, ART_W / 2 + 34, 107],
    [home, ART_W / 2 - 12, 112],
    [away, ART_W / 2 + 16, 116],
  ];
  for (const [kit, x, y] of tiny) {
    g.drawImage(kit.tiny, Math.round(x - TINY_W / 2), Math.round(y - TINY_H));
  }

  // Kept clear of the middle: the menu panel covers roughly a third of the
  // picture there, and a player with his head behind it looks like a mistake.
  const near = [
    [away, 'right', 38, 158],
    [home, 'up', 62, 152],
    [home, 'down', ART_W - 62, 156],
    [away, 'left', ART_W - 34, 150],
    [home, 'right', ART_W / 2 - 24, ART_H - 4],
  ];
  for (const [kit, view, x, y] of near) {
    const sprite = kit[view];
    // A shadow under each, so nobody floats.
    g.fillStyle = 'rgba(10, 30, 15, 0.4)';
    g.fillRect(Math.round(x - 4), Math.round(y - 1), 9, 2);
    g.drawImage(sprite, Math.round(x - sprite.width / 2), Math.round(y - sprite.height));
  }

  // The ball, just ahead of the nearest player's boot.
  g.fillStyle = '#ffffff';
  g.fillRect(ART_W / 2 - 15, ART_H - 8, 3, 3);
}

function shade(r) {
  const v = 40 + Math.floor(r * 70);
  return `rgb(${v}, ${v + 6}, ${v + 22})`;
}

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

let art = null;

/** Blits the scene across the whole canvas, pixels intact. */
export function drawTitleScreen(ctx, width, height) {
  if (!art) {
    art = document.createElement('canvas');
    art.width = ART_W;
    art.height = ART_H;
    drawScene(art.getContext('2d'));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false; // the whole point: keep the pixels square
  ctx.drawImage(art, 0, 0, ART_W, ART_H, 0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
}

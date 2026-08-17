/**
 * The player, as pixel art.
 *
 * One little figure, drawn as a grid of characters and coloured per kit. The
 * same sprite is used on the pitch and in the picture behind the menu, so a team
 * looks like itself wherever you see it.
 *
 * Sprites are baked at the zoom the game runs at and then blitted at whole
 * screen pixels. Drawing them in world space instead would put their edges on
 * fractions of a pixel and the whole point - square, countable pixels - would be
 * lost to the resampler.
 */

const KEY = {
  h: 'hair',
  s: 'skin',
  S: 'shirt',
  P: 'shorts',
  b: 'boots',
  k: 'outline',
};

/**
 * Traces a dark edge around the figure. Without it the players sink into the
 * grass: a blue shirt on a green pitch at this size is mostly a smudge. Every
 * sprite artist of the era did the same thing.
 */
function outlined(grid) {
  const w = grid[0].length;
  const padded = [
    '.'.repeat(w + 2),
    ...grid.map((row) => `.${row}.`),
    '.'.repeat(w + 2),
  ];
  return padded.map((row, y) => [...row].map((cell, x) => {
    if (cell !== '.') return cell;
    const neighbours = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const touching = neighbours.some(([dx, dy]) => {
      const near = padded[y + dy]?.[x + dx];
      return near && near !== '.' && near !== 'k';
    });
    return touching ? 'k' : '.';
  }).join(''));
}

// Facing the camera: you can see a face.
const DOWN = [
  '...hhhhh...',
  '..hhhhhhh..',
  '..hsssssh..',
  '..hsssssh..',
  '...sssss...',
  '....sss....',
  '.SSSSSSSSS.',
  '.SSSSSSSSS.',
  '.SSSSSSSSS.',
  '..SSSSSSS..',
  '..PPPPPPP..',
  '..PP...PP..',
  '..ss...ss..',
  '..bb...bb..',
];

// Running away from you: the back of the head, no face.
const UP = [
  '...hhhhh...',
  '..hhhhhhh..',
  '..hhhhhhh..',
  '..hhhhhhh..',
  '...hhhhh...',
  '....sss....',
  '.SSSSSSSSS.',
  '.SSSSSSSSS.',
  '.SSSSSSSSS.',
  '..SSSSSSS..',
  '..PPPPPPP..',
  '..PP...PP..',
  '..ss...ss..',
  '..bb...bb..',
];

// In profile, one shoulder towards you.
const SIDE = [
  '...hhhh....',
  '..hhhhhh...',
  '..hsssss...',
  '..hsssss...',
  '...ssss....',
  '....ss.....',
  '..SSSSSS...',
  '.SSSSSSS...',
  '..SSSSS....',
  '..SSSSS....',
  '..PPPPP....',
  '..PP.PP....',
  '..ss.ss....',
  '..bb.bb....',
];

/** A smaller figure, for the far end of the pitch on the title screen. */
const TINY = [
  '.hhh.',
  '.sss.',
  'SSSSS',
  'SSSSS',
  '.PPP.',
  '.P.P.',
  '.b.b.',
];

function mirror(grid) {
  return grid.map((row) => [...row].reverse().join(''));
}

/** Exact for quarter turns, which is all a slide needs. */
function rotate(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const out = [];
  for (let x = 0; x < w; x++) {
    let row = '';
    for (let y = h - 1; y >= 0; y--) row += grid[y][x];
    out.push(row);
  }
  return out;
}

/** Paints one grid onto a canvas, every cell a `scale` sized square. */
function paint(grid, colours, scale) {
  const w = grid[0].length;
  const h = grid.length;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const g = canvas.getContext('2d');

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      const part = KEY[cell];
      if (!part) continue;
      g.fillStyle = colours[part];
      // Rounded on both edges, so neighbouring pixels never leave a seam.
      const x0 = Math.round(x * scale);
      const y0 = Math.round(y * scale);
      g.fillRect(x0, y0, Math.round((x + 1) * scale) - x0, Math.round((y + 1) * scale) - y0);
    }
  }
  return canvas;
}

function coloursFor(kit) {
  return {
    hair: kit.hair || '#2a1a10',
    skin: kit.skin,
    shirt: kit.shirt,
    shorts: kit.shorts,
    boots: '#15181c',
    outline: 'rgba(8, 22, 12, 0.85)',
  };
}

const cache = new Map();

/**
 * Every view of one kit, baked at `scale`. Keyed by kit and scale so the pitch
 * and the title screen can ask for different sizes.
 */
export function kitSprites(kit, scale, id) {
  const key = `${id}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const colours = coloursFor(kit);
  const make = (grid) => paint(outlined(grid), colours, scale);
  const sprites = {
    down: make(DOWN),
    up: make(UP),
    right: make(SIDE),
    left: make(mirror(SIDE)),
    tiny: make(TINY),
    // A slide is the same figure lying down, turned a quarter.
    slideRight: make(rotate(SIDE)),
    slideLeft: make(rotate(rotate(rotate(mirror(SIDE))))),
    slideUp: make(rotate(rotate(SIDE))),
    slideDown: make(SIDE.slice().reverse()),
  };
  cache.set(key, sprites);
  return sprites;
}

/** Which view to use for a heading. Four ways is what the era had, and it reads. */
export function facing(dirX, dirY) {
  if (Math.abs(dirX) > Math.abs(dirY) * 1.2) return dirX < 0 ? 'left' : 'right';
  return dirY < 0 ? 'up' : 'down';
}

export const SPRITE_W = DOWN[0].length;
export const SPRITE_H = DOWN.length;
export const TINY_W = TINY[0].length;
export const TINY_H = TINY.length;

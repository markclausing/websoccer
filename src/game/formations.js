/**
 * Line-ups.
 *
 * A line-up is eleven spots in relative coordinates: x from -1 (left touchline)
 * to 1 (right), y from 0 (your own goal line) to 1 (theirs). The first spot is
 * always the keeper. Each team carries its own, so the two sides can line up
 * differently in the same match.
 *
 * A player's role is not stored, it is read off how far up the pitch you put
 * him. Drag a midfielder forward and he stops tracking back like a midfielder
 * and starts playing like a hanging ten - which is what you meant by moving him
 * there. It also means the editor never has to ask you to label anybody.
 *
 * The bands are chosen so the original 4-3-3 comes out with exactly the roles it
 * always had: nothing about the default team changed when line-ups became a
 * choice - the whole match hashes identically.
 *
 * A warning about what these actually do. The match was balanced around that one
 * 4-3-3, and it turns out to be balanced by being stuck: with both sides playing
 * it the ball spends 93% of the match in the middle third and matches finish
 * about 4-3-3ish. Any other shape unsticks the game - two central strikers give
 * the long ball somewhere to go - and CPU against CPU the scores run away with
 * themselves: 4-4-2 flat measured 22 goals a match, 3-5-2 nearly 27.
 *
 * That is not the line-ups being wrong, it is finishing being too easy once a
 * team gets through, which the 4-3-3 hid by never getting through. Marking was
 * tried as a fix and made it worse at every strength (4-3-3 went from 4.6 goals
 * a match to 12), so it was taken out again. Against a human, who defends, the
 * shapes behave: standing still with each of them, the goals conceded run 7.1
 * for the 4-3-3, 7.5 for 5-3-2, 9.1 for 3-5-2, 9.6 for the diamond and 14.1 for
 * a flat 4-4-2 - an order that at least matches what the shapes are supposed to
 * do.
 */

/** How far each role tracks back when the other side has the ball. */
export const RETREAT = {
  gk: 1,
  df: 1,
  dm: 0.8,
  mf: 0.55,
  am: 0.4,
  fw: 0.25,
};

/** Which role a spot at this height plays. */
export function roleFor(y, index) {
  if (index === 0) return 'gk';
  if (y <= 0.26) return 'df';
  if (y <= 0.33) return 'dm';
  if (y <= 0.55) return 'mf';
  if (y <= 0.66) return 'am';
  return 'fw';
}

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/**
 * Cleans up a line-up from anywhere - a preset, the editor, localStorage, or the
 * other machine in an online match - into eleven usable spots. Anything missing
 * or out of range is replaced rather than rejected: a corrupted line-up should
 * cost you your shape, not your match.
 */
export function normaliseLineup(spots) {
  const out = [];
  for (let i = 0; i < 11; i++) {
    const s = Array.isArray(spots) ? spots[i] : null;
    const x = Number.isFinite(s?.x) ? clamp(s.x, -1, 1) : DEFAULT.spots[i].x;
    // The keeper belongs on his line, wherever the editor was dragged.
    const y = Number.isFinite(s?.y)
      ? clamp(s.y, 0, 0.97)
      : DEFAULT.spots[i].y;
    out.push({ x, y: i === 0 ? clamp(y, 0, 0.1) : y, role: roleFor(y, i) });
  }
  return out;
}

/** The shape as people say it out loud: "4-4-2", counting from the back. */
export function shapeOf(spots) {
  const bands = [0, 0, 0];
  for (let i = 1; i < spots.length; i++) {
    const { y } = spots[i];
    if (y <= 0.26) bands[0]++;
    else if (y <= 0.66) bands[1]++;
    else bands[2]++;
  }
  return bands.join('-');
}

const lineup = (rows) => rows.map(([x, y]) => ({ x, y }));

export const PRESETS = [
  {
    key: '433',
    label: '4-3-3',
    note: 'Three up front and width in attack. The line-up every other one here is measured against.',
    spots: lineup([
      [0.00, 0.025],
      [-0.62, 0.19], [-0.22, 0.13], [0.22, 0.13], [0.62, 0.19],
      [-0.45, 0.42], [0.00, 0.37], [0.45, 0.42],
      [-0.56, 0.68], [0.00, 0.76], [0.56, 0.68],
    ]),
  },
  {
    key: '442diamond',
    label: '4-4-2 diamond',
    note: 'A holding man behind, a hanging ten in front, two strikers. Narrow through the middle, so the ball has to come round the outside.',
    spots: lineup([
      [0.00, 0.025],
      [-0.62, 0.19], [-0.22, 0.13], [0.22, 0.13], [0.62, 0.19],
      [0.00, 0.32],
      [-0.42, 0.45], [0.42, 0.45],
      [0.00, 0.62],
      [-0.26, 0.78], [0.26, 0.78],
    ]),
  },
  {
    key: '442',
    label: '4-4-2 flat',
    note: 'Two banks of four. Nothing clever, and hard to play through.',
    spots: lineup([
      [0.00, 0.025],
      [-0.66, 0.18], [-0.24, 0.13], [0.24, 0.13], [0.66, 0.18],
      [-0.62, 0.44], [-0.20, 0.40], [0.20, 0.40], [0.62, 0.44],
      [-0.24, 0.72], [0.24, 0.72],
    ]),
  },
  {
    key: '352',
    label: '3-5-2',
    note: 'Wing-backs the length of the pitch and a crowded middle. Three at the back is a gamble.',
    spots: lineup([
      [0.00, 0.025],
      [-0.40, 0.15], [0.00, 0.12], [0.40, 0.15],
      [-0.70, 0.42], [0.00, 0.32], [-0.26, 0.48], [0.26, 0.48], [0.70, 0.42],
      [-0.24, 0.76], [0.24, 0.76],
    ]),
  },
  {
    key: '532',
    label: '5-3-2',
    note: 'Five across the back. You will not concede many, and you will not score many either.',
    spots: lineup([
      [0.00, 0.025],
      [-0.72, 0.22], [-0.34, 0.12], [0.00, 0.10], [0.34, 0.12], [0.72, 0.22],
      [-0.34, 0.42], [0.00, 0.38], [0.34, 0.42],
      [-0.22, 0.72], [0.22, 0.72],
    ]),
  },
];

export const DEFAULT_KEY = '433';
const DEFAULT = PRESETS[0];

export function presetFor(key) {
  return PRESETS.find((p) => p.key === key) || DEFAULT;
}

/**
 * Whatever you were given - a preset key, a line-up from the editor, or nothing
 * at all - becomes eleven spots with roles.
 */
export function lineupFrom(source) {
  if (typeof source === 'string') return normaliseLineup(presetFor(source).spots);
  if (Array.isArray(source)) return normaliseLineup(source);
  return normaliseLineup(DEFAULT.spots);
}

/** The line-up the game falls back on, with roles filled in. */
export const FORMATION = normaliseLineup(DEFAULT.spots);

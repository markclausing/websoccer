/**
 * The high score table.
 *
 * Ten per difficulty, kept in localStorage so a browser on its own needs nothing
 * at all. Every entry carries an id and the time it was set, which is what lets
 * two tables from two devices be merged later without either winning by being
 * loaded second.
 *
 * A score is a result, not a number: biggest win first, then most goals scored,
 * then whoever got there earliest. Defeats never make the table - the whole
 * point is beating the CPU - but a draw counts, because a nil-nil against HARD
 * is worth something.
 *
 * Nothing in here touches the simulation, and the store is injectable so the
 * tests can run it without a browser.
 */

/**
 * Where the table is kept, unless the game says otherwise.
 *
 * It has to be said otherwise when two games share an origin, which these two
 * do: websoccer and webtennis both live on the same github.io domain, so one
 * key would have meant tennis results landing in the football table and nobody
 * noticing until a 6-1 appeared next to a 3-0.
 */
export const KEY = 'highscores.v1';
export const LEVELS = ['easy', 'normal', 'hard'];
export const TABLE_SIZE = 10;
export const NAME_LENGTH = 3;

/** The letters you can pick from, in the order the stick cycles through them. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

const empty = () => Object.fromEntries(LEVELS.map((l) => [l, []]));

function cleanName(name) {
  const up = String(name ?? '').toUpperCase();
  let out = '';
  for (const ch of up) {
    if (ALPHABET.includes(ch) && out.length < NAME_LENGTH) out += ch;
  }
  return out.padEnd(NAME_LENGTH, '-');
}

/**
 * One row, from anywhere: our own storage, another device, or a shared board.
 * Anything unusable comes back null rather than throwing - a corrupt table
 * should cost you a row, not the page.
 */
export function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scored = Math.round(Number(raw.scored));
  const conceded = Math.round(Number(raw.conceded));
  if (!Number.isFinite(scored) || !Number.isFinite(conceded)) return null;
  if (scored < 0 || conceded < 0 || scored > 99 || conceded > 99) return null;
  if (scored < conceded) return null; // a defeat is not a high score
  const at = Number(raw.at);
  return {
    id: String(raw.id || '').slice(0, 40) || makeId(),
    name: cleanName(raw.name),
    scored,
    conceded,
    halfSeconds: Math.min(600, Math.max(1, Math.round(Number(raw.halfSeconds)) || 120)),
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
  };
}

/** Unique enough to tell two entries apart when tables are merged. */
export function makeId() {
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${Date.now().toString(36)}-${rand}`;
}

/** Biggest win first; ties go to whoever scored more, then to whoever was first. */
export function compare(a, b) {
  const margin = (b.scored - b.conceded) - (a.scored - a.conceded);
  if (margin) return margin;
  if (b.scored !== a.scored) return b.scored - a.scored;
  return a.at - b.at;
}

export function sortTable(entries) {
  return [...entries].sort(compare).slice(0, TABLE_SIZE);
}

/** Would this result get on the board? */
export function qualifies(table, entry) {
  const clean = cleanEntry(entry);
  if (!clean) return false;
  // Sorted here rather than trusted: a table that arrived from somewhere else
  // may be in any order, and asking the wrong row would let a worse result in.
  const rows = sortTable(table || []);
  if (rows.length < TABLE_SIZE) return true;
  return compare(clean, rows[rows.length - 1]) < 0;
}

/** Where a result would land, counting from 1, or 0 if it would not. */
export function placeOf(table, entry) {
  const clean = cleanEntry(entry);
  if (!clean) return 0;
  const rows = sortTable([...(table || []), clean]);
  const at = rows.findIndex((r) => r.id === clean.id);
  return at < 0 ? 0 : at + 1;
}

/**
 * Two tables into one. Same id means the same result, however many times it has
 * travelled: a board that has been round three devices must not grow three
 * copies of everything.
 */
export function merge(mine, theirs) {
  const out = empty();
  for (const level of LEVELS) {
    const seen = new Map();
    for (const raw of [...(mine?.[level] || []), ...(theirs?.[level] || [])]) {
      const entry = cleanEntry(raw);
      if (entry && !seen.has(entry.id)) seen.set(entry.id, entry);
    }
    out[level] = sortTable([...seen.values()]);
  }
  return out;
}

/**
 * A board with everything set before `since` dropped.
 *
 * This is what makes emptying the shared board stick. Wiping the server does not
 * wipe anybody's browser, and the next time one of them syncs it posts its own
 * copy straight back - which is exactly what happened the first time the board
 * was cleaned. So a cleared board remembers when it was cleared, and refuses
 * anything older. A score set before the wipe is not news any more.
 */
export function since(board, when) {
  if (!when) return merge({}, board);
  const out = {};
  for (const level of LEVELS) {
    out[level] = (board?.[level] || []).filter((row) => Number(row?.at) >= when);
  }
  return merge({}, out);
}

/** A board with these ids taken out, wherever they sit. */
export function without(board, ids) {
  const drop = new Set(ids || []);
  const out = {};
  for (const level of LEVELS) {
    out[level] = (board?.[level] || []).filter((row) => !drop.has(row?.id));
  }
  return merge({}, out);
}

export function levelOf(difficulty) {
  return LEVELS.includes(difficulty) ? difficulty : 'normal';
}

export class Highscores {
  constructor(store = globalThis.localStorage, key = KEY) {
    this.store = store;
    this.key = key;
    this.tables = this.read();
  }

  read() {
    try {
      const raw = this.store?.getItem(this.key);
      if (!raw) return empty();
      return merge(empty(), JSON.parse(raw));
    } catch {
      // Unreadable, or storage turned off. An empty board is the right answer:
      // losing the table is a shame, refusing to start the game is worse.
      return empty();
    }
  }

  write() {
    try {
      this.store?.setItem(this.key, JSON.stringify(this.tables));
    } catch { /* private mode: the table just will not stick */ }
  }

  table(difficulty) {
    return this.tables[levelOf(difficulty)] || [];
  }

  qualifies(difficulty, entry) {
    return qualifies(this.table(difficulty), entry);
  }

  /** Adds a result and returns where it landed, or 0 if it missed the board. */
  add(difficulty, entry) {
    const clean = cleanEntry(entry);
    if (!clean) return 0;
    const level = levelOf(difficulty);
    this.tables[level] = sortTable([...this.table(level), clean]);
    this.write();
    return this.tables[level].findIndex((r) => r.id === clean.id) + 1;
  }

  /** Folds in a table from somewhere else and keeps the result. */
  absorb(theirs) {
    this.tables = merge(this.tables, theirs);
    this.write();
    return this.tables;
  }

  all() {
    return this.tables;
  }
}

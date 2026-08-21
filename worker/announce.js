/**
 * What gets said in Discord when somebody makes the board.
 *
 * Kept apart from the Worker so both servers can use it and so the wording can
 * be tested without a network anywhere near it. Nothing in here talks to
 * Discord; it only decides what is news and what the message should say.
 */

import { LEVELS } from '../src/highscores.js';

/** How many results one post will mention before it just counts the rest. */
const MAX_LINES = 3;

/**
 * Which rows are new, and where they landed.
 *
 * Worked out by comparing the board before and after rather than trusting what
 * was sent: a result that did not make the top ten is not news, and the same
 * result arriving from a second device is not news either, because merging
 * matches it by id.
 */
export function newRows(before, after) {
  const rows = [];
  for (const level of LEVELS) {
    const had = new Set((before?.[level] || []).map((r) => r.id));
    const now = after?.[level] || [];
    for (let i = 0; i < now.length; i++) {
      if (!had.has(now[i].id)) rows.push({ entry: now[i], level, place: i + 1 });
    }
  }
  // Best placings first, so a post that has to cut something cuts the least
  // interesting line.
  return rows.sort((a, b) => a.place - b.place);
}

function ordinal(n) {
  if (n === 1) return 'top of the table';
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  return `number ${n}`;
}

function line({ entry, level, place }) {
  const result = `${entry.scored}-${entry.conceded}`;
  const beat = entry.scored === entry.conceded
    ? `held **${level.toUpperCase()}** to ${result}`
    : `beat **${level.toUpperCase()}** ${result}`;
  return `🏆 **${entry.name}** ${beat} — ${ordinal(place)}`;
}

/** The body of the Discord post. */
export function announcement(rows) {
  const shown = rows.slice(0, MAX_LINES).map(line);
  if (rows.length > MAX_LINES) {
    shown.push(`…and ${rows.length - MAX_LINES} more.`);
  }
  return {
    content: shown.join('\n'),
    // Names are three characters of A-Z, 0-9 and a dash, so they cannot spell a
    // mention - but a board this open should not be one webhook away from
    // pinging a whole server, whatever anybody changes later.
    allowed_mentions: { parse: [] },
  };
}

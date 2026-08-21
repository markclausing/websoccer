/**
 * What the commentator knows.
 *
 * The synthesiser next door in speech.js is generic: it will say anything you
 * spell out for it. This is the half that is about football - forty-odd words,
 * and the lines that go with the things that happen in a match.
 *
 * Split apart so the voice itself can be shared with another game without
 * dragging "throw in" and "nil" along with it.
 */

/**
 * The vocabulary, spelled the way it has to be pronounced rather than the way it
 * is written. There is no English spelling in here and there is not going to be:
 * a rule that turns "eight" into a long A is a rule with a hundred exceptions,
 * and this commentator only needs forty words.
 */
export const WORDS = {
  blue: ['B', 'L', 'UW'],
  red: ['R', 'EH', 'D'],
  nil: ['N', 'IH', 'L'],
  one: ['W', 'AH', 'N'],
  two: ['T', 'UW'],
  three: ['TH', 'R', 'IY'],
  four: ['F', 'AO', 'R'],
  five: ['F', 'AY', 'V'],
  six: ['S', 'IH', 'K', 'S'],
  seven: ['S', 'EH', 'V', 'AH', 'N'],
  eight: ['EY', 'T'],
  nine: ['N', 'AY', 'N'],
  ten: ['T', 'EH', 'N'],
  eleven: ['IH', 'L', 'EH', 'V', 'AH', 'N'],
  twelve: ['T', 'W', 'EH', 'L', 'V'],
  a: ['AH'],
  against: ['AH', 'G', 'EH', 'N', 'S', 'T'],
  all: ['AO', 'L'],
  and: ['AH', 'N', 'D'],
  away: ['AH', 'W', 'EY'],
  corner: ['K', 'AO', 'R', 'N', 'ER'],
  for: ['F', 'AO', 'R'],
  full: ['F', 'UH', 'L'],
  go: ['G', 'OW'],
  goal: ['G', 'OW', 'L'],
  good: ['G', 'UH', 'D'],
  great: ['G', 'R', 'EY', 'T'],
  half: ['HH', 'AE', 'F'],
  here: ['HH', 'IY', 'R'],
  hes: ['HH', 'IY', 'Z'],
  in: ['IH', 'N'],
  its: ['IH', 'T', 'S'],
  kick: ['K', 'IH', 'K'],
  level: ['L', 'EH', 'V', 'AH', 'L'],
  on: ['AA', 'N'],
  run: ['R', 'AH', 'N'],
  save: ['S', 'EY', 'V'],
  saved: ['S', 'EY', 'V', 'D'],
  thats: ['DH', 'AE', 'T', 'S'],
  throw: ['TH', 'R', 'OW'],
  time: ['T', 'AY', 'M'],
  we: ['W', 'IY'],
  what: ['W', 'AH', 'T'],
};

const NUMBERS = [
  'nil', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/** How a scoreline is read out: "blue two, red nil". */
export function scoreWords(score) {
  if (score[0] > 12 || score[1] > 12) return ''; // past twelve, say nothing
  return `blue ${NUMBERS[score[0]]} red ${NUMBERS[score[1]]}`;
}

/**
 * What he says, and when. Short on purpose: two or three words read clearly,
 * a sentence turns to mush.
 */
export const LINES = {
  goal: ['goal', 'what a goal', 'its in'],
  save: ['saved', 'what a save', 'great save'],
  run: ['hes away', 'go on', 'what a run'],
  start: ['blue against red', 'here we go'],
  fulltime: ['thats full time', 'full time'],
};

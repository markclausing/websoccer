/**
 * The commentator, made out of filters.
 *
 * Not the browser's speech synthesis: that sounds like a phone assistant, it
 * differs per machine, and half the point of a game that draws its own pixels
 * and plays its own music is that it makes its own noises too. This is formant
 * synthesis, which is roughly what the speech chips of the era did - a buzzing
 * source through a few sharp resonances, and the resonances are the vowel.
 *
 * A voiced sound is a sawtooth at about a hundred hertz through three bandpass
 * filters. Where those three filters sit is the difference between "ee" and
 * "ah"; sliding them from one place to another is a diphthong or a glide. An
 * unvoiced sound is noise through one filter, and a plosive is a moment of
 * silence followed by a click.
 *
 * It will never be mistaken for a person, which is the idea. Keep the phrases
 * short: two or three words read clearly, a sentence turns to mush.
 */

/**
 * Formants in hertz, and how long each sound lasts.
 *
 * `to` is where the formants slide to, which is what makes a diphthong. `noise`
 * is an unvoiced sound and the number is where the hiss sits. `stop` is a
 * plosive: a closure, then a burst.
 */
const PHONEMES = {
  // Vowels
  IY: { f: [280, 2250, 2900], dur: 0.13 },
  IH: { f: [400, 1900, 2550], dur: 0.10 },
  EH: { f: [530, 1840, 2480], dur: 0.12 },
  AE: { f: [660, 1720, 2410], dur: 0.14 },
  AH: { f: [640, 1190, 2390], dur: 0.10 },
  AA: { f: [730, 1090, 2440], dur: 0.15 },
  AO: { f: [570, 840, 2410], dur: 0.15 },
  UW: { f: [300, 870, 2240], dur: 0.13 },
  UH: { f: [440, 1020, 2240], dur: 0.10 },
  ER: { f: [490, 1350, 1690], dur: 0.14 },
  // Diphthongs: the same thing, moving.
  EY: { f: [530, 1840, 2480], to: [300, 2200, 2900], dur: 0.19 },
  OW: { f: [570, 840, 2410], to: [330, 800, 2300], dur: 0.19 },
  AY: { f: [730, 1090, 2440], to: [300, 2200, 2900], dur: 0.21 },
  // Voiced continuants
  L: { f: [360, 1300, 2700], dur: 0.09 },
  R: { f: [420, 1300, 1600], dur: 0.09 },
  W: { f: [300, 610, 2200], to: [500, 1000, 2300], dur: 0.08 },
  Y: { f: [280, 2250, 2900], to: [500, 1700, 2500], dur: 0.07 },
  M: { f: [250, 1100, 2200], dur: 0.09, level: 0.5 },
  N: { f: [250, 1700, 2600], dur: 0.09, level: 0.5 },
  // Unvoiced
  S: { noise: 5200, q: 6, dur: 0.11 },
  SH: { noise: 2600, q: 3, dur: 0.12 },
  F: { noise: 4000, q: 1.5, dur: 0.10, level: 0.5 },
  HH: { noise: 1400, q: 0.8, dur: 0.07, level: 0.4 },
  TH: { noise: 4600, q: 2, dur: 0.09, level: 0.4 },
  // Voiced fricatives: hiss and buzz at once.
  V: { f: [300, 1100, 2400], noise: 2400, q: 2, dur: 0.09, level: 0.6 },
  DH: { f: [300, 1400, 2500], noise: 3800, q: 2, dur: 0.07, level: 0.5 },
  Z: { f: [280, 1600, 2500], noise: 4600, q: 5, dur: 0.10, level: 0.6 },
  // Plosives
  T: { stop: 0.045, burst: 3600, q: 2, dur: 0.03 },
  K: { stop: 0.05, burst: 2200, q: 2, dur: 0.035 },
  P: { stop: 0.045, burst: 1200, q: 1.5, dur: 0.03 },
  D: { stop: 0.035, burst: 2800, q: 2, dur: 0.025, voiced: true },
  G: { stop: 0.04, burst: 1700, q: 2, dur: 0.03, voiced: true },
  B: { stop: 0.035, burst: 900, q: 1.5, dur: 0.025, voiced: true },
  // A gap between words.
  _: { silence: true, dur: 0.07 },
};

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

/** Words to phonemes, with a gap where the spaces are. */
export function phrase(text) {
  const out = [];
  for (const word of String(text).toLowerCase().split(/\s+/)) {
    const sounds = WORDS[word];
    if (!sounds) continue; // a word he has not been taught is simply not said
    if (out.length) out.push('_');
    out.push(...sounds);
  }
  return out;
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

/** Roughly a man's voice, and flat: this is a chip, not a person. */
const PITCH = 96;
const FORMANT_Q = 9;

export class Speech {
  constructor(engine) {
    this.engine = engine;
    this.level = 0.5;
    this.pick = 0;
  }

  /**
   * Says one of the lines for `event`. Returns the number of nodes it built, so
   * a test can tell the difference between speaking and silence.
   *
   * Variants are taken in turn rather than at random: hearing "GOAL" three times
   * running is worse than any of the alternatives, and nothing here may reach
   * for Math.random anyway - this runs outside the simulation, but the habit is
   * worth keeping.
   */
  say(event, at = 0) {
    const lines = LINES[event];
    if (!lines || !this.engine.ctx) return 0;
    const line = lines[this.pick % lines.length];
    this.pick++;
    return this.line(line, at);
  }

  /** Says any sentence built from the vocabulary. */
  line(text, at = 0) {
    const sounds = phrase(text);
    return sounds.length ? this.speak(sounds, at) : 0;
  }

  /** Schedules one phoneme sequence. */
  speak(phonemes, at = 0) {
    const { ctx, master } = this.engine;
    if (!ctx) return 0;
    const start = Math.max(ctx.currentTime, at || ctx.currentTime) + 0.02;
    const total = phonemes.reduce((sum, p) => sum + (PHONEMES[p]?.dur || 0.1), 0) + 0.2;

    // One voice and one hiss for the whole phrase, with everything about them
    // automated over time. Building a node per sound would click at every join.
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(PITCH, start);
    // A flat delivery with the pitch falling away at the end, which is the least
    // a sentence needs to sound like a sentence.
    voice.frequency.linearRampToValueAtTime(PITCH * 0.88, start + total);

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, start);

    const bands = [0, 1, 2].map((i) => {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = FORMANT_Q - i * 2;
      band.frequency.setValueAtTime(500, start);
      voiceGain.connect(band).connect(master);
      return band;
    });
    voice.connect(voiceGain);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.engine.longNoise;
    hiss.loop = true;
    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.setValueAtTime(4000, start);
    hissBand.Q.value = 3;
    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0, start);
    hiss.connect(hissBand).connect(hissGain).connect(master);

    let t = start;
    let nodes = 6;
    for (const name of phonemes) {
      const ph = PHONEMES[name];
      if (!ph) continue;
      const level = (ph.level ?? 1) * this.level;

      if (ph.silence) {
        voiceGain.gain.setTargetAtTime(0, t, 0.01);
        hissGain.gain.setTargetAtTime(0, t, 0.01);
        t += ph.dur;
        continue;
      }

      if (ph.stop) {
        // A plosive is mostly the silence in front of it.
        voiceGain.gain.setTargetAtTime(0, t, 0.008);
        hissGain.gain.setTargetAtTime(0, t, 0.008);
        t += ph.stop;
        hissBand.frequency.setValueAtTime(ph.burst, t);
        hissBand.Q.setValueAtTime(ph.q || 2, t);
        hissGain.gain.setValueAtTime(0.7 * this.level, t);
        hissGain.gain.exponentialRampToValueAtTime(0.0001, t + ph.dur);
        if (ph.voiced) {
          voiceGain.gain.setValueAtTime(0.25 * this.level, t);
        }
        t += ph.dur;
        nodes++;
        continue;
      }

      if (ph.f) {
        for (let i = 0; i < 3; i++) {
          bands[i].frequency.linearRampToValueAtTime(ph.f[i], t + 0.03);
          if (ph.to) bands[i].frequency.linearRampToValueAtTime(ph.to[i], t + ph.dur);
        }
        voiceGain.gain.setTargetAtTime(level, t, 0.012);
      } else {
        voiceGain.gain.setTargetAtTime(0, t, 0.012);
      }

      if (ph.noise) {
        hissBand.frequency.setValueAtTime(ph.noise, t);
        hissBand.Q.setValueAtTime(ph.q || 3, t);
        hissGain.gain.setTargetAtTime(level * 0.6, t, 0.012);
      } else {
        hissGain.gain.setTargetAtTime(0, t, 0.012);
      }

      t += ph.dur;
      nodes++;
    }

    // Let the last sound fall away rather than stopping dead.
    voiceGain.gain.setTargetAtTime(0, t, 0.03);
    hissGain.gain.setTargetAtTime(0, t, 0.03);
    voice.start(start);
    voice.stop(t + 0.2);
    hiss.start(start);
    hiss.stop(t + 0.2);
    return nodes;
  }
}

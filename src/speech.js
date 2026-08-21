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
 *
 * Shared verbatim with webtennis: the words live in a separate file per game,
 * and tools/sync-shared.js checks the two copies of this one have not drifted.
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
  AW: { f: [730, 1090, 2440], to: [300, 870, 2240], dur: 0.21 },
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
  // Affricates: a stop and a hiss run together, which is what "ch" and "j" are.
  CH: { stop: 0.04, burst: 2600, q: 3, dur: 0.11, locus: [350, 1800, 2500] },
  JH: { stop: 0.03, burst: 2400, q: 3, dur: 0.10, voiced: true, locus: [300, 1800, 2500] },
  // Plosives. `locus` is where the formants sit at the moment the mouth opens:
  // the vowel then slides away from there, and that slide is most of what tells
  // a "b" from a "d". Without it every stop sounds like the same click.
  T: { stop: 0.045, burst: 3600, q: 2, dur: 0.03, locus: [400, 1700, 2600] },
  K: { stop: 0.05, burst: 2200, q: 2, dur: 0.035, locus: [300, 2100, 2600] },
  P: { stop: 0.045, burst: 1200, q: 1.5, dur: 0.03, locus: [300, 800, 2200] },
  D: { stop: 0.035, burst: 2800, q: 2, dur: 0.025, voiced: true, locus: [350, 1700, 2600] },
  G: { stop: 0.04, burst: 1700, q: 2, dur: 0.03, voiced: true, locus: [300, 2000, 2600] },
  B: { stop: 0.035, burst: 900, q: 1.5, dur: 0.025, voiced: true, locus: [300, 800, 2200] },
  // A gap between words.
  _: { silence: true, dur: 0.07 },
};

/** Words to phonemes, with a gap where the spaces are. */
export function phrase(text, words) {
  const out = [];
  for (const word of String(text).toLowerCase().split(/\s+/)) {
    const sounds = words[word];
    if (!sounds) continue; // a word he has not been taught is simply not said
    if (out.length) out.push('_');
    out.push(...sounds);
  }
  return out;
}

/**
 * The voice.
 *
 * A flat pitch is the thing that says "robot" loudest, so this one moves: it
 * starts a little above the baseline, drifts down across the phrase the way an
 * unhurried sentence does, lifts on the first vowel of each word, and falls away
 * at the end. On top of that there is a small wobble, because a pitch that is
 * exactly steady between two accents is a pitch no throat ever produced.
 */
const PITCH = 118;
const RISE = 1.06; // on the first vowel of a word
const DECLINE = 0.82; // where the phrase ends up by the end
const WOBBLE = 0.05;

/**
 * Formant bandwidths in hertz rather than a fixed Q. A filter's Q is its centre
 * frequency divided by its bandwidth, so one Q for all three makes the upper
 * formants far too broad - which smears the vowel and is a good part of why this
 * sounded like a machine. Real formants are narrow at the bottom and wider up
 * top, roughly this.
 */
const BANDWIDTH = [60, 90, 150, 220];

/** A fourth resonance, fixed. Voices have one; it is what stops it sounding thin. */
const FORMANT_4 = 3300;

/**
 * A glottal pulse, near enough.
 *
 * The vocal folds themselves roll off at about 12 dB an octave, but the sound
 * leaving the lips is closer to the derivative of that, which puts 6 dB back -
 * which is why a plain sawtooth works at all. Building the source at 1/n squared
 * and stopping there was tried, and measurably starved the second formant, the
 * one that carries most of the vowel: the spectrum showed the low harmonics and
 * nothing where the vowel lives.
 *
 * So: 1/n, the sawtooth slope, with the very top harmonics faded out. That last
 * part is the buzz, and it is the part a throat does not have.
 */
function glottalWave(ctx, harmonics = 40) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) imag[n] = (1 / n) * Math.exp(-n / 18);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * How far the pitch wanders, in hertz. No throat holds a note: a voice that is
 * perfectly steady between two accents is the last thing that still sounds
 * synthetic once the contour is right.
 */
const FLUTTER = 5;
const VIBRATO = 2.6;

/** The same idea applied to loudness, which also never holds still. */
const SHIMMER = 0.13;

/**
 * How fast he talks, and how much shorter the unstressed syllables are.
 *
 * Evenly spaced syllables are as mechanical as a flat pitch. English throws away
 * most of the length of anything it is not stressing, and keeping every vowel
 * the same length is a good part of what made this sound counted out rather than
 * spoken.
 */
const RATE = 1.18;
const UNSTRESSED = 0.86;

export class Speech {
  /**
   * @param engine the shared AudioEngine.
   * @param vocabulary `{ WORDS, LINES }` for whichever game this is. The
   *   synthesiser has no opinion about either: one game says "throw in for red"
   *   and another says "advantage", and none of that belongs in here.
   */
  constructor(engine, vocabulary = {}) {
    this.engine = engine;
    this.words = vocabulary.WORDS || {};
    this.lines = vocabulary.LINES || {};
    // Narrow formants pass less energy than wide ones, so this is louder than
    // it looks: measured, a line peaks at about a quarter of full scale.
    // Measured against the rest of the mix rather than guessed: at this level a
    // spoken line carries about five times the crowd's energy, which is what it
    // takes to be heard over a goal, and still peaks a long way short of
    // clipping.
    this.level = 1.4;
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
    const lines = this.lines[event];
    if (!lines || !this.engine.ctx) return 0;
    const line = lines[this.pick % lines.length];
    this.pick++;
    return this.line(line, at);
  }

  /** Says any sentence built from the vocabulary. */
  line(text, at = 0) {
    const sounds = phrase(text, this.words);
    return sounds.length ? this.speak(sounds, at) : 0;
  }

  /**
   * Schedules one phoneme sequence.
   *
   * Everything is automated on a handful of long-lived nodes rather than built
   * per sound: a node per phoneme clicks at every join, and the joins are where
   * speech lives. The voice is a sawtooth softened by a lowpass - a raw one
   * buzzes - with a breath of noise mixed in, because a completely noiseless
   * voice is the other half of sounding synthetic.
   */
  speak(phonemes, at = 0) {
    const { ctx, master } = this.engine;
    if (!ctx) return 0;
    const start = Math.max(ctx.currentTime, at || ctx.currentTime) + 0.02;
    const sounds = phonemes.map((name) => PHONEMES[name]).filter(Boolean);
    const total = sounds.reduce((sum, ph) => sum + ph.dur, 0);

    // --- The voice ----------------------------------------------------------
    const voice = ctx.createOscillator();
    if (!this.wave) this.wave = glottalWave(ctx);
    voice.setPeriodicWave(this.wave);
    voice.frequency.setValueAtTime(PITCH * RISE, start);

    // Wander: slow noise into the pitch, so no two periods are the same length.
    const flutter = ctx.createBufferSource();
    flutter.buffer = this.engine.longNoise;
    flutter.loop = true;
    const slow = ctx.createBiquadFilter();
    slow.type = 'lowpass';
    slow.frequency.value = 18;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = FLUTTER * 40; // the filter takes most of this away
    flutter.connect(slow).connect(flutterDepth).connect(voice.frequency);

    // And the small regular sway a held vowel has.
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = VIBRATO;
    vibrato.connect(vibratoDepth).connect(voice.frequency);

    // A gentle lowpass on the source, which is roughly what a throat does to a
    // glottal pulse: without it the sawtooth's top end is a buzz.
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 3200;
    soften.Q.value = 0.7;

    // Breath: a little noise riding along with the voice.
    const breath = ctx.createBufferSource();
    breath.buffer = this.engine.longNoise;
    breath.loop = true;
    const breathLevel = ctx.createGain();
    breathLevel.gain.value = 0.06;

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, start);
    voice.connect(soften).connect(voiceGain);
    breath.connect(breathLevel).connect(voiceGain);

    // Loudness wanders as well as pitch. Same slow noise, a different parameter.
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = this.engine.longNoise;
    shimmer.loop = true;
    const shimmerSlow = ctx.createBiquadFilter();
    shimmerSlow.type = 'lowpass';
    shimmerSlow.frequency.value = 12;
    const shimmerDepth = ctx.createGain();
    shimmerDepth.gain.value = SHIMMER * 40;
    shimmer.connect(shimmerSlow).connect(shimmerDepth).connect(voiceGain.gain);

    // Four resonances. Where the first three sit is the vowel; the fourth is
    // fixed and only there to stop the voice sounding thin.
    const bands = [0, 1, 2, 3].map((i) => {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(i === 3 ? FORMANT_4 : 500, start);
      band.Q.setValueAtTime((i === 3 ? FORMANT_4 : 500) / BANDWIDTH[i], start);
      const level = ctx.createGain();
      level.gain.value = [1, 0.7, 0.4, 0.2][i];
      voiceGain.connect(band).connect(level).connect(master);
      return band;
    });

    // --- The hiss, for consonants -------------------------------------------
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.engine.longNoise;
    hiss.loop = true;
    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.setValueAtTime(4000, start);
    hissBand.Q.setValueAtTime(3, start);
    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0, start);
    hiss.connect(hissBand).connect(hissGain).connect(master);

    // --- Say it -------------------------------------------------------------
    const setFormants = (f, when, glide) => {
      for (let i = 0; i < 3; i++) {
        if (glide > 0) bands[i].frequency.linearRampToValueAtTime(f[i], when + glide);
        else bands[i].frequency.setValueAtTime(f[i], when);
        bands[i].Q.setValueAtTime(f[i] / BANDWIDTH[i], when);
      }
    };

    let t = start;
    let nodes = 15;
    let sinceWordStart = 0;
    let carriedLocus = null;
    const lastVowel = phonemes.reduce((last, name, k) => (PHONEMES[name]?.f && !PHONEMES[name]?.stop ? k : last), -1);
    for (let i = 0; i < phonemes.length; i++) {
      const ph = PHONEMES[phonemes[i]];
      if (!ph) continue;
      const level = (ph.level ?? 1) * this.level;
      const through = (t - start) / Math.max(total, 0.001);
      // Speech slows into a full stop, and hurries over anything unstressed.
      const stressed = sinceWordStart === 0;
      const dur = ph.dur * RATE
        * (i === lastVowel ? 1.4 : 1)
        * (ph.f && !stressed && i !== lastVowel ? UNSTRESSED : 1);

      // Pitch: down across the phrase, up on the first vowel of a word, and
      // never quite still.
      if (ph.f && !ph.stop) {
        const accent = sinceWordStart === 0 ? RISE : 1;
        const wobble = 1 + WOBBLE * Math.sin(i * 2.4);
        const target = PITCH * (1 - (1 - DECLINE) * through) * accent * wobble;
        voice.frequency.linearRampToValueAtTime(target, t + dur * 0.6);
        sinceWordStart++;
      }

      if (ph.silence) {
        voiceGain.gain.setTargetAtTime(0, t, 0.012);
        hissGain.gain.setTargetAtTime(0, t, 0.012);
        t += dur;
        sinceWordStart = 0;
        continue;
      }

      if (ph.stop) {
        voiceGain.gain.setTargetAtTime(0, t, 0.008);
        hissGain.gain.setTargetAtTime(0, t, 0.008);
        t += ph.stop;
        hissBand.frequency.setValueAtTime(ph.burst, t);
        hissBand.Q.setValueAtTime(ph.q || 2, t);
        hissGain.gain.setValueAtTime(0.6 * this.level, t);
        hissGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        if (ph.locus) setFormants(ph.locus, t, 0);
        if (ph.voiced) voiceGain.gain.setValueAtTime(0.2 * this.level, t);
        // The vowel after this one starts from the locus and slides away.
        carriedLocus = ph.locus || null;
        t += dur;
        nodes++;
        continue;
      }

      if (ph.f) {
        // A slide rather than a jump. Coming out of a stop it is slower still,
        // because that slide is the consonant.
        const glide = carriedLocus ? 0.055 : 0.035;
        setFormants(ph.f, t, glide);
        if (ph.to) {
          for (let k = 0; k < 3; k++) {
            bands[k].frequency.linearRampToValueAtTime(ph.to[k], t + dur);
            bands[k].Q.setValueAtTime(ph.to[k] / BANDWIDTH[k], t + dur);
          }
        }
        // Vowels swell and fall away instead of sitting at one level.
        voiceGain.gain.setTargetAtTime(level, t, 0.02);
        voiceGain.gain.setTargetAtTime(level * 0.8, t + dur * 0.6, 0.05);
        carriedLocus = null;
      } else {
        voiceGain.gain.setTargetAtTime(0, t, 0.015);
      }

      if (ph.noise) {
        hissBand.frequency.setValueAtTime(ph.noise, t);
        hissBand.Q.setValueAtTime(ph.q || 3, t);
        hissGain.gain.setTargetAtTime(level * 0.5, t, 0.015);
      } else {
        hissGain.gain.setTargetAtTime(0, t, 0.015);
      }

      t += dur;
      nodes++;
    }

    // Fall away at the end rather than stopping dead, and take the pitch with it.
    voice.frequency.linearRampToValueAtTime(PITCH * DECLINE * 0.94, t + 0.08);
    voiceGain.gain.setTargetAtTime(0, t, 0.04);
    hissGain.gain.setTargetAtTime(0, t, 0.03);
    voice.start(start);
    voice.stop(t + 0.3);
    vibrato.start(start);
    vibrato.stop(t + 0.3);
    flutter.start(start);
    flutter.stop(t + 0.3);
    shimmer.start(start);
    shimmer.stop(t + 0.3);
    breath.start(start);
    breath.stop(t + 0.3);
    hiss.start(start);
    hiss.stop(t + 0.3);
    return nodes;
  }
}

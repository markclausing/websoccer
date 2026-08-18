/**
 * The title tune: an original chiptune, synthesised in the browser.
 *
 * Nothing is loaded - there is no audio file. A pulse wave carries the melody, a
 * second one runs a fast arpeggio underneath it, a triangle plays the bass and
 * filtered noise does the drums. That is how the sound chips of the era worked,
 * and it keeps the whole thing at a few kilobytes of source with no dependency
 * and no build step, in keeping with the rest of the project.
 *
 * The style is the bouncy minor-key march those football games opened with. The
 * melody itself is written here, not copied from any of them.
 */

const BPM = 150;
const STEP = 60 / BPM / 4; // one sixteenth note, in seconds
const BARS = 8;
const STEPS_PER_BAR = 16;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'A4' -> 440. Sharps as in 'F#4'. */
export function noteFreq(name) {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) return 0;
  const midi = SEMITONES[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((midi - 69) / 12);
}

// Am - F - C - G, twice. Old, obvious, and it lifts every time.
const CHORDS = [
  { bass: 'A2', notes: ['A3', 'C4', 'E4'] },
  { bass: 'F2', notes: ['F3', 'A3', 'C4'] },
  { bass: 'C3', notes: ['C3', 'E3', 'G3'] },
  { bass: 'G2', notes: ['G3', 'B3', 'D4'] },
  { bass: 'A2', notes: ['A3', 'C4', 'E4'] },
  { bass: 'F2', notes: ['F3', 'A3', 'C4'] },
  { bass: 'C3', notes: ['C3', 'E3', 'G3'] },
  { bass: 'G2', notes: ['G3', 'B3', 'D4'] },
];

// Eight eighth-notes per bar, one bar per chord. A dash is a rest.
const MELODY = [
  ['E5', 'A5', 'C6', 'B5', 'A5', 'G5', 'E5', '-'],
  ['F5', 'A5', 'C6', 'A5', 'G5', 'F5', 'D5', '-'],
  ['E5', 'G5', 'C6', 'B5', 'C6', 'G5', 'E5', '-'],
  ['D5', 'G5', 'B5', 'D6', 'B5', 'G5', 'D5', '-'],
  ['A5', 'C6', 'E6', 'D6', 'C6', 'B5', 'A5', '-'],
  ['C6', 'A5', 'F5', 'A5', 'C6', 'F6', 'E6', '-'],
  ['G5', 'C6', 'E6', 'G6', 'E6', 'C6', 'G5', '-'],
  ['D6', 'B5', 'G5', 'F5', 'E5', 'D5', 'E5', '-'],
];

/** Per sixteenth: what the lead, arpeggio, bass and drums do. */
function buildTrack() {
  const lead = new Array(TOTAL_STEPS).fill(null);
  const arp = new Array(TOTAL_STEPS).fill(null);
  const bass = new Array(TOTAL_STEPS).fill(null);
  const drum = new Array(TOTAL_STEPS).fill(null);

  for (let bar = 0; bar < BARS; bar++) {
    const chord = CHORDS[bar];
    const phrase = MELODY[bar];

    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const i = bar * STEPS_PER_BAR + step;

      // Melody on the eighths.
      if (step % 2 === 0) {
        const note = phrase[step / 2];
        if (note !== '-') lead[i] = { freq: noteFreq(note), dur: STEP * 1.8 };
      }

      // Arpeggio cycling the chord on every sixteenth: the trick that made
      // three voices sound like a full band.
      arp[i] = { freq: noteFreq(chord.notes[step % chord.notes.length]), dur: STEP * 0.9 };

      // Bass on the eighths, dropping to the fifth halfway through the bar.
      if (step % 2 === 0) {
        const root = noteFreq(chord.bass);
        bass[i] = { freq: step >= 8 && step % 4 === 0 ? root * 1.5 : root, dur: STEP * 1.7 };
      }

      // Kick on one and three, snare on two and four, hats on the eighths.
      if (step === 0 || step === 8) drum[i] = 'kick';
      else if (step === 4 || step === 12) drum[i] = 'snare';
      else if (step % 2 === 0) drum[i] = 'hat';
    }
  }
  return { lead, arp, bass, drum, steps: TOTAL_STEPS, step: STEP };
}

export const TRACK = buildTrack();

/** A pulse wave of the given duty cycle, which is what gives it the bite. */
function pulseWave(ctx, duty, harmonics = 24) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
  }
  return ctx.createPeriodicWave(real, imag);
}

/**
 * One audio context shared by the tune and the effects. They have to share it:
 * the tune suspends nothing when it stops, or the whistle would go with it, and
 * browsers hand out a limited number of contexts.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** Browsers only allow this from a click or a key press. */
  wake() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return null; // no Web Audio: the game is perfectly playable in silence
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this.leadWave = pulseWave(this.ctx, 0.25);
      this.arpWave = pulseWave(this.ctx, 0.125);
      this.noise = this.makeNoise(0.4);
      this.longNoise = this.makeNoise(3.2); // the crowd needs something to roar with
    }
    this.ctx.resume?.();
    return this.ctx;
  }

  makeNoise(seconds) {
    const frames = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A plain tone with a hard attack and a quick decay. */
  tone(freq, at, dur, wave, level) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (typeof wave === 'string') osc.type = wave;
    else osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    return osc;
  }

  /** Filtered noise: everything percussive here is made of this. */
  noiseBurst(at, { freq, q = 1, dur, level, sweepTo = null, long = false, type = 'bandpass' }) {
    const src = this.ctx.createBufferSource();
    src.buffer = long ? this.longNoise : this.noise;
    if (long) src.loop = true;
    const band = this.ctx.createBiquadFilter();
    band.type = type;
    band.frequency.setValueAtTime(freq, at);
    band.Q.value = q;
    if (sweepTo) band.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.04, dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(band).connect(gain).connect(this.master);
    src.start(at);
    src.stop(at + dur + 0.05);
    return gain;
  }
}

export class Chiptune {
  constructor(engine) {
    this.engine = engine;
    this.playing = false;
    this.timer = null;
    this.stepIndex = 0;
    this.nextStepTime = 0;
  }

  start() {
    if (this.playing) return;
    if (!this.engine.wake()) return;
    this.ctx = this.engine.ctx;
    this.master = this.engine.master;
    this.leadWave = this.engine.leadWave;
    this.arpWave = this.engine.arpWave;
    this.noise = this.engine.noise;
    this.playing = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    // Two clocks: a coarse timer that keeps topping up what the audio clock,
    // which is the accurate one, is going to play next.
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Deliberately not suspending the context: the whistle and the crowd carry
    // on through it once the match has started.
  }

  toggle(on) {
    if (on) this.start();
    else this.stop();
  }

  schedule() {
    if (!this.playing) return;
    const lookahead = 0.25;
    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      this.playStep(this.stepIndex, this.nextStepTime);
      this.nextStepTime += TRACK.step;
      this.stepIndex = (this.stepIndex + 1) % TRACK.steps;
    }
  }

  playStep(i, at) {
    const lead = TRACK.lead[i];
    if (lead) this.tone(lead.freq, at, lead.dur, this.leadWave, 0.30);

    const arp = TRACK.arp[i];
    if (arp) this.tone(arp.freq, at, arp.dur, this.arpWave, 0.09);

    const bass = TRACK.bass[i];
    if (bass) this.tone(bass.freq, at, bass.dur, 'triangle', 0.42);

    const drum = TRACK.drum[i];
    if (drum === 'kick') this.kick(at);
    else if (drum === 'snare') this.hit(at, 1400, 0.16, 0.28);
    else if (drum === 'hat') this.hit(at, 7000, 0.04, 0.07);
  }

  tone(freq, at, dur, wave, level) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (typeof wave === 'string') osc.type = wave;
    else osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, at);
    // Hard on, quick decay: no envelope knobs on those chips either.
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  kick(at) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(0.6, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.16);
  }

  hit(at, freq, dur, level) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(band).connect(gain).connect(this.master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

/**
 * Match sounds, built from the same two ingredients as the tune: a tone and a
 * band of noise. Nothing here is a recording.
 */
export class Sfx {
  constructor(engine) {
    this.engine = engine;
    this.lastCheer = -99;
    this.lastWhistle = -99;
  }

  get ctx() {
    return this.engine.ctx;
  }

  ready() {
    return !!this.engine.ctx && this.engine.enabled;
  }

  /**
   * The referee. A pea whistle is two close tones beating against each other
   * with the pea rattling on top, which is the wobble.
   */
  whistle(kind = 'start') {
    if (!this.ready()) return;
    // A second guard, in case anything ever asks for a whistle repeatedly: three
    // blasts run to 0.8s, and nothing may start another inside a second.
    const now = this.ctx.currentTime;
    if (now - this.lastWhistle < 1) return;
    this.lastWhistle = now;

    const blasts = kind === 'end' ? [0, 0.28, 0.56] : kind === 'half' ? [0, 0.28] : [0];
    const length = kind === 'restart' ? 0.16 : 0.24;
    for (const offset of blasts) {
      const at = now + offset;
      for (const freq of [2650, 2720]) { // two tones, so they beat
        const osc = this.engine.tone(freq, at, length, 'sine', 0.16);
        // The rattle: a fast wobble in pitch rather than a clean note.
        const lfo = this.ctx.createOscillator();
        const depth = this.ctx.createGain();
        lfo.frequency.value = 34;
        depth.gain.value = 110;
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(at);
        lfo.stop(at + length + 0.02);
      }
      this.engine.noiseBurst(at, { freq: 2600, q: 6, dur: length, level: 0.05 });
    }
  }

  /** Boot on ball: a click of leather over a short thump. */
  kick(power) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime;
    const hardness = Math.min(1, power / 1100);
    this.engine.noiseBurst(at, { freq: 900 + hardness * 900, q: 1.2, dur: 0.05, level: 0.16 + hardness * 0.2 });
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(210, at);
    osc.frequency.exponentialRampToValueAtTime(60, at + 0.08);
    gain.gain.setValueAtTime(0.25 + hardness * 0.25, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    osc.connect(gain).connect(this.engine.master);
    osc.start(at);
    osc.stop(at + 0.11);
  }

  /** Studs through grass: a bright hiss sliding down to a scrape. */
  slide() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime;
    this.engine.noiseBurst(at, { freq: 3200, q: 0.8, dur: 0.42, level: 0.15, sweepTo: 420 });
  }

  /**
   * The crowd. A wall of noise around the frequencies a voice sits in, swelling
   * and falling away, with a second band on top for the edge of a roar.
   */
  cheer() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastCheer < 1.5) return; // no stacking on a scramble
    this.lastCheer = now;

    const body = this.engine.noiseBurst(now, { freq: 700, q: 0.7, dur: 2.6, level: 0.30, long: true });
    body.gain.cancelScheduledValues(now);
    body.gain.setValueAtTime(0.0001, now);
    body.gain.exponentialRampToValueAtTime(0.30, now + 0.35); // the intake of breath
    body.gain.setValueAtTime(0.30, now + 0.9);
    body.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);

    this.engine.noiseBurst(now + 0.1, { freq: 1900, q: 1.1, dur: 1.9, level: 0.13, long: true });
  }

  /** Everything the simulation reported this frame. */
  play(events) {
    if (!this.ready()) return;
    let kicked = false;
    for (const e of events) {
      if (e.type === 'goal') this.cheer();
      else if (e.type === 'whistle') this.whistle(e.kind);
      else if (e.type === 'slide') this.slide();
      else if (e.type === 'kick' && !kicked) {
        // At most one per frame: catching up several ticks at once would
        // otherwise fire a burst of them at the same instant.
        this.kick(e.power);
        kicked = true;
      }
    }
  }
}

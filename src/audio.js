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

export class Chiptune {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.timer = null;
    this.stepIndex = 0;
    this.nextStepTime = 0;
  }

  /** Browsers only allow this from a click or a key press. */
  start() {
    if (this.playing) return;
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return; // no Web Audio: the game is perfectly playable in silence
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this.leadWave = pulseWave(this.ctx, 0.25);
      this.arpWave = pulseWave(this.ctx, 0.125);
      this.noise = this.makeNoise();
    }
    this.ctx.resume?.();
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
    this.ctx?.suspend?.();
  }

  toggle(on) {
    if (on) this.start();
    else this.stop();
  }

  makeNoise() {
    const frames = Math.floor(this.ctx.sampleRate * 0.3);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
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

// Headless rooktest: draait een hele wedstrijd CPU-vs-CPU zonder browser.
// Controleert (a) dat er niets ontspoort (NaN, spelers buiten de wereld) en
// (b) dat de simulatie deterministisch is - de voorwaarde voor online multiplayer.

import { createMatch, hashState } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { TICK_RATE, WORLD_H, WORLD_W } from '../src/constants.js';

function runMatch(seed, ticks) {
  const state = createMatch({ seed, halfSeconds: 60, humans: [false, false] });
  const events = [];
  let prevScore = '0-0';
  let prevPhase = state.phase;

  for (let i = 0; i < ticks; i++) {
    step(state, [0, 0]);

    const b = state.ball;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) {
      throw new Error(`Bal is NaN op tick ${state.tick}`);
    }
    for (const team of state.teams) {
      for (const p of team.players) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          throw new Error(`Speler NaN op tick ${state.tick}`);
        }
        if (p.x < 0 || p.x > WORLD_W || p.y < 0 || p.y > WORLD_H) {
          throw new Error(`Speler buiten de wereld op tick ${state.tick}: ${p.x},${p.y}`);
        }
      }
    }

    const score = state.score.join('-');
    if (score !== prevScore) {
      events.push(`${Math.floor(state.tick / TICK_RATE)}s  DOELPUNT -> ${score}`);
      prevScore = score;
    }
    if (state.phase !== prevPhase) {
      if (['restart', 'halftime', 'fulltime'].includes(state.phase)) {
        events.push(`${Math.floor(state.tick / TICK_RATE)}s  ${state.phase}${state.message ? ` (${state.message})` : ''}`);
      }
      prevPhase = state.phase;
    }
  }
  return { state, events, hash: hashState(state) };
}

const TICKS = TICK_RATE * 150; // ruim een volledige wedstrijd van 2 x 60s

const a = runMatch(1234, TICKS);
const b = runMatch(1234, TICKS);
const c = runMatch(9999, TICKS);

console.log(`Gespeeld: ${TICKS} ticks (${Math.round(TICKS / TICK_RATE)}s per wedstrijd, 3 wedstrijden)`);
console.log(`Eindstand seed 1234: ${a.state.score.join(' - ')}  fase=${a.state.phase} helft=${a.state.half}`);
console.log(`Eindstand seed 9999: ${c.state.score.join(' - ')}  fase=${c.state.phase} helft=${c.state.half}`);
console.log('');
console.log('Wedstrijdverloop (seed 1234):');
for (const e of a.events.slice(0, 25)) console.log('  ' + e);
if (a.events.length > 25) console.log(`  ... en nog ${a.events.length - 25} gebeurtenissen`);
console.log('');

if (a.hash !== b.hash) {
  console.error(`FAIL: niet deterministisch (${a.hash} != ${b.hash})`);
  process.exit(1);
}
console.log(`OK: deterministisch (hash ${a.hash})`);

if (a.state.phase !== 'fulltime') {
  console.error(`FAIL: wedstrijd niet afgelopen (fase=${a.state.phase})`);
  process.exit(1);
}
console.log('OK: wedstrijd netjes uitgespeeld tot rust en einde');

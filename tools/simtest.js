// Headless smoke test: plays whole CPU-vs-CPU matches without a browser.
// Checks (a) that nothing derails (NaN, players outside the world) and (b) that
// the simulation is deterministic - the precondition for online multiplayer.

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
      throw new Error(`Ball went NaN on tick ${state.tick}`);
    }
    for (const team of state.teams) {
      for (const p of team.players) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          throw new Error(`Player went NaN on tick ${state.tick}`);
        }
        if (p.x < 0 || p.x > WORLD_W || p.y < 0 || p.y > WORLD_H) {
          throw new Error(`Player outside the world on tick ${state.tick}: ${p.x},${p.y}`);
        }
      }
    }

    const score = state.score.join('-');
    if (score !== prevScore) {
      events.push(`${Math.floor(state.tick / TICK_RATE)}s  GOAL -> ${score}`);
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

const TICKS = TICK_RATE * 150; // comfortably more than a full 2 x 60s match

const a = runMatch(1234, TICKS);
const b = runMatch(1234, TICKS);
const c = runMatch(9999, TICKS);

console.log(`Played: ${TICKS} ticks (${Math.round(TICKS / TICK_RATE)}s per match, 3 matches)`);
console.log(`Final score seed 1234: ${a.state.score.join(' - ')}  phase=${a.state.phase} half=${a.state.half}`);
console.log(`Final score seed 9999: ${c.state.score.join(' - ')}  phase=${c.state.phase} half=${c.state.half}`);
console.log('');
console.log('Match events (seed 1234):');
for (const e of a.events.slice(0, 25)) console.log('  ' + e);
if (a.events.length > 25) console.log(`  ... and ${a.events.length - 25} more events`);
console.log('');

if (a.hash !== b.hash) {
  console.error(`FAIL: not deterministic (${a.hash} != ${b.hash})`);
  process.exit(1);
}
console.log(`OK: deterministic (hash ${a.hash})`);

if (a.state.phase !== 'fulltime') {
  console.error(`FAIL: match did not finish (phase=${a.state.phase})`);
  process.exit(1);
}
console.log('OK: match played out cleanly through half time to full time');

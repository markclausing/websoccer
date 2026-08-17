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

// --- Difficulty ladder -------------------------------------------------------
//
// Each level plays a full match against HARD, both sides CPU. What matters is the
// share of the goals the weaker side manages to score: HARD against itself lands
// around half, and the easier levels have to be clearly below that. The bounds
// are loose on purpose - this is here to catch a level that has drifted or broken,
// not to pin down an exact number.

function ladder(level, seeds = 10) {
  let mine = 0;
  let theirs = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const state = createMatch({
      seed, halfSeconds: 120, humans: [false, false], difficulty: [level, 'hard'],
    });
    while (state.phase !== 'fulltime' && state.tick < TICK_RATE * 400) step(state, [0, 0]);
    mine += state.score[0];
    theirs += state.score[1];
  }
  const total = mine + theirs;
  return { mine, theirs, share: total ? (mine / total) * 100 : 0 };
}

console.log('');
console.log('Difficulty ladder (each level plays HARD, 10 matches):');
const levels = {};
for (const level of ['hard', 'normal', 'easy']) {
  const r = ladder(level);
  levels[level] = r;
  console.log(`  ${level.padEnd(6)} ${String(r.mine).padStart(3)} - ${String(r.theirs).padStart(3)}  (${r.share.toFixed(0)}% of the goals)`);
}

if (levels.easy.share > 30) {
  console.error(`FAIL: EASY is not easy enough (${levels.easy.share.toFixed(0)}% of the goals against HARD)`);
  process.exit(1);
}
if (levels.normal.share > 45) {
  console.error(`FAIL: NORMAL is not below HARD (${levels.normal.share.toFixed(0)}% of the goals against HARD)`);
  process.exit(1);
}
if (levels.hard.share < 25) {
  console.error(`FAIL: HARD does not hold its own against itself (${levels.hard.share.toFixed(0)}%)`);
  process.exit(1);
}
console.log('OK: EASY and NORMAL are measurably weaker than HARD');

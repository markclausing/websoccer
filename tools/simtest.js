// Headless smoke test: plays whole CPU-vs-CPU matches without a browser.
// Checks (a) that nothing derails (NaN, players outside the world) and (b) that
// the simulation is deterministic - the precondition for online multiplayer.

import { advanceOf, createMatch, hashState } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { kickBall } from '../src/game/kick.js';
import { FIELD, TICK_RATE, WORLD_H, WORLD_W } from '../src/constants.js';

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

function ladder(level, seeds = 8) {
  let mine = 0;
  let theirs = 0;
  let up = 0;
  let back = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const state = createMatch({
      seed, halfSeconds: 120, humans: [false, false], difficulty: [level, 'hard'],
    });
    while (state.phase !== 'fulltime' && state.tick < TICK_RATE * 400) {
      step(state, [0, 0]);
      if (state.phase !== 'play') continue;
      // Territory, not goals: at two goals a match the scoreline is far too
      // noisy to tune against, while this samples every single tick.
      if (advanceOf(state.teams[0], state.ball.y) > 0.5) up++;
      else back++;
    }
    mine += state.score[0];
    theirs += state.score[1];
  }
  return { mine, theirs, territory: (up / (up + back)) * 100 };
}

console.log('');
console.log('Difficulty ladder (each level plays HARD, 8 matches):');
const levels = {};
for (const level of ['hard', 'normal', 'easy']) {
  const r = ladder(level);
  levels[level] = r;
  console.log(`  ${level.padEnd(6)} ${r.territory.toFixed(0)}% territory, scored ${r.mine} conceded ${r.theirs}`);
}

// Relative bounds, not absolute ones. Anything that changes the game as a whole -
// the pace, the shape of the defence - moves all three levels together, and
// absolute thresholds then fail for reasons that have nothing to do with the
// difficulty ladder. What has to hold is the ordering and the gaps.
if (levels.hard.territory < 45) {
  console.error(`FAIL: HARD does not hold its own against itself (${levels.hard.territory.toFixed(0)}% territory)`);
  process.exit(1);
}
if (levels.normal.territory > levels.hard.territory - 2) {
  console.error(`FAIL: NORMAL is not below HARD (${levels.normal.territory.toFixed(0)}% vs ${levels.hard.territory.toFixed(0)}% territory)`);
  process.exit(1);
}
if (levels.easy.territory > levels.normal.territory - 5) {
  console.error(`FAIL: EASY is not below NORMAL (${levels.easy.territory.toFixed(0)}% vs ${levels.normal.territory.toFixed(0)}% territory)`);
  process.exit(1);
}
// Territory alone undersells it: an easier side can hold the ball in midfield
// and still be picked apart, so check the scoreline too.
if (levels.normal.theirs <= levels.normal.mine) {
  console.error(`FAIL: NORMAL is not losing to HARD (${levels.normal.mine}-${levels.normal.theirs})`);
  process.exit(1);
}
if (levels.easy.theirs < levels.easy.mine * 2) {
  console.error(`FAIL: EASY is not losing heavily enough to HARD (${levels.easy.mine}-${levels.easy.theirs})`);
  process.exit(1);
}
console.log('OK: EASY and NORMAL are measurably weaker than HARD, on both territory and the scoreline');

// --- Offside -----------------------------------------------------------------
//
// A staged pass rather than a whole match: CPU sides keep themselves onside, so
// waiting for a match to produce an offside would test nothing. Team 0 attacks
// upwards, team 1 defends with a flat line on y = 250, and the striker is put
// either side of it.

function offsidePass(strikerY, offside = true) {
  const state = createMatch({ seed: 7, halfSeconds: 120, humans: [false, false], offside });
  state.phase = 'play';
  state.phaseTimer = 0;
  state.message = '';
  state.ball.protectedFor = null;
  state.ball.protectTicks = 0;

  // Defenders in a line, but out of the passing lane so they cannot cut it out.
  state.teams[1].players.forEach((p, i) => {
    p.x = i === 0 ? FIELD.cx : FIELD.cx + (i % 2 ? -260 : 260);
    p.y = i === 0 ? FIELD.top + 15 : 250;
    p.vx = 0;
    p.vy = 0;
  });
  state.teams[0].players.forEach((p) => {
    p.x = FIELD.cx + 300;
    p.y = 800;
    p.vx = 0;
    p.vy = 0;
  });

  const passer = state.teams[0].players[6];
  passer.x = FIELD.cx;
  passer.y = 500;
  const striker = state.teams[0].players[9];
  striker.x = FIELD.cx + 20;
  striker.y = strikerY;

  state.ball.x = passer.x;
  state.ball.y = passer.y - 12;
  state.ball.owner = { team: 0, idx: 6 };
  kickBall(state, 0, 6, striker.x - passer.x, striker.y - passer.y, 340, 0);

  for (let i = 0; i < 200; i++) {
    step(state, [0, 0]);
    if (state.message === 'OFFSIDE') return 'whistled';
    const owner = state.ball.owner;
    if (owner && owner.team === 0 && owner.idx === 9) return 'received';
  }
  return 'nothing happened';
}

console.log('');
const beyond = offsidePass(200);
const behind = offsidePass(300);
const ruleOff = offsidePass(200, false);
console.log(`Offside: striker beyond the line -> ${beyond}`);
console.log(`         striker behind the line -> ${behind}`);
console.log(`         beyond, rule turned off -> ${ruleOff}`);

if (beyond !== 'whistled') {
  console.error(`FAIL: a striker beyond the last defender was not flagged (${beyond})`);
  process.exit(1);
}
if (behind !== 'received') {
  console.error(`FAIL: an onside striker was wrongly denied the ball (${behind})`);
  process.exit(1);
}
if (ruleOff !== 'received') {
  console.error(`FAIL: offside was called with the rule turned off (${ruleOff})`);
  process.exit(1);
}
console.log('OK: offside is called on the offence and nowhere else');

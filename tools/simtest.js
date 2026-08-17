// Headless smoke test: plays whole CPU-vs-CPU matches without a browser.
// Checks (a) that nothing derails (NaN, players outside the world) and (b) that
// the simulation is deterministic - the precondition for online multiplayer.

import { advanceOf, createMatch, hashState } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { kickBall } from '../src/game/kick.js';
import { assistedAim } from '../src/game/aim.js';
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
  console.log(`  ${level.padEnd(6)} ${r.territory.toFixed(0)}% territory, scored ${r.mine} conceded ${r.theirs} (${(r.theirs / Math.max(r.mine, 1)).toFixed(1)}x)`);
}

// The telling number is how badly a level loses, not how much of the pitch it
// holds: a weaker side can keep the ball in midfield all afternoon and still be
// picked apart. Territory only separates EASY, so it is used only there.
//
// Relative bounds, not absolute ones. Anything that changes the game as a whole -
// the pace, the shape of the defence - moves all three levels together, and
// absolute thresholds then fail for reasons that have nothing to do with the
// difficulty ladder. What has to hold is the ordering and the gaps.
const ratio = (r) => r.theirs / Math.max(r.mine, 1);

if (ratio(levels.hard) > 1.8) {
  console.error(`FAIL: HARD does not hold its own against itself (${levels.hard.mine}-${levels.hard.theirs})`);
  process.exit(1);
}
if (ratio(levels.normal) < 1.8) {
  console.error(`FAIL: NORMAL is not clearly losing to HARD (${levels.normal.mine}-${levels.normal.theirs})`);
  process.exit(1);
}
if (ratio(levels.easy) < 6) {
  console.error(`FAIL: EASY is not losing heavily enough to HARD (${levels.easy.mine}-${levels.easy.theirs})`);
  process.exit(1);
}
if (levels.easy.territory > levels.hard.territory - 8) {
  console.error(`FAIL: EASY is not pinned back (${levels.easy.territory.toFixed(0)}% vs ${levels.hard.territory.toFixed(0)}% territory)`);
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

// --- Assisted aim -------------------------------------------------------------
//
// A pass aimed near a team-mate should bend towards him; a shot at goal must
// come out exactly as aimed, even with a team-mate near the line of fire.

function aimTest({ from, to, mateAt, aim }) {
  const state = createMatch({ seed: 3, halfSeconds: 120, humans: [true, false] });
  const p = state.teams[0].players[6];
  const mate = state.teams[0].players[8];
  state.teams[0].players.forEach((q, i) => {
    if (i !== 6 && i !== 8) {
      q.x = FIELD.left + 20;
      q.y = FIELD.bottom - 20;
    }
  });
  p.x = from.x;
  p.y = from.y;
  mate.x = p.x + Math.cos(mateAt) * to;
  mate.y = p.y + Math.sin(mateAt) * to;
  const out = assistedAim(state, 0, 6, Math.cos(aim), Math.sin(aim));
  return Math.atan2(out.y, out.x);
}

const deg = (rad) => (rad * 180) / Math.PI;
const sideways = aimTest({
  from: { x: FIELD.cx, y: FIELD.cy }, to: 200, mateAt: -0.31, aim: 0,
});
const wide = aimTest({
  from: { x: FIELD.cx, y: FIELD.cy }, to: 200, mateAt: -0.87, aim: 0,
});
const shot = aimTest({
  from: { x: FIELD.cx + 30, y: FIELD.top + 190 }, to: 130, mateAt: -2.14, aim: -1.77,
});

console.log('');
console.log(`Assisted aim: pass aimed at 0 deg with a mate at -18 -> ${deg(sideways).toFixed(1)} deg`);
console.log(`              mate out at -50 deg -> ${deg(wide).toFixed(1)} deg`);
console.log(`              shot aimed at ${deg(-1.77).toFixed(1)} deg -> ${deg(shot).toFixed(1)} deg`);

if (!(deg(sideways) < -8 && deg(sideways) > -18)) {
  console.error(`FAIL: the pass was not bent towards the team-mate (${deg(sideways).toFixed(1)} deg)`);
  process.exit(1);
}
if (Math.abs(deg(wide)) > 0.01) {
  console.error(`FAIL: a team-mate well outside the cone still pulled the pass (${deg(wide).toFixed(1)} deg)`);
  process.exit(1);
}
if (Math.abs(deg(shot) - deg(-1.77)) > 0.01) {
  console.error(`FAIL: a shot at goal was bent off target (${deg(shot).toFixed(1)} deg)`);
  process.exit(1);
}
console.log('OK: passes are helped along and shots are left exactly as aimed');

// --- Goal kick ----------------------------------------------------------------
//
// Staged, because a CPU match can run for minutes without the ball crossing a
// goal line. Team 0 attacks upwards, so a ball it puts behind the top line is a
// goal kick to team 1 - and the keeper takes those.

function goalKickTaker() {
  const state = createMatch({ seed: 5, halfSeconds: 120, humans: [false, false] });
  state.phase = 'play';
  state.phaseTimer = 0;
  state.ball.protectedFor = null;
  state.ball.x = FIELD.cx + 200; // wide of the goal, so it is not a goal
  state.ball.y = FIELD.top - 5;
  state.ball.vy = -50;
  state.ball.lastTouch = { team: 0, idx: 9 };
  step(state, [0, 0]);
  return {
    message: state.message,
    team: state.restartTeam,
    controlled: state.teams[state.restartTeam].controlled,
  };
}

const gk = goalKickTaker();
console.log('');
console.log(`Goal kick: ${gk.message || 'not awarded'}, taken by player ${gk.controlled} of team ${gk.team}`);
if (gk.message !== 'GOAL KICK') {
  console.error(`FAIL: a ball put behind for a goal kick gave "${gk.message}"`);
  process.exit(1);
}
if (gk.controlled !== 0) {
  console.error(`FAIL: the goal kick went to player ${gk.controlled} instead of the keeper`);
  process.exit(1);
}
console.log('OK: goal kicks are taken by the keeper');

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

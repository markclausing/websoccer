// Headless smoke test: plays whole CPU-vs-CPU matches without a browser.
// Checks (a) that nothing derails (NaN, players outside the world) and (b) that
// the simulation is deterministic - the precondition for online multiplayer.

import {
  advanceOf, createMatch, hashState, posFor, targetGoalY,
} from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { kickBall } from '../src/game/kick.js';
import { assistedAim } from '../src/game/aim.js';
import { BTN, FIELD, GOAL_W, TICK_RATE, WORLD_H, WORLD_W } from '../src/constants.js';
import { norm } from '../src/util.js';

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

// The final whistle is reported once. It used to stay in the event list after
// the match ended, because the list was cleared after the early return rather
// than before it, and the game loop then played it again on every frame.
let afterTheEnd = 0;
for (let i = 0; i < 200; i++) {
  step(a.state, [0, 0]);
  afterTheEnd += a.state.events.length;
}
if (afterTheEnd > 0) {
  console.error(`FAIL: ${afterTheEnd} events reported after full time - the whistle repeats`);
  process.exit(1);
}
console.log('OK: nothing is reported once the match is over');

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

// --- Getting through --------------------------------------------------------
//
// Can you actually attack? A controlled player starts on the halfway line with
// the ball and drives straight at goal, five lanes across the pitch, twelve
// seeds. This exists because the obvious suspect turned out to be innocent: the
// back four barely registered, while fifty-eight of sixty runs ended in a slide
// tackle. Whole-match goal counts were useless for this - they swing between a
// shutout and twenty goals on a change of a hundredth - and this scenario has
// no midfield noise in it at all.

function driveAtGoal() {
  const lanes = [-0.7, -0.35, 0, 0.35, 0.7];
  let runs = 0;
  let box = 0;
  let slides = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const lane of lanes) {
      const state = createMatch({
        seed, halfSeconds: 120, humans: [true, false], difficulty: ['hard', 'hard'],
      });
      while (state.phase !== 'play' && state.tick < 600) step(state, [0, 0]);

      const team = state.teams[0];
      const idx = 9; // the centre forward
      const p = team.players[idx];
      const start = posFor(team, lane, 0.5);
      p.x = start.x;
      p.y = start.y;
      team.controlled = idx;
      const b = state.ball;
      b.x = p.x;
      b.y = p.y;
      b.z = 0;
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      b.owner = { team: 0, idx };
      p.holdTicks = 30;
      for (let i = 0; i < 15; i++) step(state, [0, 0]); // let the defence shape up

      const forward = team.attackDir < 0 ? BTN.UP : BTN.DOWN;
      let best = advanceOf(team, p.y);
      for (let i = 0; i < 300; i++) {
        let mask = forward;
        if (p.x < FIELD.cx - 30) mask |= BTN.RIGHT;
        else if (p.x > FIELD.cx + 30) mask |= BTN.LEFT;
        step(state, [mask, 0]);
        const mine = state.ball.owner && state.ball.owner.team === 0;
        if (mine) best = Math.max(best, advanceOf(team, state.ball.y));
        if (!mine || state.phase !== 'play') {
          if (state.teams[1].players.some((o) => o.slide > 0)) slides++;
          break;
        }
      }
      runs++;
      if (best > 0.85) box++;
    }
  }
  return { runs, box: (box / runs) * 100, slides: (slides / runs) * 100 };
}

console.log('');
const drive = driveAtGoal();
console.log(`Running at goal: ${drive.box.toFixed(0)}% of ${drive.runs} runs reached the box, `
  + `${drive.slides.toFixed(0)}% were ended by a slide`);

if (drive.box < 55) {
  console.error(`FAIL: only ${drive.box.toFixed(0)}% of runs reached the box - the defence has walled up again`);
  process.exit(1);
}
if (drive.slides > 90) {
  console.error(`FAIL: ${drive.slides.toFixed(0)}% of runs died to a slide tackle - sliding is dominant again`);
  process.exit(1);
}
console.log('OK: an attacking run gets through often enough, and not every one dies to a slide');

// --- Holding the button longer must not be punished ---------------------------
//
// Power and height used to come off the same charge, so a full one sailed over
// the bar: 48% of shots went in at three quarters and 5% at full, the rest out
// for a goal kick. A shot on goal is now kept down. This drives the real button
// path - press, hold, release - rather than calling the physics directly, since
// the cap lives in the code that reads your input.

function shootHolding(hold) {
  const lanes = [-0.5, -0.25, 0, 0.25, 0.5];
  let tries = 0;
  let goals = 0;
  for (let seed = 1; seed <= 6; seed++) {
    for (const adv of [0.72, 0.80, 0.86, 0.92]) {
      for (const lane of lanes) {
        const state = createMatch({
          seed, halfSeconds: 120, humans: [true, false], difficulty: ['hard', 'hard'],
        });
        while (state.phase !== 'play' && state.tick < 600) step(state, [0, 0]);
        const team = state.teams[0];
        const idx = 9;
        const p = team.players[idx];
        const spot = posFor(team, lane, adv);
        p.x = spot.x;
        p.y = spot.y;
        p.vx = 0;
        p.vy = 0;
        const b = state.ball;
        b.x = p.x;
        b.y = p.y;
        b.z = 0;
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        b.owner = { team: 0, idx };
        p.holdTicks = 30;
        team.controlled = idx;
        for (let i = 0; i < 6; i++) step(state, [0, 0]);
        if (state.phase !== 'play' || !state.ball.owner || state.ball.owner.team !== 0) continue;

        // Facing the far corner, then nothing but the button: no direction keys,
        // so the ball goes where he is looking, exactly as in a real game.
        const goalY = targetGoalY(team);
        const corner = FIELD.cx + (p.x < FIELD.cx ? 1 : -1) * (GOAL_W / 2 - 12);
        const aim = norm(corner - p.x, goalY - p.y);
        p.dirX = aim.x;
        p.dirY = aim.y;
        tries++;

        const before = state.score[0];
        for (let i = 0; i < 200; i++) {
          step(state, [i <= hold ? BTN.FIRE : 0, 0]);
          if (state.score[0] > before) { goals++; break; }
          const o = state.ball.owner;
          if ((o && o.team === 1) || state.phase !== 'play') break;
        }
      }
    }
  }
  return (goals / tries) * 100;
}

console.log('');
const threeQuarters = shootHolding(25);
const full = shootHolding(30);
console.log(`Shooting: three quarter charge scores ${threeQuarters.toFixed(0)}%, `
  + `a full one ${full.toFixed(0)}%`);

if (full < threeQuarters * 0.7) {
  console.error(`FAIL: a full charge scores ${full.toFixed(0)}% against ${threeQuarters.toFixed(0)}% `
    + 'at three quarters - holding the button all the way is being punished again');
  process.exit(1);
}
console.log('OK: hitting it as hard as you can is not a mistake');

import {
  AT_LIFT, AT_SIDE, AIR_DRAG, BALL_R, BOUNCE_XY, BOUNCE_Z, BTN, CHARGE_MAX,
  CONTROL_R, CONTROL_Z, CROSSBAR_H, DOWN_TICKS, DRIBBLE_DIST, DRIBBLE_LERP, DT,
  FIELD, GOAL_CELEBRATION_TICKS, GOAL_DEPTH, GOAL_W, GRAVITY, GROUND_FRICTION,
  HALFTIME_TICKS, KEEPER_CONTROL_R, KEEPER_CONTROL_Z, KEEPER_SPEED, MANUAL_HOLD_TICKS,
  PEN_D, PEN_W,
  KEEPER_HOLD_MAX, KEEPER_HOLD_TICKS, PLAYER_ACC, PLAYER_DAMP, PLAYER_R, PLAYER_SPEED,
  PLAYER_SPEED_BALL, PROTECT_TICKS, ROLL_DRAG,
  RESTART_TICKS,
  RUN_ADVANCE, SAVE_SPEED, SHOT_FLAT_RANGE, SHOT_LIFT_MAX,
  SIX_D, SLIDE_COOLDOWN, SLIDE_DECAY, SLIDE_REACH, SLIDE_SPEED, SLIDE_TICKS, SPIN_DECAY,
  WORLD_H, WORLD_W,
} from '../constants.js';
import { clamp, dist, dist2, len, norm } from '../util.js';
import { maskToDir } from '../input.js';
import { aiMove, aiWantsSlide } from './ai.js';
import { chargeToShot, kickBall } from './kick.js';
import { advanceOf, ownGoalY, setupKickoff, targetGoalY } from './state.js';
import { clearOffside } from './offside.js';
import { aimedAtGoal, assistedAim } from './aim.js';

/**
 * The only place where the match changes.
 * Pure: same state + same inputs -> same result, on every machine.
 *
 * @param {object} state    match state (mutated in place)
 * @param {number[]} inputs one bitmask per team slot, e.g. [0b10011, 0]
 */
export function step(state, inputs) {
  // Cleared before anything else, including the early return below. Leaving the
  // list standing at full time meant the final whistle sat in it forever and the
  // game loop played it again on every frame - a whistle that never stopped.
  state.events.length = 0;
  if (state.phase === 'fulltime') return state;

  state.tick++;
  advancePhase(state);

  const frozen = state.phase !== 'play';

  updateProtection(state);
  updateOwnership(state);
  updatePlayers(state, inputs, frozen);
  separatePlayers(state);
  resolveTackles(state);
  updateBall(state, inputs);

  if (!frozen) {
    if (!checkGoal(state)) checkOutOfPlay(state);
    updateClock(state);
  }
  return state;
}

// --------------------------------------------------------------------------
// Match phases
// --------------------------------------------------------------------------

function advancePhase(state) {
  if (state.phaseTimer > 0) {
    state.phaseTimer--;
    if (state.phaseTimer > 0) return;
  } else {
    return;
  }

  switch (state.phase) {
    case 'kickoff':
    case 'restart':
      state.phase = 'play';
      state.message = '';
      state.events.push({ type: 'whistle', kind: 'start' });
      break;
    case 'goal':
      setupKickoff(state, 1 - state.lastGoalTeam);
      break;
    case 'halftime':
      state.half = 2;
      state.halfTick = 0;
      for (const team of state.teams) team.attackDir *= -1;
      setupKickoff(state, 1 - state.firstKickoffTeam);
      break;
    default:
      break;
  }
}

function updateClock(state) {
  state.halfTick++;
  if (state.halfTick < state.config.halfTicks) return;

  if (state.half === 1) {
    state.phase = 'halftime';
    state.phaseTimer = HALFTIME_TICKS;
    state.message = 'HALF TIME';
    state.events.push({ type: 'whistle', kind: 'half' });
  } else {
    state.phase = 'fulltime';
    state.phaseTimer = 0;
    state.message = 'FULL TIME';
    state.events.push({ type: 'whistle', kind: 'end' });
  }
}

// --------------------------------------------------------------------------
// Ball possession
// --------------------------------------------------------------------------

/** Is this player inside his own penalty area? */
function inOwnBox(state, teamIdx, p) {
  const team = state.teams[teamIdx];
  const gy = team.attackDir < 0 ? FIELD.bottom : FIELD.top;
  return Math.abs(p.y - gy) < PEN_D && Math.abs(p.x - FIELD.cx) < PEN_W / 2;
}

function canControl(state, team, p) {
  const b = state.ball;
  if (p.down > 0 || p.slide > 0 || p.cooldown > 0) return false;
  // A restart that has not been taken, or a keeper with the ball: hands off.
  if (b.protectedFor !== null && b.protectedFor !== team.index) return false;
  const isKeeper = p.role === 'gk';
  const r = isKeeper ? KEEPER_CONTROL_R : CONTROL_R;
  const zMax = isKeeper ? KEEPER_CONTROL_Z : CONTROL_Z;
  if (b.z > zMax) return false;
  return dist2(b.x, b.y, p.x, p.y) < r * r;
}

function updateOwnership(state) {
  const b = state.ball;

  if (b.owner) {
    const p = state.teams[b.owner.team].players[b.owner.idx];
    const r = p.role === 'gk' ? KEEPER_CONTROL_R : CONTROL_R;
    if (p.down > 0 || p.slide > 0 || p.cooldown > 0 || dist2(b.x, b.y, p.x, p.y) > (r * 2) ** 2) {
      b.owner = null;
      p.holdTicks = 0;
      p.charging = false;
      p.charge = 0;
    } else {
      p.holdTicks++;
      // Topped up for as long as he really has it, but not past the six second
      // rule, and only inside his own box. Carry the ball out of the area and
      // you are just another player with the ball - otherwise a keeper could
      // stroll the length of the pitch untouchable.
      if (p.role === 'gk') {
        if (p.holdTicks < KEEPER_HOLD_MAX && inOwnBox(state, b.owner.team, p)) {
          protectFor(state, b.owner.team, 'untilPlayed', KEEPER_HOLD_TICKS);
        } else if (b.protectMode === 'untilPlayed') {
          clearProtection(state);
        }
      }
      return;
    }
  }

  let best = null;
  let bestD = Infinity;
  for (let t = 0; t < 2; t++) {
    const team = state.teams[t];
    for (let i = 0; i < team.players.length; i++) {
      const p = team.players[i];
      if (!canControl(state, team, p)) continue;
      const d = dist2(b.x, b.y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = { team: t, idx: i };
      }
    }
  }
  if (best) {
    const struck = len(b.vx, b.vy);
    const stopped = state.teams[best.team].players[best.idx];
    // A save, not a pick-up: the keeper, a ball that was travelling, an opponent
    // who hit it, and close enough to his goal for it to have mattered.
    if (stopped.role === 'gk' && struck > SAVE_SPEED
        && b.lastTouch && b.lastTouch.team !== best.team
        && Math.abs(b.y - ownGoalY(state.teams[best.team])) < PEN_D) {
      state.events.push({ type: 'save', team: best.team });
    }

    b.owner = best;
    b.lastTouch = { team: best.team, idx: best.idx };
    b.kicker = null;
    const p = state.teams[best.team].players[best.idx];
    p.holdTicks = 0;
    // Where this run started, and whether it has already been remarked upon.
    p.runFrom = advanceOf(state.teams[best.team], p.y);
    p.ran = false;

    if (p.offside) {
      whistleOffside(state, best.team, p);
      return;
    }
    // Anyone touching the ball ends the previous pass, flags and all.
    clearOffside(state);

    // A restart is over the moment the taker has the ball: that is the touch
    // that puts it back in play.
    if (b.protectedFor === best.team && b.protectMode === 'untilTouch') {
      clearProtection(state);
    }

    // A keeper who has gathered the ball in his own box gets to clear it in peace.
    if (p.role === 'gk' && inOwnBox(state, best.team, p)) {
      protectFor(state, best.team, 'untilPlayed', KEEPER_HOLD_TICKS);
    }
  }
}

function protectFor(state, teamIdx, mode, ticks) {
  const b = state.ball;
  b.protectedFor = teamIdx;
  b.protectMode = mode;
  b.protectTicks = ticks;
}

function updateProtection(state) {
  const b = state.ball;
  if (b.protectedFor === null) return;
  b.protectTicks--;
  if (b.protectTicks <= 0) clearProtection(state);
}

export function clearProtection(state) {
  state.ball.protectedFor = null;
  state.ball.protectTicks = 0;
}

// --------------------------------------------------------------------------
// Players
// --------------------------------------------------------------------------

const NO_INTENT = { x: 0, y: 0, kick: null, slide: false };

/**
 * Three phases per tick. The split is not cosmetic: handling team 0 completely
 * before team 1 gets to think means team 1 reacts to fresh positions and team 0
 * to stale ones. That measurably won team 1 more goals. Now all 22 players
 * decide their intent from the exact same snapshot.
 */
function updatePlayers(state, inputs, frozen) {
  // Phase 0: timers that feed into the decisions below.
  for (const team of state.teams) {
    for (const p of team.players) {
      if (p.cooldown > 0) p.cooldown--;
    }
  }
  for (let t = 0; t < 2; t++) {
    const team = state.teams[t];
    if (!team.human) continue;
    const mask = inputs[t] | 0;
    // On the press, not while held, so leaning on it does not chase the ball.
    const asked = (mask & BTN.SWITCH) !== 0 && (team.prevMask & BTN.SWITCH) === 0;
    updateControlledPlayer(state, t, asked);
  }

  // Phase 1: decide intents (reads the shared snapshot).
  const intents = [[], []];
  for (let t = 0; t < 2; t++) {
    const team = state.teams[t];
    const mask = team.human ? (inputs[t] | 0) : 0;
    for (let i = 0; i < team.players.length; i++) {
      const p = team.players[i];
      if (frozen || p.down > 0) {
        intents[t][i] = NO_INTENT;
        continue;
      }
      if (team.human && i === team.controlled) {
        intents[t][i] = humanIntent(state, t, i, mask);
      } else {
        const mv = aiMove(state, t, i, { allowKicks: !team.human });
        intents[t][i] = {
          x: mv.x,
          y: mv.y,
          kick: mv.kick || null,
          slide: !team.human && aiWantsSlide(state, t, i),
        };
      }
    }
  }

  // Phase 2: carry out actions (at most one player owns the ball, so at most one kick).
  for (let t = 0; t < 2; t++) {
    const team = state.teams[t];
    for (let i = 0; i < team.players.length; i++) {
      const it = intents[t][i];
      if (it.kick) kickBall(state, t, i, it.kick.dx, it.kick.dy, it.kick.power, it.kick.lift);
      if (it.slide) startSlide(state, team.players[i]);
    }
  }

  // Phase 3: move.
  for (let t = 0; t < 2; t++) {
    const team = state.teams[t];
    for (let i = 0; i < team.players.length; i++) {
      const p = team.players[i];
      if (p.down > 0) {
        p.down--;
        p.vx *= 0.86;
        p.vy *= 0.86;
        integratePlayer(p);
        continue;
      }
      if (frozen) {
        p.charging = false;
        p.charge = 0;
      }
      movePlayer(state, t, p, intents[t][i]);
    }
    if (team.human) team.prevMask = inputs[t] | 0;
  }
}

/** Auto-switch: you always control the player on the ball, otherwise the nearest one. */
function updateControlledPlayer(state, t, forced = false) {
  const team = state.teams[t];
  const b = state.ball;

  if (b.owner && b.owner.team === t) {
    team.controlled = b.owner.idx;
    team.manualHold = 0;
    return;
  }

  // Everyone who could take over, nearest the ball first. The keeper stays on
  // the computer for the save itself - you take over once he has the ball,
  // which is handled above. Being dropped into goal as a shot comes in is
  // nobody's idea of a good time.
  const order = [];
  for (let i = 1; i < team.players.length; i++) {
    if (team.players[i].down === 0) order.push(i);
  }
  if (!order.length) return;
  order.sort((a, c) => dist2(b.x, b.y, team.players[a].x, team.players[a].y)
    - dist2(b.x, b.y, team.players[c].x, team.players[c].y));

  if (forced) {
    // Step to the next man out rather than to the nearest: the automatic pick
    // has you on the nearest almost all the time already, so a button that
    // chooses him again does nothing. Press it repeatedly to work outwards.
    const at = order.indexOf(team.controlled);
    team.controlled = order[(at + 1) % order.length];
    team.manualHold = MANUAL_HOLD_TICKS;
    return;
  }

  // Your own choice stands for a moment before the game starts helping again.
  if (team.manualHold > 0) {
    team.manualHold--;
    return;
  }

  const cur = team.players[team.controlled];
  if (cur && cur.down === 0 && (cur.slide > 0 || cur.charging)) return;

  const best = order[0];
  // Hysteresis: do not switch over a negligible difference (stops the flip-flopping).
  if (best !== team.controlled && cur && cur.down === 0) {
    const curD = dist2(b.x, b.y, cur.x, cur.y);
    const bestD = dist2(b.x, b.y, team.players[best].x, team.players[best].y);
    if (curD - bestD < 18 * 18) return;
  }
  team.controlled = best;
}

function humanIntent(state, t, i, mask) {
  const team = state.teams[t];
  const p = team.players[i];
  const b = state.ball;
  const dir = maskToDir(mask);
  const intent = { x: dir.x, y: dir.y, kick: null, slide: false };

  const fire = (mask & BTN.FIRE) !== 0;
  const prevFire = (team.prevMask & BTN.FIRE) !== 0;
  const owns = b.owner && b.owner.team === t && b.owner.idx === i;

  if (fire && !prevFire) {
    if (owns) {
      // Button pressed while on the ball: build up power until release.
      p.charging = true;
      p.charge = 0;
    } else if (p.cooldown === 0 && p.slide === 0) {
      // Button without the ball: slide tackle.
      intent.slide = true;
    }
  }

  if (p.charging) {
    if (!owns) {
      p.charging = false;
      p.charge = 0;
    } else {
      p.charge++;
      if (!fire || p.charge >= CHARGE_MAX) {
        const shot = chargeToShot(p.charge);
        // Nudged towards a team-mate, unless you are aiming at their goal.
        const aimed = assistedAim(state, t, i, dir.x || p.dirX, dir.y || p.dirY);
        intent.kick = {
          dx: aimed.x,
          dy: aimed.y,
          power: shot.power,
          lift: shootingAtGoal(state, t, p, aimed) ? Math.min(shot.lift, SHOT_LIFT_MAX) : shot.lift,
        };
      }
    }
  }

  return intent;
}

/**
 * Close enough to be shooting, and pointing between the posts? Then the kick is
 * kept down. The range check matters: the same aim from your own half is a long
 * ball forward, and flattening that would take away every clearance upfield.
 */
function shootingAtGoal(state, t, p, aim) {
  const goalY = targetGoalY(state.teams[t]);
  if (dist(p.x, p.y, FIELD.cx, goalY) > SHOT_FLAT_RANGE) return false;
  return aimedAtGoal(state, t, p, aim);
}

function startSlide(state, p) {
  const b = state.ball;
  state.events.push({ type: 'slide' });
  p.slide = SLIDE_TICKS;
  p.charging = false;
  p.charge = 0;
  const d = norm(p.dirX, p.dirY);
  p.vx = (d.l ? d.x : 0) * SLIDE_SPEED;
  p.vy = (d.l ? d.y : 1) * SLIDE_SPEED;
  if (b.owner) {
    const op = state.teams[b.owner.team].players[b.owner.idx];
    if (op === p) b.owner = null;
  }
}

function movePlayer(state, t, p, mv) {
  const b = state.ball;
  const owns = b.owner && b.owner.team === t && b.owner.idx === p.idx;

  if (p.slide > 0) {
    p.slide--;
    p.vx *= SLIDE_DECAY;
    p.vy *= SLIDE_DECAY;
    if (p.slide === 0) p.cooldown = SLIDE_COOLDOWN;
  } else {
    // A CPU team runs at a fraction of full speed on the easier settings. Human
    // teams (including your AI team-mates) always run at full speed.
    const handicap = state.teams[t].human ? 1 : state.teams[t].ai.speed;
    const speed = (p.role === 'gk'
      ? KEEPER_SPEED
      : owns ? PLAYER_SPEED_BALL : PLAYER_SPEED) * handicap;
    const l = len(mv.x, mv.y);
    if (l > 0.02) {
      p.dirX = mv.x / l;
      p.dirY = mv.y / l;
      const tvx = mv.x * speed;
      const tvy = mv.y * speed;
      p.vx += clamp(tvx - p.vx, -PLAYER_ACC * DT, PLAYER_ACC * DT);
      p.vy += clamp(tvy - p.vy, -PLAYER_ACC * DT, PLAYER_ACC * DT);
    } else {
      p.vx *= PLAYER_DAMP;
      p.vy *= PLAYER_DAMP;
    }
  }
  integratePlayer(p);

  // Carrying it a good way up the pitch is worth a word - once per run, and only
  // for ground actually gained towards their goal, or dribbling in circles would
  // earn you a commentary line.
  if (owns && !p.ran && p.role !== 'gk') {
    const here = advanceOf(state.teams[t], p.y);
    // A run has to start somewhere. Normally that is the moment he takes the
    // ball; if he has it without that ever happening - a restart, a scenario in
    // a test - it starts here rather than silently never counting.
    if (p.runFrom === null || p.runFrom === undefined) p.runFrom = here;
    const gained = here - p.runFrom;
    if (gained > RUN_ADVANCE) {
      p.ran = true;
      state.events.push({ type: 'run', team: t, idx: p.idx });
    }
  }
}

function integratePlayer(p) {
  p.x = clamp(p.x + p.vx * DT, 8, WORLD_W - 8);
  p.y = clamp(p.y + p.vy * DT, 8, WORLD_H - 8);
}

/** Players cannot walk through each other. */
function separatePlayers(state) {
  const all = [];
  for (const team of state.teams) for (const p of team.players) all.push(p);

  const minD = PLAYER_R * 2;
  for (let a = 0; a < all.length; a++) {
    for (let c = a + 1; c < all.length; c++) {
      const p = all[a];
      const q = all[c];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      p.x -= nx * push;
      p.y -= ny * push;
      q.x += nx * push;
      q.y += ny * push;
    }
  }
}

/** Slide tackles: poke the ball away and bring opponents down. */
function resolveTackles(state) {
  const b = state.ball;
  for (let t = 0; t < 2; t++) {
    for (const p of state.teams[t].players) {
      if (p.slide <= 0) continue;

      // Against the ball
      const mayTouch = b.protectedFor === null || b.protectedFor === t;
      if (mayTouch && b.z < 20 && dist2(b.x, b.y, p.x, p.y) < (PLAYER_R + BALL_R + SLIDE_REACH) ** 2) {
        if (!b.owner || b.owner.team !== t) {
          const d = norm(p.vx, p.vy);
          const dx = d.l ? d.x : p.dirX;
          const dy = d.l ? d.y : p.dirY;
          // Poked away rather than hammered clear, so it stays contestable.
          b.vx = dx * 230;
          b.vy = dy * 230;
          b.vz = 40;
          b.owner = null;
          b.lastTouch = { team: t, idx: p.idx };
          b.kicker = null;
          p.cooldown = Math.max(p.cooldown, 10);
        }
      }

      // Against opponents
      const opp = state.teams[1 - t];
      for (const o of opp.players) {
        if (o.down > 0) continue;
        if (dist2(o.x, o.y, p.x, p.y) < (PLAYER_R * 2 + 3) ** 2) {
          o.down = DOWN_TICKS;
          o.vx = p.vx * 0.5;
          o.vy = p.vy * 0.5;
          if (b.owner && b.owner.team === opp.index && b.owner.idx === o.idx) b.owner = null;
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
// Ball
// --------------------------------------------------------------------------

function updateBall(state, inputs) {
  const b = state.ball;

  if (state.phase === 'goal') {
    b.vx *= 0.88;
    b.vy *= 0.88;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.z = Math.max(0, b.z + b.vz * DT);
    b.vz -= GRAVITY * DT;
    if (b.z <= 0) {
      b.z = 0;
      b.vz = 0;
    }
    return;
  }

  if (b.owner) {
    const p = state.teams[b.owner.team].players[b.owner.idx];
    const tx = p.x + p.dirX * DRIBBLE_DIST;
    const ty = p.y + p.dirY * DRIBBLE_DIST;
    b.x += (tx - b.x) * DRIBBLE_LERP;
    b.y += (ty - b.y) * DRIBBLE_LERP;
    b.vx = p.vx;
    b.vy = p.vy;
    b.z = 0;
    b.vz = 0;
    b.spin = 0;
    return;
  }

  applyAftertouch(state, inputs);

  const airborne = b.z > 0.5;
  const damp = airborne ? AIR_DRAG : GROUND_FRICTION;
  b.vx *= damp;
  b.vy *= damp;

  // Rolling resistance on the ground: a flat amount off the speed, which is
  // what stops a slow ball rather than letting it trickle across the pitch.
  if (!airborne) {
    const speed = len(b.vx, b.vy);
    if (speed > 0) {
      const slowed = Math.max(0, speed - ROLL_DRAG * DT);
      b.vx *= slowed / speed;
      b.vy *= slowed / speed;
    }
  }

  // Spin: slowly rotates the velocity vector, which is what bends the ball.
  if (Math.abs(b.spin) > 1e-4) {
    const c = Math.cos(b.spin * DT);
    const s = Math.sin(b.spin * DT);
    const vx = b.vx * c - b.vy * s;
    const vy = b.vx * s + b.vy * c;
    b.vx = vx;
    b.vy = vy;
    b.spin *= SPIN_DECAY;
  }

  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
  b.vz -= GRAVITY * DT;

  if (b.z <= 0) {
    b.z = 0;
    if (b.vz < -40) {
      b.vz = -b.vz * BOUNCE_Z;
      b.vx *= BOUNCE_XY;
      b.vy *= BOUNCE_XY;
    } else {
      b.vz = 0;
    }
  }

  if (Math.abs(b.vx) < 2) b.vx = 0;
  if (Math.abs(b.vy) < 2) b.vy = 0;
}

/**
 * Aftertouch: after a kick, whoever took it can still steer the ball.
 * Sideways relative to the ball = curve, along the ball = lift or dip.
 */
function applyAftertouch(state, inputs) {
  const b = state.ball;
  if (!b.kicker) return;
  if (b.kicker.ticks <= 0) {
    b.kicker = null;
    return;
  }
  b.kicker.ticks--;

  const team = state.teams[b.kicker.team];
  if (!team.human) return;

  const dir = maskToDir(inputs[b.kicker.team] | 0);
  if (!dir.x && !dir.y) return;

  const bd = norm(b.vx, b.vy);
  if (bd.l < 20) return;

  const cross = bd.x * dir.y - bd.y * dir.x; // sideways component
  const dot = bd.x * dir.x + bd.y * dir.y; // component along the ball

  b.vx += -bd.y * cross * AT_SIDE * DT;
  b.vy += bd.x * cross * AT_SIDE * DT;
  b.spin += cross * 1.4 * DT;

  if (b.z > 0.5) {
    b.vz += dot * AT_LIFT * DT;
  } else if (dot > 0) {
    b.vz += dot * AT_LIFT * 0.35 * DT;
  }
}

// --------------------------------------------------------------------------
// Rules of the game
// --------------------------------------------------------------------------

function checkGoal(state) {
  const b = state.ball;
  if (Math.abs(b.x - FIELD.cx) > GOAL_W / 2 || b.z > CROSSBAR_H) return false;

  let scoringTeam = -1;
  if (b.y < FIELD.top - 2) {
    scoringTeam = state.teams[0].attackDir < 0 ? 0 : 1;
    b.y = Math.max(b.y, FIELD.top - GOAL_DEPTH + 8);
  } else if (b.y > FIELD.bottom + 2) {
    scoringTeam = state.teams[0].attackDir > 0 ? 0 : 1;
    b.y = Math.min(b.y, FIELD.bottom + GOAL_DEPTH - 8);
  }
  if (scoringTeam < 0) return false;

  state.score[scoringTeam]++;
  state.lastGoalTeam = scoringTeam;
  state.phase = 'goal';
  state.phaseTimer = GOAL_CELEBRATION_TICKS;
  state.message = 'GOAL!';
  state.events.push({ type: 'goal', team: scoringTeam });
  b.owner = null;
  b.kicker = null;
  b.vx *= 0.3;
  b.vy *= 0.3;
  return true;
}

/** Free kick to the other side, taken where the offside player got involved. */
function whistleOffside(state, teamIdx, player) {
  const x = clamp(player.x, FIELD.left + 20, FIELD.right - 20);
  const y = clamp(player.y, FIELD.top + 20, FIELD.bottom - 20);
  clearOffside(state);
  setRestart(state, x, y, 1 - teamIdx, 'OFFSIDE');
}

function checkOutOfPlay(state) {
  const b = state.ball;
  const lastTeam = b.lastTouch ? b.lastTouch.team : state.kickoffTeam;

  // Touchline -> throw-in
  if (b.x < FIELD.left - BALL_R || b.x > FIELD.right + BALL_R) {
    const x = b.x < FIELD.cx ? FIELD.left + 4 : FIELD.right - 4;
    const y = clamp(b.y, FIELD.top + 24, FIELD.bottom - 24);
    setRestart(state, x, y, 1 - lastTeam, 'THROW-IN');
    return;
  }

  if (b.y >= FIELD.top - BALL_R && b.y <= FIELD.bottom + BALL_R) return;

  // Goal line -> corner or goal kick
  const topEnd = b.y < FIELD.cy;
  const goalY = topEnd ? FIELD.top : FIELD.bottom;
  const defender = state.teams[0].attackDir < 0
    ? (topEnd ? 1 : 0) // team 0 attacks the top, so team 1 defends the top
    : (topEnd ? 0 : 1);

  if (lastTeam === defender) {
    // Corner for the attacking side
    const x = b.x < FIELD.cx ? FIELD.left + 8 : FIELD.right - 8;
    const y = topEnd ? FIELD.top + 8 : FIELD.bottom - 8;
    setRestart(state, x, y, 1 - defender, 'CORNER');
  } else {
    // Goal kick for the defending side
    const x = FIELD.cx + (b.x < FIELD.cx ? -58 : 58);
    const y = topEnd ? FIELD.top + SIX_D : FIELD.bottom - SIX_D;
    setRestart(state, x, y, defender, 'GOAL KICK', 0); // the keeper takes it
  }
}

function setRestart(state, x, y, teamIdx, message, forcedTaker = null) {
  const b = state.ball;
  b.x = x;
  b.y = y;
  b.z = 0;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.spin = 0;
  b.owner = null;
  b.kicker = null;

  clearOffside(state);
  protectFor(state, teamIdx, 'untilTouch', PROTECT_TICKS);

  state.phase = 'restart';
  state.phaseTimer = RESTART_TICKS;
  state.restartTeam = teamIdx;
  state.message = message;
  state.events.push({ type: 'whistle', kind: 'restart' });

  // Nearest outfield player takes it - unless the restart names someone, which
  // a goal kick does: that is the keeper's to take.
  const team = state.teams[teamIdx];
  let takerIdx = forcedTaker === null ? 1 : forcedTaker;
  let bestD = Infinity;
  for (let i = 1; forcedTaker === null && i < team.players.length; i++) {
    const p = team.players[i];
    if (p.down > 0) continue;
    const d = dist2(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      takerIdx = i;
    }
  }
  const taker = team.players[takerIdx];
  const gy = team.attackDir < 0 ? FIELD.bottom : FIELD.top;
  const back = norm(FIELD.cx - x, gy - y);
  taker.x = x + back.x * 12;
  taker.y = y + back.y * 12;
  taker.vx = 0;
  taker.vy = 0;
  taker.dirX = -back.x;
  taker.dirY = -back.y;
  taker.cooldown = 0;
  taker.slide = 0;
  taker.down = 0;
  team.controlled = takerIdx;

  // Push opponents back to a fair distance.
  const opp = state.teams[1 - teamIdx];
  for (const o of opp.players) {
    const d = dist(o.x, o.y, x, y);
    if (d < 46 && d > 0.01) {
      const n = norm(o.x - x, o.y - y);
      o.x = x + n.x * 46;
      o.y = y + n.y * 46;
      o.vx = 0;
      o.vy = 0;
    }
  }
}

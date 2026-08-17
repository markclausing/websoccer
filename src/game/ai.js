import {
  FIELD, FIELD_H, FORMATION, GOAL_W, PEN_D, PEN_W,
} from '../constants.js';
import { clamp, dist, dist2, norm, randRange } from '../util.js';
import { advanceOf, ownGoalY, posFor, targetGoalY } from './state.js';

// The AI runs INSIDE the simulation and only reads state + state.rng. That keeps
// everything deterministic, which is what makes the lockstep netcode work.

function predictBall(state, t = 0.18) {
  const b = state.ball;
  return { x: b.x + b.vx * t, y: b.y + b.vy * t };
}

function nearestOpponent(state, teamIdx, x, y) {
  const opp = state.teams[1 - teamIdx];
  let best = null;
  let bestD = Infinity;
  for (const p of opp.players) {
    if (p.down > 0) continue;
    const d = dist2(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { player: best, d: Math.sqrt(bestD) };
}

/** Which outfield player of this team chases the ball? */
export function chaserIndex(state, teamIdx) {
  const team = state.teams[teamIdx];
  const spot = predictBall(state);
  let best = -1;
  let bestD = Infinity;
  for (let i = 1; i < team.players.length; i++) {
    const p = team.players[i];
    if (p.down > 0) continue;
    const d = dist2(spot.x, spot.y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? 1 : best;
}

/** Formation position, shifted along with the ball. */
function homeSpot(state, teamIdx, i) {
  const team = state.teams[teamIdx];
  const f = FORMATION[i];
  const b = state.ball;
  const adv = advanceOf(team, b.y);
  const yFrac = clamp(f.y + (adv - 0.5) * 0.55, 0.04, 0.95);
  const xRel = clamp(f.x * 0.85 + ((b.x - FIELD.cx) / (FIELD.right - FIELD.cx)) * 0.28, -1, 1);
  return posFor(team, xRel, yFrac);
}

function keeperMove(state, teamIdx) {
  const team = state.teams[teamIdx];
  const k = team.players[0];
  const b = state.ball;
  const gy = ownGoalY(team);
  const inBox = Math.abs(b.y - gy) < PEN_D && Math.abs(b.x - FIELD.cx) < PEN_W / 2;

  let tx;
  let ty;
  if (inBox && dist(k.x, k.y, b.x, b.y) < 90) {
    // Come out for the ball.
    tx = b.x;
    ty = b.y;
  } else {
    // Stay on the line, tracking the ball but hugging the middle.
    tx = FIELD.cx + clamp(b.x - FIELD.cx, -GOAL_W / 2 - 14, GOAL_W / 2 + 14) * 0.85;
    const depth = inBox ? 26 : 14;
    ty = gy + team.attackDir * depth;
  }
  const d = norm(tx - k.x, ty - k.y);
  return d.l < 3 ? { x: 0, y: 0 } : { x: d.x, y: d.y };
}

/** Best team-mate to pass to, or null. */
function findPassTarget(state, teamIdx, from) {
  const team = state.teams[teamIdx];
  const opp = state.teams[1 - teamIdx];
  let best = null;
  let bestScore = -Infinity;

  for (let i = 1; i < team.players.length; i++) {
    const m = team.players[i];
    if (m.idx === from.idx || m.down > 0) continue;
    const d = dist(from.x, from.y, m.x, m.y);
    if (d < 55 || d > 340) continue;

    const forward = (advanceOf(team, m.y) - advanceOf(team, from.y)) * FIELD_H;
    if (forward < -60) continue; // do not play it far backwards
    const marker = nearestOpponent(state, teamIdx, m.x, m.y).d;

    // Is the passing lane clear?
    let blocked = false;
    for (let s = 0.25; s <= 0.85; s += 0.2) {
      const px = from.x + (m.x - from.x) * s;
      const py = from.y + (m.y - from.y) * s;
      for (const o of opp.players) {
        if (o.down > 0) continue;
        if (dist2(px, py, o.x, o.y) < 22 * 22) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (blocked) continue;

    const score = forward * 1.1 + marker * 1.6 - d * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/**
 * Decision for the CPU player who has the ball.
 * Returns a running direction plus an optional kick. The kick is NOT executed
 * here: sim.js carries out every kick only after all 22 players have decided
 * their intent from the same snapshot.
 */
function ownerAction(state, teamIdx, i) {
  const team = state.teams[teamIdx];
  const p = team.players[i];
  const goalY = targetGoalY(team);
  const goalX = FIELD.cx;
  const dGoal = dist(p.x, p.y, goalX, goalY);
  const pressure = nearestOpponent(state, teamIdx, p.x, p.y).d;

  // Keeper: hold on to it briefly, then hoof it upfield.
  if (p.role === 'gk') {
    if (p.holdTicks > 34) {
      const mate = findPassTarget(state, teamIdx, p);
      const tx = mate ? mate.x : FIELD.cx + randRange(state, -180, 180);
      const ty = mate ? mate.y : p.y + team.attackDir * FIELD_H * 0.4;
      const d = norm(tx - p.x, ty - p.y);
      return { x: 0, y: 0, kick: { dx: d.x, dy: d.y, power: 700, lift: 300 } };
    }
    const away = norm(0, team.attackDir);
    return { x: away.x * 0.4, y: away.y };
  }

  // Settle the ball and dribble first: without this brake the AI knocks the ball
  // straight back out again and the game turns into midfield ping-pong.
  const settled = p.holdTicks >= 14;

  // Shooting (allowed sooner than passing: a first-time shot is fine).
  const shootRange = 265;
  if (p.holdTicks >= 5 && dGoal < shootRange && Math.abs(p.x - goalX) < 210) {
    const aimX = goalX + randRange(state, -GOAL_W / 2 + 12, GOAL_W / 2 - 12);
    const d = norm(aimX - p.x, goalY - p.y);
    const lift = dGoal > 170 ? randRange(state, 0, 90) : 0;
    return { x: d.x, y: d.y, kick: { dx: d.x, dy: d.y, power: 760, lift } };
  }

  // Under pressure: pass.
  if (settled && pressure < 52) {
    const mate = findPassTarget(state, teamIdx, p);
    if (mate) {
      const d = norm(mate.x - p.x, mate.y - p.y);
      const dd = dist(p.x, p.y, mate.x, mate.y);
      const power = clamp(dd * 2.1, 340, 720);
      return { x: d.x, y: d.y, kick: { dx: d.x, dy: d.y, power, lift: dd > 220 ? 180 : 0 } };
    }
  }

  // Otherwise: dribble towards goal, going wide if the middle is crowded.
  let tx = goalX;
  let ty = goalY;
  if (dGoal > 300) {
    tx = goalX + clamp(p.x - goalX, -240, 240) * 0.85;
  }
  const opp = nearestOpponent(state, teamIdx, p.x, p.y);
  if (opp.player && opp.d < 70) {
    // Sidestep.
    const away = norm(p.x - opp.player.x, p.y - opp.player.y);
    tx += away.x * 120;
    ty += away.y * 40;
  }
  tx = clamp(tx, FIELD.left + 24, FIELD.right - 24);
  const d = norm(tx - p.x, ty - p.y);
  return { x: d.x, y: d.y };
}

/**
 * Works out the running direction for one AI player, and may return a kick
 * (when this player has the ball and the team is CPU-controlled).
 */
export function aiMove(state, teamIdx, i, opts = {}) {
  const team = state.teams[teamIdx];
  const p = team.players[i];
  const b = state.ball;

  if (p.down > 0 || p.slide > 0) return { x: 0, y: 0 };

  const owner = b.owner;
  const weHaveBall = owner && owner.team === teamIdx;
  const iHaveBall = weHaveBall && owner.idx === i;

  if (iHaveBall) {
    if (opts.allowKicks) return ownerAction(state, teamIdx, i);
    // Human team: this player is being controlled by the human, so do nothing.
    return { x: 0, y: 0 };
  }

  if (p.role === 'gk') return keeperMove(state, teamIdx);

  // Without the ball: the nearest player chases, the rest hold their shape.
  if (!weHaveBall && i === chaserIndex(state, teamIdx)) {
    const spot = predictBall(state, clamp(dist(p.x, p.y, b.x, b.y) / 400, 0.05, 0.35));
    const d = norm(spot.x - p.x, spot.y - p.y);
    return { x: d.x, y: d.y };
  }

  const home = homeSpot(state, teamIdx, i);
  let tx = home.x;
  let ty = home.y;

  if (weHaveBall) {
    // Get available: push up a little towards the opponent's goal.
    ty += team.attackDir * 26;
  } else {
    // Defend: get between the ball and our own goal.
    const gy = ownGoalY(team);
    tx += (b.x - tx) * 0.18;
    ty += (gy - ty) * 0.10;
  }

  const d = norm(tx - p.x, ty - p.y);
  if (d.l < 6) return { x: 0, y: 0 };
  const gain = clamp(d.l / 40, 0.35, 1);
  return { x: d.x * gain, y: d.y * gain };
}

/** May this AI player go in for a slide tackle? Only near the ball carrier. */
export function aiWantsSlide(state, teamIdx, i) {
  const b = state.ball;
  if (!b.owner || b.owner.team === teamIdx) return false;
  const p = state.teams[teamIdx].players[i];
  if (p.cooldown > 0 || p.slide > 0 || p.down > 0 || p.role === 'gk') return false;
  const carrier = state.teams[b.owner.team].players[b.owner.idx];
  const d = dist(p.x, p.y, carrier.x, carrier.y);
  if (d > 34 || d < 12) return false;
  // More aggressive in our own half.
  const own = advanceOf(state.teams[teamIdx], p.y) < 0.4;
  return randRange(state, 0, 1) < (own ? 0.05 : 0.02);
}

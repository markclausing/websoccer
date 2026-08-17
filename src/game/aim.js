import { FIELD, GOAL_W } from '../constants.js';
import { dist, norm } from '../util.js';
import { targetGoalY } from './state.js';

/**
 * Assisted aim for passes.
 *
 * A pass aimed roughly at a team-mate is bent towards him. A shot is left
 * completely alone, and the test for a shot is not how hard you hit it but
 * where you were pointing: if the line you are aiming along crosses the goal
 * line inside the posts, that is an attempt on goal and nothing here touches it.
 * Judging it by power would have ruined the one kick where accuracy matters
 * most - the hard, flat pass across the box is struck exactly like a shot.
 *
 * Runs inside the simulation on both machines from the same inputs, so an online
 * match stays in step.
 */

/** How far off your aim a team-mate may be and still be found, in radians. */
const CONE = 0.5; // about 28 degrees either side

/** How much of the way towards him the ball is bent. 1 would be a full snap. */
const STRENGTH = 0.75;

const MIN_RANGE = 40;
const MAX_RANGE = 460;

/** Would this kick end up in the goalmouth? Then it is a shot, not a pass. */
function aimedAtGoal(state, teamIdx, p, aim) {
  const goalY = targetGoalY(state.teams[teamIdx]);
  const toGoal = goalY - p.y;
  // Pointing away from their goal: cannot be an attempt.
  if (Math.sign(aim.y) !== Math.sign(toGoal) || Math.abs(aim.y) < 0.05) return false;
  const crossing = p.x + aim.x * (toGoal / aim.y);
  // A little wider than the posts, so shots that just shave them count too.
  return Math.abs(crossing - FIELD.cx) < GOAL_W / 2 + 40;
}

/**
 * @returns {{x: number, y: number}} the direction to kick in
 */
export function assistedAim(state, teamIdx, playerIdx, dx, dy) {
  const aim = norm(dx, dy);
  if (!aim.l) return { x: dx, y: dy };

  const team = state.teams[teamIdx];
  const p = team.players[playerIdx];
  if (aimedAtGoal(state, teamIdx, p, aim)) return { x: aim.x, y: aim.y };

  let best = null;
  let bestAngle = CONE;
  for (let i = 0; i < team.players.length; i++) {
    if (i === playerIdx) continue;
    const mate = team.players[i];
    if (mate.down > 0) continue;
    const away = dist(p.x, p.y, mate.x, mate.y);
    if (away < MIN_RANGE || away > MAX_RANGE) continue;

    const to = norm(mate.x - p.x, mate.y - p.y);
    const angle = Math.acos(Math.max(-1, Math.min(1, aim.x * to.x + aim.y * to.y)));
    if (angle < bestAngle) {
      bestAngle = angle;
      best = to;
    }
  }
  if (!best) return { x: aim.x, y: aim.y };

  const bent = norm(
    aim.x + (best.x - aim.x) * STRENGTH,
    aim.y + (best.y - aim.y) * STRENGTH,
  );
  return { x: bent.x, y: bent.y };
}

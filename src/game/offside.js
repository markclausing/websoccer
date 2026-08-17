import { FIELD_H } from '../constants.js';
import { advanceOf } from './state.js';

/**
 * Offside, kept to the part that matters in an arcade game: at the moment the
 * ball is played forward, any team-mate ahead of both the ball and the
 * second-last defender is flagged. If one of them takes the first touch, it is
 * called against them.
 *
 * Everything here reads only from state, so it stays deterministic.
 */

/** How far up the pitch the second-last defender is, as an advance fraction. */
export function offsideLine(state, teamIdx) {
  const opp = state.teams[1 - teamIdx];
  const team = state.teams[teamIdx];
  const advances = opp.players
    .filter((p) => p.down === 0)
    .map((p) => advanceOf(team, p.y))
    .sort((a, b) => b - a); // deepest in our attacking half first
  // The last defender is usually the keeper; the line is the one in front of him.
  return advances.length >= 2 ? advances[1] : (advances[0] ?? 0);
}

/**
 * Called the moment the ball is kicked. Flags the kicking side's team-mates who
 * are in an offside position; clears every other flag.
 */
export function flagOffside(state, teamIdx, kickerIdx) {
  for (const team of state.teams) {
    for (const p of team.players) p.offside = false;
  }
  if (!state.config.offside) return;

  const team = state.teams[teamIdx];
  const line = offsideLine(state, teamIdx);
  const ballAdv = advanceOf(team, state.ball.y);

  for (let i = 0; i < team.players.length; i++) {
    if (i === kickerIdx) continue;
    const p = team.players[i];
    if (p.down > 0) continue;
    const adv = advanceOf(team, p.y);
    // In their half, past the ball, and past the second-last defender. The
    // margin keeps a shoulder from being enough.
    if (adv > 0.5 && adv > ballAdv + 2 / FIELD_H && adv > line + 2 / FIELD_H) {
      p.offside = true;
    }
  }
}

/** Anyone else touching the ball wipes the slate clean. */
export function clearOffside(state) {
  for (const team of state.teams) {
    for (const p of team.players) p.offside = false;
  }
}

/**
 * Where an AI attacker is allowed to stand while his side has the ball: never
 * more than a stride beyond the offside line. Without this the forwards camp
 * behind the defence and the game turns into one long whistle.
 */
export function holdTheLine(state, teamIdx, yFrac) {
  if (!state.config.offside) return yFrac;
  const line = offsideLine(state, teamIdx);
  return Math.min(yFrac, Math.max(line - 6 / FIELD_H, 0.5));
}

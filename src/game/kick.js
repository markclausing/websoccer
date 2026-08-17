import {
  AFTERTOUCH_TICKS, BALL_R, CHARGE_MAX, KICK_COOLDOWN, KICK_MAX_DIST, KICK_MIN_DIST,
  LOB_CHARGE, LOB_MAX, PLAYER_R, speedForDistance,
} from '../constants.js';
import { clamp, norm } from '../util.js';
import { flagOffside } from './offside.js';

/**
 * One central kick function for both human and CPU, so both get exactly the same
 * physics. power in px/s, lift in px/s (vertical).
 */
export function kickBall(state, teamIdx, playerIdx, dx, dy, power, lift) {
  const p = state.teams[teamIdx].players[playerIdx];
  const b = state.ball;
  const d = norm(dx, dy);
  if (d.l === 0) {
    d.x = p.dirX;
    d.y = p.dirY;
  }

  b.x = p.x + d.x * (PLAYER_R + BALL_R + 1);
  b.y = p.y + d.y * (PLAYER_R + BALL_R + 1);
  b.vx = d.x * power + p.vx * 0.28;
  b.vy = d.y * power + p.vy * 0.28;
  b.vz = lift;
  b.spin = 0;
  b.owner = null;
  b.lastTouch = { team: teamIdx, idx: playerIdx };
  // The ball has been played, so it is everybody's again.
  if (b.protectedFor === teamIdx) {
    b.protectedFor = null;
    b.protectTicks = 0;
  }
  b.kicker = { team: teamIdx, idx: playerIdx, ticks: AFTERTOUCH_TICKS };

  state.events.push({ type: 'kick', power, lift });

  // Who was beyond the line at the moment it was played?
  flagOffside(state, teamIdx, playerIdx);

  p.cooldown = KICK_COOLDOWN;
  p.charge = 0;
  p.charging = false;
  p.holdTicks = 0;
  p.dirX = d.x;
  p.dirY = d.y;
}

/** Turns the time the button was held into power + height. */
export function chargeToShot(charge) {
  const t = clamp(charge / CHARGE_MAX, 0, 1);
  const power = speedForDistance(KICK_MIN_DIST + (KICK_MAX_DIST - KICK_MIN_DIST) * t);
  const lift = charge <= LOB_CHARGE
    ? 0
    : LOB_MAX * ((charge - LOB_CHARGE) / (CHARGE_MAX - LOB_CHARGE));
  return { power, lift };
}

import {
  AI_LEVELS, CENTER_R, FIELD, FIELD_H, FIELD_W, FORMATION, TEAM_PRESETS,
  KICKOFF_TICKS, PROTECT_TICKS, TICK_RATE,
} from '../constants.js';
import { clamp } from '../util.js';

// The entire match state lives in one plain object: no DOM, no closures, no
// Math.random. That makes it serialisable (network) and copyable (rollback).

export function createMatch(options = {}) {
  const opts = {
    seed: 12345,
    halfSeconds: 120, // real seconds per half (displayed as 45 match minutes)
    humans: [true, false], // [is team 0 human?, is team 1 human?]
    difficulty: 'hard', // only affects CPU teams; a string, or one key per team
    offside: true, // the offside rule, whistle and all
    ...options,
  };

  const state = {
    tick: 0,
    rng: opts.seed | 0,
    seed: opts.seed | 0,
    config: {
      halfTicks: Math.round(opts.halfSeconds * TICK_RATE),
      offside: opts.offside !== false,
    },
    phase: 'kickoff', // kickoff | play | goal | restart | halftime | fulltime
    phaseTimer: KICKOFF_TICKS,
    half: 1,
    halfTick: 0,
    score: [0, 0],
    message: '',
    kickoffTeam: 0,
    firstKickoffTeam: 0,
    restartTeam: 0,
    lastGoalTeam: -1,
    ball: newBall(),
    teams: [
      makeTeam(0, opts.humans[0], -1, levelFor(opts.difficulty, 0)),
      makeTeam(1, opts.humans[1], +1, levelFor(opts.difficulty, 1)),
    ],
  };

  setupKickoff(state, 0);
  return state;
}

function newBall() {
  return {
    x: FIELD.cx,
    y: FIELD.cy,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    spin: 0,
    owner: null, // {team, idx}
    lastTouch: null, // {team, idx}
    kicker: null, // {team, idx, ticks} -> who is allowed to apply aftertouch
    // While set, only this team may touch the ball, and opponents drop off
    // instead of pressing. Two flavours:
    //   'untilTouch'  - a restart: over the moment the taker has the ball
    //   'untilPlayed' - a keeper holding on: over when he clears it
    protectedFor: null,
    protectMode: 'untilTouch',
    protectTicks: 0,
  };
}

/**
 * `difficulty` is one key for both teams, or one entry per team. An entry may
 * also be a settings object, which is what the tuning tests use.
 */
function levelFor(difficulty, teamIdx) {
  const entry = Array.isArray(difficulty) ? difficulty[teamIdx] : difficulty;
  const level = typeof entry === 'object' && entry !== null ? entry : AI_LEVELS[entry];
  // Copied, so the settings travel with a clone and cannot change mid-match.
  return { ...AI_LEVELS.hard, ...(level || AI_LEVELS.hard) };
}

function makeTeam(index, human, attackDir, ai) {
  const preset = TEAM_PRESETS[index];
  return {
    index,
    ai,
    name: preset.name,
    human: !!human,
    attackDir, // -1 = attacks towards the top (y decreasing), +1 = towards the bottom
    controlled: 9,
    prevMask: 0,
    players: FORMATION.map((f, i) => ({
      idx: i,
      role: f.role,
      x: FIELD.cx,
      y: FIELD.cy,
      vx: 0,
      vy: 0,
      dirX: 0,
      dirY: attackDir,
      charge: 0,
      charging: false,
      slide: 0,
      down: 0,
      cooldown: 0,
      holdTicks: 0,
      offside: false, // flagged when the ball was last played forward past him // how long this player has held the ball (for the keeper's clearance)
    })),
  };
}

/** A position on the pitch for one team, in relative coordinates. */
export function posFor(team, xRel, yFrac) {
  const x = FIELD.cx + clamp(xRel, -1, 1) * (FIELD_W / 2 - 18);
  const y = team.attackDir < 0
    ? FIELD.bottom - yFrac * FIELD_H
    : FIELD.top + yFrac * FIELD_H;
  return { x, y };
}

/** How far a point is towards the opponent's goal (0 = own goal, 1 = their goal). */
export function advanceOf(team, y) {
  const a = team.attackDir < 0
    ? (FIELD.bottom - y) / FIELD_H
    : (y - FIELD.top) / FIELD_H;
  return clamp(a, 0, 1);
}

export function ownGoalY(team) {
  return team.attackDir < 0 ? FIELD.bottom : FIELD.top;
}

export function targetGoalY(team) {
  return team.attackDir < 0 ? FIELD.top : FIELD.bottom;
}

export function setupKickoff(state, kickoffTeam) {
  state.kickoffTeam = kickoffTeam;
  state.phase = 'kickoff';
  state.phaseTimer = KICKOFF_TICKS;
  state.message = '';

  const b = state.ball;
  b.x = FIELD.cx;
  b.y = FIELD.cy;
  b.z = 0;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.spin = 0;
  b.owner = null;
  b.kicker = null;
  // Nobody may nick the ball off the side kicking off until they have played it.
  b.protectedFor = kickoffTeam;
  b.protectMode = 'untilTouch';
  b.protectTicks = PROTECT_TICKS;

  for (const team of state.teams) {
    for (let i = 0; i < team.players.length; i++) {
      const f = FORMATION[i];
      // At kickoff everyone stands in their own half: y is squeezed into [0, 0.47].
      const yFrac = i === 0 ? f.y : Math.min(f.y * 0.62, 0.46);
      const p = posFor(team, f.x, yFrac);
      const pl = team.players[i];
      pl.x = p.x;
      pl.y = p.y;
      pl.vx = 0;
      pl.vy = 0;
      pl.dirX = 0;
      pl.dirY = team.attackDir;
      pl.charge = 0;
      pl.charging = false;
      pl.slide = 0;
      pl.down = 0;
      pl.cooldown = 0;
      pl.holdTicks = 0;
      pl.offside = false;
    }
    team.controlled = 9;
    team.prevMask = 0;
  }

  // The striker of the kickoff team stands next to the ball, on his own side of
  // the halfway line - he used to be placed in the opponent's half.
  const taker = state.teams[kickoffTeam].players[9];
  taker.x = FIELD.cx - 12;
  taker.y = FIELD.cy - state.teams[kickoffTeam].attackDir * 14;
  taker.dirX = 0;
  taker.dirY = state.teams[kickoffTeam].attackDir;
  state.teams[kickoffTeam].controlled = 9;

  // Everyone except the taker keeps out of the centre circle, and by the same
  // measure ends up on his own half: the boundary is always on his own side.
  for (const team of state.teams) {
    for (const p of team.players) {
      if (p === taker) continue;
      const dx = p.x - FIELD.cx;
      const gap = Math.sqrt(Math.max(0, (CENTER_R + 8) ** 2 - dx * dx));
      const limit = FIELD.cy - team.attackDir * gap;
      p.y = team.attackDir < 0 ? Math.max(p.y, limit) : Math.min(p.y, limit);
    }
  }
}

/** Deep copy - the basis for rollback netcode and for replay/debugging. */
export function cloneState(state) {
  return structuredClone(state);
}

/** Cheap checksum to detect desync between two machines. */
export function hashState(state) {
  let h = 2166136261;
  const mix = (v) => {
    h ^= Math.round(v * 16) | 0;
    h = Math.imul(h, 16777619);
  };
  mix(state.tick);
  mix(state.score[0]);
  mix(state.score[1]);
  mix(state.ball.x);
  mix(state.ball.y);
  mix(state.ball.z);
  mix(state.ball.vx);
  mix(state.ball.vy);
  for (const team of state.teams) {
    for (const p of team.players) {
      mix(p.x);
      mix(p.y);
      mix(p.vx);
      mix(p.vy);
    }
  }
  return h >>> 0;
}

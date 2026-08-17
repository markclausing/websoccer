import {
  FIELD, FIELD_H, FIELD_W, FORMATION, TEAM_PRESETS, KICKOFF_TICKS, TICK_RATE,
} from '../constants.js';
import { clamp } from '../util.js';

// De volledige wedstrijdtoestand zit in één plain object: geen DOM, geen closures,
// geen Math.random. Daardoor is het serialiseerbaar (netwerk) en kopieerbaar (rollback).

export function createMatch(options = {}) {
  const opts = {
    seed: 12345,
    halfSeconds: 120, // echte seconden per helft (wordt getoond als 45 speelminuten)
    humans: [true, false], // [team0 is mens?, team1 is mens?]
    ...options,
  };

  const state = {
    tick: 0,
    rng: opts.seed | 0,
    seed: opts.seed | 0,
    config: {
      halfTicks: Math.round(opts.halfSeconds * TICK_RATE),
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
    teams: [makeTeam(0, opts.humans[0], -1), makeTeam(1, opts.humans[1], +1)],
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
    kicker: null, // {team, idx, ticks} -> wie mag aftertouch geven
  };
}

function makeTeam(index, human, attackDir) {
  const preset = TEAM_PRESETS[index];
  return {
    index,
    name: preset.name,
    human: !!human,
    attackDir, // -1 = valt aan richting boven (y omlaag), +1 = richting onder
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
      holdTicks: 0, // hoe lang deze speler de bal al heeft (voor keeper-uittrap)
    })),
  };
}

/** Positie op het veld voor een team, in relatieve coördinaten. */
export function posFor(team, xRel, yFrac) {
  const x = FIELD.cx + clamp(xRel, -1, 1) * (FIELD_W / 2 - 18);
  const y = team.attackDir < 0
    ? FIELD.bottom - yFrac * FIELD_H
    : FIELD.top + yFrac * FIELD_H;
  return { x, y };
}

/** Hoe ver is een punt richting het doel van de tegenstander (0 = eigen doel, 1 = hun doel). */
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

  for (const team of state.teams) {
    for (let i = 0; i < team.players.length; i++) {
      const f = FORMATION[i];
      // Bij de aftrap staat iedereen op eigen helft: y wordt gecomprimeerd naar [0, 0.47].
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
    }
    team.controlled = 9;
    team.prevMask = 0;
  }

  // De spits van het aftrappende team staat bij de bal.
  const taker = state.teams[kickoffTeam].players[9];
  taker.x = FIELD.cx - 12;
  taker.y = FIELD.cy + state.teams[kickoffTeam].attackDir * 14;
  taker.dirX = 0;
  taker.dirY = state.teams[kickoffTeam].attackDir;
  state.teams[kickoffTeam].controlled = 9;
}

/** Diepe kopie — basis voor rollback-netcode en voor replay/debug. */
export function cloneState(state) {
  return structuredClone(state);
}

/** Goedkope checksum om desync tussen twee machines te detecteren. */
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

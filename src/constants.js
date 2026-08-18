// All world units are "pixels" at zoom 1. The pitch is portrait, like the
// 16-bit classics; the camera scrolls along with the ball.

export const TICK_RATE = 60;

/** Seconds of real time per tick. The game loop paces itself by this. */
export const FRAME_TIME = 1 / TICK_RATE;

/**
 * One knob for the overall speed of the game. Below 1 everything happens more
 * slowly without anything moving differently: the pitch, the shooting ranges and
 * the timings in ticks all stay exactly where they were, only the clock the
 * physics runs on is turned down. Friction and damping are per tick, so they are
 * raised to the same power to keep passes travelling just as far.
 */
export const PACE = 0.9;

/** Seconds of game time per tick. Everything in the simulation integrates by this. */
export const DT = PACE / TICK_RATE;

export const FIELD_W = 640;
export const FIELD_H = 1000;
export const OUT_MARGIN = 80; // grass outside the lines

export const WORLD_W = FIELD_W + OUT_MARGIN * 2;
export const WORLD_H = FIELD_H + OUT_MARGIN * 2;

export const FIELD = {
  left: OUT_MARGIN,
  top: OUT_MARGIN,
  right: OUT_MARGIN + FIELD_W,
  bottom: OUT_MARGIN + FIELD_H,
  cx: OUT_MARGIN + FIELD_W / 2,
  cy: OUT_MARGIN + FIELD_H / 2,
};

// Pitch markings
export const GOAL_W = 146;
export const GOAL_DEPTH = 34;
export const CROSSBAR_H = 46; // balls higher than this go over the bar
export const PEN_W = 340;
export const PEN_D = 150;
export const SIX_W = 176;
export const SIX_D = 58;
export const PEN_SPOT = 100;
export const CENTER_R = 95;
export const ARC_R = 90;
export const CORNER_R = 14;

// Player
export const PLAYER_R = 7;
export const PLAYER_ACC = 1500;
export const PLAYER_SPEED = 176;
export const PLAYER_SPEED_BALL = 158; // slightly slower with the ball at your feet
export const KEEPER_SPEED = 168;
export const PLAYER_DAMP = 0.80 ** PACE;

// A slide used to cover 55px - four player widths - and cost you 0.8 seconds
// whether it connected or not, which made it a gamble rather than a tackle.
// It now reaches about 90px and you are back on your feet sooner.
export const SLIDE_TICKS = 28;
export const SLIDE_SPEED = 380;
export const SLIDE_DECAY = 0.955;
export const SLIDE_COOLDOWN = 14;
/** How near the ball a sliding boot has to come. */
export const SLIDE_REACH = 11;
export const DOWN_TICKS = 46;

// Ball
export const BALL_R = 4;
export const GRAVITY = 980;
// Per tick, and raised to PACE so slowing the game does not also change how far
// a ball travels. These used to be 0.9855 and 0.9985, which let a full power
// shot roll 88% of the length of the pitch and a lob cross 93% of it in under
// two seconds - the ball behaved as if the grass were ice. Now a full shot
// covers a little over half the pitch and a lob about the same.
export const GROUND_FRICTION = 0.9855 ** PACE;
export const AIR_DRAG = 0.9985 ** PACE;

// Rolling resistance: a flat amount of speed lost per second, on top of the
// proportional friction above. The proportional term alone barely touches a
// slow ball, which is why a gentle pass used to trickle on for six seconds.
// This kills the long tail without changing how a firmly struck ball starts.
export const ROLL_DRAG = 130;
export const BOUNCE_Z = 0.56;
export const BOUNCE_XY = 0.86;
export const SPIN_DECAY = 0.985 ** PACE;

// Ball control
export const CONTROL_R = 15;
export const KEEPER_CONTROL_R = 22;
export const CONTROL_Z = 26;
export const KEEPER_CONTROL_Z = 52;
export const DRIBBLE_DIST = 13;
export const DRIBBLE_LERP = 1 - (1 - 0.30) ** PACE;

// Kicking.
//
// Power is expressed as the distance the ball should travel, not as a speed.
// A rolling ball loses a fixed fraction of its speed per tick, so distance is
// speed * DT / (1 - friction): change the friction and every kick in the game
// silently changes length. That is exactly what happened when the ball was made
// heavier - passes fell short of their target, attacks died in midfield and the
// scoreline went to nil. Ask for a distance and the friction can be tuned for
// feel without touching the balance.
export const CHARGE_MAX = 30; // ticks (0.5s) to reach full power
export const KICK_MIN_DIST = 367; // a tap
export const KICK_MAX_DIST = 896; // a full blooded shot
export const LOB_CHARGE = 9; // from this charge on, the ball leaves the ground
export const LOB_MAX = 320;
export const KICK_COOLDOWN = 16;

/** Launch speed for a ball that should come to rest after `dist` pixels. */
export function speedForDistance(dist) {
  return (dist * (1 - GROUND_FRICTION)) / DT;
}

// Aftertouch: bending the ball after you have kicked it
export const AFTERTOUCH_TICKS = 70;
export const AT_SIDE = 700; // sideways acceleration -> curve
export const AT_LIFT = 340; // forward/backward -> lift or dip

// Match
export const GOAL_CELEBRATION_TICKS = 150;
export const KICKOFF_TICKS = 50;
export const RESTART_TICKS = 36;
export const HALFTIME_TICKS = 150;

// A restart is protected until the taker touches it; this is only the backstop
// that stops an untaken restart lasting forever.
export const PROTECT_TICKS = 260;

// How long your own choice of player stands before the automatic switch takes
// over again. Long enough to run somewhere with him, short enough that you are
// never stuck with the wrong man.
export const MANUAL_HOLD_TICKS = 100;

// A keeper's hold is topped up every tick he actually has the ball, so this is
// just how long the opposition keeps its distance after he lets go of it. Keep
// it short: an early version protected him for four seconds after every routine
// catch, which locked strikers out of every rebound and cost about nine out of
// ten goals in the match.
export const KEEPER_HOLD_TICKS = 40;

// ...and the six second rule, roughly: hang on to it longer than this and the
// opposition is allowed to close in again. Without it a keeper could stand on
// the ball untouchable for the whole match.
export const KEEPER_HOLD_MAX = 330;

// CPU difficulty. HARD is the original behaviour and is deliberately left at the
// neutral values (no delay, no error, multiplier 1), so picking it reproduces the
// game exactly as it played before difficulties existed.
//
// These only ever apply to a CPU team. Your own AI team-mates always play at full
// strength - weakening them would make the game harder for you, not easier.
//
// Tuned by playing each level against HARD. The yardstick is territory - the
// share of playing time the ball spends in the opponent's half - because goals
// are far too rare to measure with: HARD ~49%, NORMAL ~38%, EASY ~30%.
// tools/simtest.js keeps an eye on it.
//
// slideChance was halved when slides themselves were made to reach further and
// connect more often: the same frequency then meant being robbed constantly.
//
// reactTicks is by far the strongest lever: a team that chases where the ball was
// three ticks ago barely wins possession back. Everything else is comparatively
// mild on its own, but shapes how the level feels to play against - a slower
// opponent you can outrun, sloppier passes you can intercept, fewer slide
// tackles taking the ball off your feet.
export const AI_LEVELS = {
  easy: {
    key: 'easy',
    label: 'EASY',
    reactTicks: 7,
    aimError: 40,
    passError: 20,
    settleTicks: 18,
    shootRange: 220,
    pressure: 42,
    speed: 0.93,
    slideChance: 0.2,
  },
  normal: {
    key: 'normal',
    label: 'NORMAL',
    reactTicks: 4,
    aimError: 15,
    passError: 5,
    settleTicks: 15,
    shootRange: 250,
    pressure: 50,
    speed: 0.98,
    slideChance: 0.45,
  },
  hard: {
    key: 'hard',
    label: 'HARD',
    reactTicks: 0,
    aimError: 0,
    passError: 0,
    settleTicks: 14,
    shootRange: 265,
    pressure: 52,
    speed: 1,
    slideChance: 0.7,
  },
};

export const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16, SWITCH: 32 };

export const TEAM_PRESETS = [
  { name: 'BLUE', shirt: '#2f6fd0', shorts: '#1b3f7a', trim: '#ffffff', skin: '#e8b98a', hair: '#3a2415' },
  { name: 'RED', shirt: '#d33b3b', shorts: '#7a1b1b', trim: '#ffffff', skin: '#8d5524', hair: '#221109' },
];

export const KEEPER_KIT = [
  { shirt: '#f2d43c', shorts: '#3a3a3a', trim: '#222222', skin: '#e8b98a', hair: '#3a2415' },
  { shirt: '#3ad07a', shorts: '#3a3a3a', trim: '#222222', skin: '#8d5524', hair: '#221109' },
];

// 4-3-3. x in [-1,1] (width), y in [0,1] (0 = own goal line, 1 = their goal line)
export const FORMATION = [
  { x: 0.00, y: 0.025, role: 'gk' },
  { x: -0.62, y: 0.19, role: 'df' },
  { x: -0.22, y: 0.13, role: 'df' },
  { x: 0.22, y: 0.13, role: 'df' },
  { x: 0.62, y: 0.19, role: 'df' },
  { x: -0.45, y: 0.42, role: 'mf' },
  { x: 0.00, y: 0.37, role: 'mf' },
  { x: 0.45, y: 0.42, role: 'mf' },
  { x: -0.56, y: 0.68, role: 'fw' },
  { x: 0.00, y: 0.76, role: 'fw' },
  { x: 0.56, y: 0.68, role: 'fw' },
];

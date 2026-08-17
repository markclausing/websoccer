// All world units are "pixels" at zoom 1. The pitch is portrait, like the
// 16-bit classics; the camera scrolls along with the ball.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

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
export const PLAYER_DAMP = 0.80;

export const SLIDE_TICKS = 26;
export const SLIDE_SPEED = 260;
export const SLIDE_COOLDOWN = 22;
export const DOWN_TICKS = 46;

// Ball
export const BALL_R = 4;
export const GRAVITY = 980;
export const GROUND_FRICTION = 0.9855; // per tick
export const AIR_DRAG = 0.9985;
export const BOUNCE_Z = 0.56;
export const BOUNCE_XY = 0.86;
export const SPIN_DECAY = 0.985;

// Ball control
export const CONTROL_R = 15;
export const KEEPER_CONTROL_R = 22;
export const CONTROL_Z = 26;
export const KEEPER_CONTROL_Z = 52;
export const DRIBBLE_DIST = 13;
export const DRIBBLE_LERP = 0.30;

// Kicking
export const CHARGE_MAX = 30; // ticks (0.5s) to reach full power
export const KICK_MIN = 320;
export const KICK_MAX = 780;
export const LOB_CHARGE = 9; // from this charge on, the ball leaves the ground
export const LOB_MAX = 320;
export const KICK_COOLDOWN = 16;

// Aftertouch: bending the ball after you have kicked it
export const AFTERTOUCH_TICKS = 70;
export const AT_SIDE = 700; // sideways acceleration -> curve
export const AT_LIFT = 340; // forward/backward -> lift or dip

// Match
export const GOAL_CELEBRATION_TICKS = 150;
export const KICKOFF_TICKS = 50;
export const RESTART_TICKS = 36;
export const HALFTIME_TICKS = 150;

// CPU difficulty. HARD is the original behaviour and is deliberately left at the
// neutral values (no delay, no error, multiplier 1), so picking it reproduces the
// game exactly as it played before difficulties existed.
//
// These only ever apply to a CPU team. Your own AI team-mates always play at full
// strength - weakening them would make the game harder for you, not easier.
//
// Tuned by playing each level against HARD, 60 CPU-vs-CPU matches per level over
// two separate seed ranges (tools/simtest.js keeps an eye on it). Share of the
// goals scored: HARD ~50%, NORMAL ~33%, EASY ~14%.
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
    reactTicks: 3,
    aimError: 60,
    passError: 35,
    settleTicks: 22,
    shootRange: 195,
    pressure: 34,
    speed: 0.88,
    slideChance: 0.25,
  },
  normal: {
    key: 'normal',
    label: 'NORMAL',
    reactTicks: 2,
    aimError: 20,
    passError: 8,
    settleTicks: 16,
    shootRange: 245,
    pressure: 48,
    speed: 0.97,
    slideChance: 0.7,
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
    slideChance: 1,
  },
};

export const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16 };

export const TEAM_PRESETS = [
  { name: 'BLUE', shirt: '#2f6fd0', shorts: '#1b3f7a', trim: '#ffffff', skin: '#e8b98a' },
  { name: 'RED', shirt: '#d33b3b', shorts: '#7a1b1b', trim: '#ffffff', skin: '#8d5524' },
];

export const KEEPER_KIT = [
  { shirt: '#f2d43c', shorts: '#3a3a3a', trim: '#222222', skin: '#e8b98a' },
  { shirt: '#3ad07a', shorts: '#3a3a3a', trim: '#222222', skin: '#8d5524' },
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

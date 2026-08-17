import {
  BALL_R, CHARGE_MAX, FIELD, FIELD_H, KEEPER_KIT, PLAYER_R, TEAM_PRESETS,
  WORLD_H, WORLD_W,
} from '../constants.js';
import { clamp } from '../util.js';
import { buildPitch } from './pitch.js';
import { SPRITE_H, SPRITE_W, facing, kitSprites } from './sprites.js';

const ZOOM = 1.35;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pitch = buildPitch();
    this.cam = { x: FIELD.cx, y: FIELD.cy };
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  /** Camera follows the ball with a little lead; purely cosmetic, outside the sim. */
  updateCamera(state, instant = false) {
    const b = state.ball;
    const targetX = clamp(b.x + b.vx * 0.16, 0, WORLD_W);
    const targetY = clamp(b.y + b.vy * 0.16, 0, WORLD_H);
    const k = instant ? 1 : 0.12;
    this.cam.x += (targetX - this.cam.x) * k;
    this.cam.y += (targetY - this.cam.y) * k;

    const halfW = this.canvas.width / (2 * ZOOM);
    const halfH = this.canvas.height / (2 * ZOOM);
    this.cam.x = WORLD_W <= halfW * 2 ? WORLD_W / 2 : clamp(this.cam.x, halfW, WORLD_W - halfW);
    this.cam.y = WORLD_H <= halfH * 2 ? WORLD_H / 2 : clamp(this.cam.y, halfH, WORLD_H - halfH);
  }

  draw(state, net = null) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    this.updateCamera(state);
    if (state.phase === 'goal' && state.phaseTimer > 130) this.shake = 8;
    this.shake *= 0.88;
    const sx = (this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0);
    const sy = (this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0);
    this.shakeX = sx;
    this.shakeY = sy;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d3d18';
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(ZOOM, 0, 0, ZOOM, -this.cam.x * ZOOM + W / 2 + sx, -this.cam.y * ZOOM + H / 2 + sy);
    ctx.drawImage(this.pitch, 0, 0);

    this.drawShadows(ctx, state);

    // Players from top to bottom, so overlaps look right.
    const all = [];
    for (let t = 0; t < 2; t++) {
      state.teams[t].players.forEach((p, i) => all.push({ p, t, i }));
    }
    all.sort((a, b) => a.p.y - b.p.y);
    for (const e of all) this.drawPlayer(ctx, state, e.t, e.i, e.p);

    this.drawBall(ctx, state);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHud(ctx, state, net);
    this.drawRadar(ctx, state);
    this.drawMessage(ctx, state, net);
    if (net) this.drawNetStatus(ctx, net);
  }

  drawShadows(ctx, state) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const team of state.teams) {
      for (const p of team.players) {
        ctx.beginPath();
        ctx.ellipse(p.x + 1.5, p.y + 4, PLAYER_R * 0.85, PLAYER_R * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const b = state.ball;
    const s = clamp(1 - b.z / 260, 0.4, 1);
    ctx.beginPath();
    ctx.ellipse(b.x + 2, b.y + 3, BALL_R * s, BALL_R * 0.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** World point to whole screen pixels: sprites have to land on the grid. */
  toScreen(x, y) {
    return {
      x: Math.round((x - this.cam.x) * ZOOM + this.canvas.width / 2 + this.shakeX),
      y: Math.round((y - this.cam.y) * ZOOM + this.canvas.height / 2 + this.shakeY),
    };
  }

  drawPlayer(ctx, state, t, i, p) {
    const team = state.teams[t];
    const kit = i === 0 ? KEEPER_KIT[t] : TEAM_PRESETS[t];
    const isControlled = team.human && team.controlled === i;
    const sprites = kitSprites(kit, ZOOM, `${t}-${i === 0 ? 'gk' : 'out'}`);

    let view = facing(p.dirX, p.dirY);
    if (p.slide > 0 || p.down > 0) {
      view = `slide${view[0].toUpperCase()}${view.slice(1)}`;
    }
    const sprite = sprites[view] || sprites.down;

    // Drawn in screen space, on whole pixels, so the art stays square.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const at = this.toScreen(p.x, p.y);
    ctx.drawImage(
      sprite,
      at.x - Math.round(sprite.width / 2),
      // Feet a little below the point the simulation tracks, so he stands on it.
      at.y - Math.round(sprite.height * 0.60),
    );
    ctx.imageSmoothingEnabled = true;
    ctx.restore();

    if (isControlled) {
      // Arrow above the player you control
      ctx.fillStyle = t === 0 ? '#9fd0ff' : '#ffc0c0';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - PLAYER_R - 3);
      ctx.lineTo(p.x - 4, p.y - PLAYER_R - 9);
      ctx.lineTo(p.x + 4, p.y - PLAYER_R - 9);
      ctx.closePath();
      ctx.fill();

      if (p.charging && p.charge > 0) {
        const w = 22;
        const f = clamp(p.charge / CHARGE_MAX, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(p.x - w / 2, p.y + PLAYER_R + 4, w, 3);
        ctx.fillStyle = f > 0.75 ? '#ff5a3c' : '#ffd93c';
        ctx.fillRect(p.x - w / 2, p.y + PLAYER_R + 4, w * f, 3);
      }
    }
  }

  drawBall(ctx, state) {
    const b = state.ball;
    const y = b.y - b.z * 0.6;
    const r = BALL_R + clamp(b.z / 120, 0, 1.6);
    ctx.beginPath();
    ctx.arc(b.x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }

  drawHud(ctx, state, net) {
    const W = this.canvas.width;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textBaseline = 'middle';

    const label = `${state.teams[0].name} ${state.score[0]} - ${state.score[1]} ${state.teams[1].name}`;
    const clock = `${String(matchMinute(state)).padStart(2, '0')}'`;
    const text = `${label}   ${clock}`;
    const w = ctx.measureText(text).width + 28;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W / 2 - w / 2, 8, w, 30);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, 24);

    // Who is who
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'left';
    let y = 52;
    for (let t = 0; t < 2; t++) {
      const team = state.teams[t];
      let who;
      if (net) who = t === net.team ? 'YOU' : 'OPPONENT';
      else who = team.human ? `PLAYER ${t + 1}` : 'CPU';
      ctx.fillStyle = TEAM_PRESETS[t].shirt;
      ctx.fillRect(12, y - 6, 10, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${team.name} - ${who}`, 28, y);
      y += 16;
    }
  }

  drawNetStatus(ctx, net) {
    const H = this.canvas.height;
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const quality = net.ping < 60 ? '#7fe08a' : net.ping < 140 ? '#ffd93c' : '#ff7a5a';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(8, H - 30, 128, 22);
    ctx.fillStyle = quality;
    ctx.fillText(`ONLINE  ${net.ping} ms`, 16, H - 19);

    if (net.stalling && !net.peerLeft && !net.desync) {
      const W = this.canvas.width;
      const text = 'WAITING FOR OPPONENT';
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 24;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - w / 2, H - 62, w, 26);
      ctx.fillStyle = '#ffd93c';
      ctx.fillText(text, W / 2, H - 49);
    }
  }

  drawRadar(ctx, state) {
    const W = this.canvas.width;
    const rw = 72;
    const rh = rw * (WORLD_H / WORLD_W);
    const rx = W - rw - 12;
    const ry = 48;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(rx - 3, ry - 3, rw + 6, rh + 6);
    ctx.fillStyle = 'rgba(40,120,60,0.85)';
    ctx.fillRect(rx, ry, rw, rh);

    const sx = rw / WORLD_W;
    const sy = rh / WORLD_H;

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + FIELD.left * sx, ry + FIELD.top * sy, (FIELD.right - FIELD.left) * sx, FIELD_H * sy);

    for (let t = 0; t < 2; t++) {
      ctx.fillStyle = TEAM_PRESETS[t].shirt;
      for (const p of state.teams[t].players) {
        ctx.fillRect(rx + p.x * sx - 1, ry + p.y * sy - 1, 2.5, 2.5);
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rx + state.ball.x * sx - 1, ry + state.ball.y * sy - 1, 2.5, 2.5);

    // Viewport
    const vw = (this.canvas.width / ZOOM) * sx;
    const vh = (this.canvas.height / ZOOM) * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.strokeRect(rx + this.cam.x * sx - vw / 2, ry + this.cam.y * sy - vh / 2, vw, vh);
  }

  drawMessage(ctx, state, net) {
    if (!state.message) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let text = state.message;
    if (state.phase === 'goal') {
      text = `${state.teams[state.lastGoalTeam].name} SCORES!`;
    } else if (state.phase === 'fulltime') {
      text = `FULL TIME  ${state.score[0]} - ${state.score[1]}`;
    }

    ctx.font = 'bold 44px "Courier New", monospace';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, W / 2, H / 2 - 30);
    ctx.fillStyle = state.phase === 'goal' ? '#ffe14d' : '#ffffff';
    ctx.fillText(text, W / 2, H / 2 - 30);

    if (state.phase === 'fulltime' && !net) {
      // Online gets its own overlay with a button instead.
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Press ENTER for the menu', W / 2, H / 2 + 16);
    }
  }
}

export function matchMinute(state) {
  const frac = clamp(state.halfTick / state.config.halfTicks, 0, 1);
  return Math.floor((state.half - 1) * 45 + frac * 45);
}

// 她的脸：画在一张画布上再贴到头的正面。表情、眨眼、视线、说话的嘴型都是实时画出来的。
import * as THREE from 'three';
import { clamp, TAU, rand } from './util.js';

const W = 640, H = 360;
const EYE_DX = 128, EYE_Y = 206, MOUTH_Y = 300;

/** 表情预设：眼睛、嘴、眉毛、腮红的组合。 */
export const EXPRESSIONS = {
  neutral: { eyes: 'open', mouth: 'smile', brow: 'none', blush: 0.25 },
  smile: { eyes: 'open', mouth: 'open', brow: 'none', blush: 0.4 },
  happy: { eyes: 'happy', mouth: 'open', brow: 'none', blush: 0.6 },
  joy: { eyes: 'sparkle', mouth: 'open', brow: 'up', blush: 0.6 },
  love: { eyes: 'happy', mouth: 'cat', brow: 'none', blush: 1 },
  shy: { eyes: 'open', mouth: 'wavy', brow: 'worry', blush: 1, look: [0.7, 0.5] },
  sad: { eyes: 'sad', mouth: 'frown', brow: 'worry', blush: 0.15 },
  angry: { eyes: 'angry', mouth: 'pout', brow: 'down', blush: 0.5 },
  surprise: { eyes: 'wide', mouth: 'o', brow: 'up', blush: 0.25 },
  sleepy: { eyes: 'half', mouth: 'o', brow: 'none', blush: 0.3 },
  sleep: { eyes: 'closed', mouth: 'flat', brow: 'none', blush: 0.35 },
  think: { eyes: 'open', mouth: 'flat', brow: 'up', blush: 0.25, look: [0.6, -0.7] },
  focus: { eyes: 'open', mouth: 'flat', brow: 'none', blush: 0.2 },
  cat: { eyes: 'open', mouth: 'cat', brow: 'none', blush: 0.45 },
  smug: { eyes: 'half', mouth: 'cat', brow: 'none', blush: 0.4 },
  dizzy: { eyes: 'dizzy', mouth: 'wavy', brow: 'worry', blush: 0.3 },
};

export class Face {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.expr = 'neutral';
    this.state = { ...EXPRESSIONS.neutral };
    this.gaze = { x: 0, y: 0 }; this.gazeDrawn = { x: 9, y: 9 };
    this.blink = 0; this.nextBlink = 2;
    this.talk = 0; this.talkPhase = 0; this.talkOpen = 0; this.talkDrawn = -1;
    this.dirty = true;
    this.draw();
  }

  /** 切换表情（名字见 EXPRESSIONS）。 */
  set(name) {
    if (!EXPRESSIONS[name]) name = 'neutral';
    if (this.expr === name) return;
    this.expr = name;
    this.state = { ...EXPRESSIONS[name] };
    this.dirty = true;
  }

  /** 视线：x、y 在 [-1, 1]，x 正方向是她的左边（屏幕右边）。 */
  look(x, y) { this.gaze.x = clamp(x, -1, 1); this.gaze.y = clamp(y, -1, 1); }

  /** 说话 sec 秒（嘴一张一合）。 */
  speak(sec) { this.talk = Math.max(this.talk, sec); }

  update(dt) {
    // 眨眼
    const canBlink = ['open', 'wide', 'sad', 'angry', 'half', 'sparkle'].includes(this.state.eyes);
    this.nextBlink -= dt;
    if (this.blink > 0) { this.blink -= dt; if (this.blink <= 0) this.dirty = true; }
    else if (this.nextBlink <= 0 && canBlink) { this.blink = 0.11; this.nextBlink = rand(1.6, 5.5); if (Math.random() < 0.18) this.nextBlink = 0.25; this.dirty = true; }
    // 说话
    if (this.talk > 0) {
      this.talk -= dt; this.talkPhase += dt * 13;
      this.talkOpen = this.talk > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(this.talkPhase) * Math.sin(this.talkPhase * 0.37 + 1)) : 0;
      const q = Math.round(this.talkOpen * 5);
      if (q !== this.talkDrawn) { this.talkDrawn = q; this.dirty = true; }
    }
    const gx = this.state.look ? this.state.look[0] : this.gaze.x, gy = this.state.look ? this.state.look[1] : this.gaze.y;
    if (Math.abs(gx - this.gazeDrawn.x) > 0.06 || Math.abs(gy - this.gazeDrawn.y) > 0.06) this.dirty = true;
    if (this.dirty) { this.gazeDrawn = { x: gx, y: gy }; this.draw(); }
  }

  draw() {
    const g = this.g;
    this.dirty = false;
    g.clearRect(0, 0, W, H);
    const s = this.state;
    const cx = W / 2;
    // 腮红
    for (const sx of [-1, 1]) {
      const bx = cx + sx * 188, by = 282;
      const gr = g.createRadialGradient(bx, by, 2, bx, by, 46);
      const a = 0.2 + 0.5 * s.blush;
      gr.addColorStop(0, `rgba(255,120,130,${a})`); gr.addColorStop(1, 'rgba(255,120,130,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(bx, by, 50, 26, 0, 0, TAU); g.fill();
      if (s.blush > 0.7) {
        g.strokeStyle = 'rgba(240,90,110,0.75)'; g.lineWidth = 3; g.lineCap = 'round';
        for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(bx + i * 13 - 4, by + 8); g.lineTo(bx + i * 13 + 4, by - 8); g.stroke(); }
      }
    }
    const eyes = this.blink > 0 ? 'closed' : s.eyes;
    this.#eye(cx - EYE_DX, EYE_Y, -1, eyes);
    this.#eye(cx + EYE_DX, EYE_Y, 1, eyes);
    this.#brows(cx, s.brow);
    this.#mouth(cx, MOUTH_Y, this.talk > 0 ? 'talk' : s.mouth);
    this.texture.needsUpdate = true;
  }

  #brows(cx, kind) {
    if (kind === 'none') return;
    const g = this.g;
    g.strokeStyle = '#2a3a8a'; g.lineWidth = 6; g.lineCap = 'round';
    for (const sx of [-1, 1]) {
      const x = cx + sx * EYE_DX, y = 112;
      g.beginPath();
      if (kind === 'up') { g.moveTo(x - 28, y - 2); g.quadraticCurveTo(x, y - 16, x + 28, y - 2); }
      else if (kind === 'down') { g.moveTo(x - sx * 34, y + 8); g.lineTo(x + sx * 26, y - 14); }
      else if (kind === 'worry') { g.moveTo(x - sx * 30, y + 4); g.quadraticCurveTo(x, y - 6, x + sx * 26, y - 14); }
      g.stroke();
    }
  }

  #eye(x, y, side, kind) {
    const g = this.g;
    const RX = 58, RY = 70;
    const lash = '#141a40';
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (kind === 'closed') {
      g.strokeStyle = lash; g.lineWidth = 9;
      g.beginPath(); g.moveTo(x - RX + 6, y + 14); g.quadraticCurveTo(x, y + 40, x + RX - 6, y + 14); g.stroke();
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(x + side * (RX - 8), y + 16); g.lineTo(x + side * (RX + 8), y + 6); g.stroke();
      return;
    }
    if (kind === 'happy') {
      g.strokeStyle = lash; g.lineWidth = 10;
      g.beginPath(); g.moveTo(x - RX + 4, y + 22); g.quadraticCurveTo(x, y - 34, x + RX - 4, y + 22); g.stroke();
      return;
    }
    if (kind === 'dizzy') {
      g.strokeStyle = lash; g.lineWidth = 6;
      g.beginPath();
      for (let a = 0; a < TAU * 2.6; a += 0.2) { const r = 4 + a * 3; g.lineTo(x + Math.cos(a) * r, y + 6 + Math.sin(a) * r); }
      g.stroke();
      return;
    }
    const gaze = this.gazeDrawn;
    const half = kind === 'half';
    const wide = kind === 'wide';
    const top = half ? y - RY * 0.28 : y - RY;
    // 眼白
    g.save();
    g.beginPath(); g.ellipse(x, y, RX, RY, 0, 0, TAU); g.clip();
    if (half) { g.beginPath(); g.rect(x - RX - 4, top, RX * 2 + 8, RY * 2); g.clip(); }
    if (kind === 'angry') { g.beginPath(); g.moveTo(x - side * (RX + 6), y - RY - 4); g.lineTo(x - side * (RX + 6), y + RY + 4); g.lineTo(x + side * (RX + 6), y + RY + 4); g.lineTo(x + side * (RX + 6), y - RY * 0.72); g.lineTo(x - side * (RX + 6), y - RY * 0.05 - 30); g.closePath(); g.clip(); }
    if (kind === 'sad') { g.beginPath(); g.moveTo(x + side * (RX + 6), y - RY - 4); g.lineTo(x + side * (RX + 6), y + RY + 4); g.lineTo(x - side * (RX + 6), y + RY + 4); g.lineTo(x - side * (RX + 6), y - RY * 0.86); g.lineTo(x + side * (RX + 6), y - RY * 0.3); g.closePath(); g.clip(); }
    const wg = g.createLinearGradient(0, y - RY, 0, y + RY);
    wg.addColorStop(0, '#cfd6f2'); wg.addColorStop(0.35, '#ffffff'); wg.addColorStop(1, '#ffffff');
    g.fillStyle = wg; g.fillRect(x - RX, y - RY, RX * 2, RY * 2);
    // 虹膜
    const irx = wide ? 34 : 47, iry = wide ? 42 : 60;
    const ix = x + gaze.x * (RX - irx + 5), iy = y + 4 + gaze.y * (RY - iry + 5) + (kind === 'sad' ? 6 : 0);
    const ig = g.createLinearGradient(0, iy - iry, 0, iy + iry);
    ig.addColorStop(0, '#13246e'); ig.addColorStop(0.45, '#2a58d0'); ig.addColorStop(1, '#69c6ff');
    g.fillStyle = ig; g.beginPath(); g.ellipse(ix, iy, irx, iry, 0, 0, TAU); g.fill();
    g.strokeStyle = '#101c58'; g.lineWidth = 4; g.stroke();
    // 瞳孔
    g.fillStyle = '#0b1548'; g.beginPath(); g.ellipse(ix, iy - 4, irx * 0.45, iry * 0.5, 0, 0, TAU); g.fill();
    // 下半的亮弧
    g.fillStyle = 'rgba(170,232,255,0.75)'; g.beginPath(); g.ellipse(ix, iy + iry * 0.56, irx * 0.62, iry * 0.26, 0, 0, TAU); g.fill();
    // 高光
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(ix - 15, iy - iry * 0.42, irx * 0.34, iry * 0.26, -0.4, 0, TAU); g.fill();
    g.beginPath(); g.arc(ix + irx * 0.42, iy + iry * 0.34, irx * 0.14, 0, TAU); g.fill();
    if (kind === 'sparkle') {
      for (const [dx, dy, r] of [[18, -18, 11], [-22, 22, 8]]) {
        g.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rr = i % 2 ? r * 0.35 : r; g.lineTo(ix + dx + Math.cos(a) * rr, iy + dy + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      }
    }
    // 上眼皮投下的一点阴影
    const sh = g.createLinearGradient(0, top, 0, top + 34);
    sh.addColorStop(0, 'rgba(20,26,64,0.45)'); sh.addColorStop(1, 'rgba(20,26,64,0)');
    g.fillStyle = sh; g.fillRect(x - RX, top, RX * 2, 34);
    g.restore();
    // 睫毛线
    g.strokeStyle = lash; g.lineWidth = 11;
    g.beginPath();
    if (half) { g.moveTo(x - RX - 2, top + 4); g.quadraticCurveTo(x, top - 8, x + RX + 2, top + 4); }
    else if (kind === 'angry') { g.moveTo(x - side * (RX + 2), y - 30); g.lineTo(x + side * (RX + 2), y - RY * 0.72); }
    else if (kind === 'sad') { g.moveTo(x - side * (RX + 2), y - RY * 0.86); g.quadraticCurveTo(x, y - RY * 0.8, x + side * (RX + 2), y - RY * 0.3); }
    else { g.moveTo(x - RX - 2, y - RY * 0.22); g.bezierCurveTo(x - RX * 0.8, y - RY * 1.12, x + RX * 0.8, y - RY * 1.12, x + RX + 2, y - RY * 0.22); }
    g.stroke();
    // 外眼角的小翘
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(x + side * (RX + 1), y - RY * 0.24); g.lineTo(x + side * (RX + 13), y - RY * 0.42); g.stroke();
    // 下眼线
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(20,26,64,0.7)';
    g.beginPath(); g.ellipse(x, y, RX, RY, 0, side > 0 ? 0.25 : Math.PI - 1.15, side > 0 ? 1.15 : Math.PI - 0.25); g.stroke();
    if (kind === 'sad') {
      g.fillStyle = 'rgba(150,215,255,0.9)';
      g.beginPath(); g.ellipse(x + side * 34, y + RY - 2, 8, 12, 0, 0, TAU); g.fill();
    }
  }

  #mouth(x, y, kind) {
    const g = this.g;
    const line = '#7a2f40';
    g.strokeStyle = line; g.fillStyle = line; g.lineWidth = 5.5; g.lineCap = 'round'; g.lineJoin = 'round';
    const openMouth = (w, h) => {
      g.beginPath(); g.moveTo(x - w, y - 4); g.quadraticCurveTo(x, y - 9, x + w, y - 4);
      g.bezierCurveTo(x + w * 0.9, y + h, x - w * 0.9, y + h, x - w, y - 4); g.closePath();
      g.fillStyle = '#8a2f44'; g.fill();
      g.save(); g.clip();
      g.fillStyle = '#ff8fa6'; g.beginPath(); g.ellipse(x, y + h * 0.82, w * 0.62, h * 0.42, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x - w * 0.62, y - 8); g.lineTo(x - w * 0.38, y - 8); g.lineTo(x - w * 0.5, y + 5); g.closePath(); g.fill();
      g.restore();
      g.lineWidth = 4; g.strokeStyle = line; g.stroke();
    };
    switch (kind) {
      case 'smile': g.beginPath(); g.moveTo(x - 17, y - 3); g.quadraticCurveTo(x, y + 11, x + 17, y - 3); g.stroke(); break;
      case 'open': openMouth(25, 30); break;
      case 'talk': if (this.talkOpen < 0.12) { g.beginPath(); g.moveTo(x - 12, y); g.lineTo(x + 12, y); g.stroke(); } else openMouth(15 + this.talkOpen * 9, 8 + this.talkOpen * 26); break;
      case 'o': g.beginPath(); g.ellipse(x, y + 4, 9, 12, 0, 0, TAU); g.fillStyle = '#8a2f44'; g.fill(); g.lineWidth = 3.5; g.stroke(); break;
      case 'flat': g.beginPath(); g.moveTo(x - 11, y + 2); g.lineTo(x + 11, y + 2); g.stroke(); break;
      case 'frown': g.beginPath(); g.moveTo(x - 16, y + 10); g.quadraticCurveTo(x, y - 6, x + 16, y + 10); g.stroke(); break;
      case 'pout': g.beginPath(); g.moveTo(x - 15, y + 9); g.lineTo(x, y - 3); g.lineTo(x + 15, y + 9); g.stroke(); break;
      case 'cat': g.beginPath(); g.moveTo(x - 22, y - 2); g.quadraticCurveTo(x - 11, y + 12, x, y - 1); g.quadraticCurveTo(x + 11, y + 12, x + 22, y - 2); g.stroke(); break;
      case 'wavy': g.beginPath(); g.moveTo(x - 20, y + 2); g.bezierCurveTo(x - 12, y - 8, x - 6, y + 12, x, y + 2); g.bezierCurveTo(x + 6, y - 8, x + 12, y + 12, x + 20, y + 2); g.stroke(); break;
      default:
    }
  }
}

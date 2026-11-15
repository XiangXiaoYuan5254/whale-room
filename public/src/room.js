// 房间：墙、窗、床、书桌、椅子、书架、地毯、盆栽……全部用几何体现搭，没有任何预渲染图片。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry, TAU } from './util.js';
import { buildQuilt } from './quilt.js';

export const ROOM = { x0: -2.1, x1: 2.1, z0: -1.8, z1: 1.8, h: 2.6 };
export const WIN = { x0: -1.72, x1: 0.02, y0: 0.99, y1: 2.15, z: -1.8 };

/** 房间里她能去的地方。surface 是落脚面，yaw 是到位后的朝向（0 = 面朝屏幕外 +z）。 */
export const PLACES = {
  bedEdge: { surface: 'bed', x: -1.05, z: -0.81, yaw: 0 },
  bedLie: { surface: 'bed', x: -1.05, z: -1.12, yaw: -Math.PI / 2 },
  bedSleep: { surface: 'bed', x: -1.36, z: -1.2, yaw: Math.PI / 2 },
  bedWindow: { surface: 'bed', x: -0.95, z: -1.36, yaw: Math.PI },
  sill: { surface: 'sill', x: -0.42, z: -1.66, yaw: Math.PI - 0.4 }, // 右边那扇窗格正中（中间的窗框不挡脸），身子朝房间侧一点
  sillSit: { surface: 'sill', x: -1.2, z: -1.63, yaw: Math.PI / 2 },
  computer: { surface: 'desk', x: 1.12, z: -1.19, yaw: Math.PI },
  lamp: { surface: 'desk', x: 1.58, z: -1.2, yaw: Math.PI * 0.75 },
  chair: { surface: 'chair', x: 1.1, z: -0.6, yaw: 0 },
  bookshelf: { surface: 'floor', x: 1.5, z: 0.85, yaw: Math.PI / 2 },
  cushion: { surface: 'floor', x: -0.86, z: 0.8, yaw: -Math.PI / 2 - 0.4 },
  rug: { surface: 'floor', x: -0.15, z: 0.45, yaw: 0 },
  plant: { surface: 'floor', x: -1.36, z: 1.12, yaw: -Math.PI * 0.72 },
  front: { surface: 'floor', x: 0.25, z: 1.35, yaw: 0 },
  underDesk: { surface: 'floor', x: 1.05, z: -1.32, yaw: 0 },
  door: { surface: 'floor', x: 1.2, z: 1.5, yaw: 0 },
};
export const CUSHION = { x: -1.25, z: 0.95, r: 0.3, top: 0.168 }; // top：她坐上去之后（垫子被压扁一点）屁股所在的高度
export const RUG = { x: -0.15, z: 0.45, r: 0.9 };
export const PLANT = { x: -1.72, z: 1.42 };
/** 她在床上睡觉、趴着看手机的那条线（z）。被子也沿着这条线铺。 */
export const BED_LINE = -1.2;
/** 枕头朝床尾那一面的 x、枕头的中心高度：手机靠在这一面上。 */
export const PILLOW = { faceX: -1.54, y: 0.5, r: 0.065 };

const std = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });

function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, mat, x, y, z, shadow) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, shadow);
const rbox = (w, h, d, r, mat, x, y, z) => mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat, x, y, z);
const cyl = (rt, rb, h, mat, x, y, z, seg = 24) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  return t;
}

function floorTexture() {
  const rnd = mulberry(7);
  return canvasTex(1024, 1024, (g, w, h) => {
    const rows = 9, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 300;
      while (x < w) {
        const len = 260 + rnd() * 240;
        const l = 30 + rnd() * 9;
        g.fillStyle = `hsl(${24 + rnd() * 8}, ${32 + rnd() * 10}%, ${l}%)`;
        g.fillRect(x, r * ph, len, ph);
        g.globalAlpha = 0.09;
        for (let i = 0; i < 10; i++) {
          g.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
          g.fillRect(x, r * ph + rnd() * ph, len, 1 + rnd() * 2);
        }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(20,10,6,0.55)';
        g.fillRect(x + len - 2, r * ph, 2, ph);
        x += len;
      }
      g.fillStyle = 'rgba(20,10,6,0.6)';
      g.fillRect(0, r * ph, w, 2);
    }
  }, { repeat: [2.2, 2.2] });
}

function rugTexture() {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    const rings = [[250, '#e9eef8'], [236, '#3d5aa8'], [214, '#dfe8f6'], [200, '#6f93d6'], [150, '#dfe8f6'], [138, '#89a9e0']];
    for (const [r, col] of rings) { g.fillStyle = col; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill(); }
    g.fillStyle = '#f4f7fd';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      star(g, c + Math.cos(a) * 175, c + Math.sin(a) * 175, 10, 4.5);
    }
    // 中间一只小鲸鱼
    g.save(); g.translate(c, c + 6); g.scale(1.5, 1.5);
    whale(g, '#3d5aa8', '#dfe8f6');
    g.restore();
  });
}

function star(g, x, y, r, r2) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const rr = i % 2 ? r2 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

/** 画一只朝左的小鲸鱼（原点在身体中心，身长约 80）。 */
export function whale(g, body, belly) {
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(-40, 4);
  g.bezierCurveTo(-42, -26, 6, -30, 24, -6);
  g.bezierCurveTo(30, -4, 36, -14, 44, -22);
  g.bezierCurveTo(44, -10, 42, -4, 36, 2);
  g.bezierCurveTo(44, 4, 48, 10, 50, 18);
  g.bezierCurveTo(40, 14, 32, 10, 26, 8);
  g.bezierCurveTo(10, 26, -36, 26, -40, 4);
  g.fill();
  g.fillStyle = belly;
  g.beginPath();
  g.moveTo(-38, 10);
  g.bezierCurveTo(-20, 16, 0, 16, 18, 10);
  g.bezierCurveTo(4, 24, -30, 24, -38, 10);
  g.fill();
  g.fillStyle = belly;
  g.beginPath(); g.arc(-24, -2, 3, 0, TAU); g.fill();
  // 喷水
  g.strokeStyle = body; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-8, -26); g.quadraticCurveTo(-8, -40, -18, -42); g.stroke();
  g.beginPath(); g.moveTo(-8, -26); g.quadraticCurveTo(-8, -40, 2, -42); g.stroke();
}

function posterTexture() {
  return canvasTex(384, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0d1a4a'); grad.addColorStop(0.55, '#2a4fa8'); grad.addColorStop(1, '#69c0f0');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const rnd = mulberry(3);
    g.fillStyle = '#fff';
    for (let i = 0; i < 60; i++) { g.globalAlpha = 0.3 + rnd() * 0.7; g.fillRect(rnd() * w, rnd() * h * 0.5, 2, 2); }
    g.globalAlpha = 1;
    g.fillStyle = '#fdf6d8'; g.beginPath(); g.arc(w * 0.74, h * 0.2, 34, 0, TAU); g.fill();
    g.save(); g.translate(w * 0.48, h * 0.6); g.scale(2.6, 2.6); whale(g, '#0f1f5c', '#bfe0ff'); g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3;
    for (let i = 0; i < 3; i++) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, h * (0.84 + i * 0.05) + Math.sin(x / 26 + i) * 6); g.stroke(); }
    g.strokeStyle = '#f4f1e8'; g.lineWidth = 12; g.strokeRect(0, 0, w, h);
  });
}

function corkTexture() {
  return canvasTex(384, 288, (g, w, h) => {
    g.fillStyle = '#b98a5a'; g.fillRect(0, 0, w, h);
    const rnd = mulberry(11);
    for (let i = 0; i < 900; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(90,60,30,0.25)' : 'rgba(255,230,190,0.2)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    const notes = [[36, 30, 96, 80, '#fff3a8', -0.08], [150, 44, 90, 110, '#ffffff', 0.05], [262, 26, 92, 76, '#bfe3ff', 0.1], [50, 140, 110, 100, '#ffd0dc', 0.04], [200, 176, 130, 84, '#ffffff', -0.06]];
    for (const [x, y, nw, nh, col, rot] of notes) {
      g.save(); g.translate(x + nw / 2, y + nh / 2); g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-nw / 2 + 3, -nh / 2 + 4, nw, nh);
      g.fillStyle = col; g.fillRect(-nw / 2, -nh / 2, nw, nh);
      g.fillStyle = 'rgba(40,50,90,0.55)';
      for (let l = 0; l < Math.floor(nh / 16) - 1; l++) g.fillRect(-nw / 2 + 10, -nh / 2 + 14 + l * 14, nw * (0.5 + rnd() * 0.35), 3);
      g.fillStyle = '#d9483b'; g.beginPath(); g.arc(0, -nh / 2 + 7, 5, 0, TAU); g.fill();
      g.restore();
    }
    g.strokeStyle = '#6b4a2c'; g.lineWidth = 14; g.strokeRect(0, 0, w, h);
  });
}

/** 笔记本屏幕：一个会自己「刷短视频」的小画面。 */
class LaptopScreen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320; this.canvas.height = 208;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.on = false;
    this.t = 0; this.acc = 0;
    this.cur = this.#video(); this.next = null; this.swipe = 0; this.left = 5;
    this.video = null; // 正在看的那个 B 站视频：{ title, owner, duration, img, t }
    this.page = null; // 正在看的网页（她上网冲浪时）：{ site, title, excerpt, t }
    this.#draw();
  }
  /**
   * 屏幕上换成一张网页：顶上是网站的颜色条和名字，下面是标题和正文开头，正文会慢慢往下滚，像在读。
   * 只画她的冲浪工具报过来的标题和摘要，不是真的打开了那个网页。
   * @param p { site: 网站名（牛客 / 小红书 / 新闻源）, title, excerpt（正文开头，可以没有） }
   */
  showPage(p) {
    this.page = { site: String(p.site || '网页').slice(0, 20), title: String(p.title || '').slice(0, 120), excerpt: String(p.excerpt || '').replace(/\s+/g, ' ').slice(0, 240), t: 0 };
    this.#draw();
  }
  clearPage() { this.page = null; }
  #browser(g, w, h) {
    const p = this.page;
    const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
    const color = SITE_COLORS.find(([k]) => p.site.includes(k))?.[1] ?? '#3b4a6b';
    g.fillStyle = '#d6dbe4'; g.fillRect(0, 0, w, h); // 别用纯白：夜里会被辉光冲成一片
    // 顶栏：网站颜色 + 名字 + 地址栏
    g.fillStyle = color; g.fillRect(0, 0, w, 24);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#fff'; g.font = `700 12px ${FONT}`;
    g.fillText(p.site, 9, 12.5);
    const sw = Math.min(g.measureText(p.site).width, 90);
    g.fillStyle = 'rgba(255,255,255,0.28)'; roundRect(g, sw + 18, 6, w - sw - 28, 12, 6); g.fill();
    // 正文区：标题（最多两行）+ 摘要，摘要慢慢往上滚
    const wrap = (text, font, maxW, maxLines) => {
      g.font = font; const lines = []; let cur = '';
      for (const ch of text) {
        if (g.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; if (lines.length >= maxLines) break; } else cur += ch;
      }
      if (lines.length < maxLines && cur) lines.push(cur);
      else if (lines.length >= maxLines) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
      return lines;
    };
    const top = 24, inner = w - 26;
    const scroll = Math.min(Math.max(0, p.t - 6) * 2.2, 60); // 先看几秒标题，再往下读
    g.save(); g.beginPath(); g.rect(0, top, w, h - top); g.clip(); g.translate(0, -scroll);
    g.textBaseline = 'alphabetic';
    const titleLines = wrap(p.title || '（没有标题）', `700 15px ${FONT}`, inner, 2);
    g.fillStyle = '#121826';
    titleLines.forEach((l, i) => g.fillText(l, 10, top + 22 + i * 20));
    let y = top + 22 + titleLines.length * 20 + 4;
    g.fillStyle = '#6f7789'; g.font = `10px ${FONT}`; g.fillText('刚刚 · ' + p.site, 10, y); y += 16;
    if (p.excerpt) {
      g.fillStyle = '#343d50';
      for (const l of wrap(p.excerpt, `12px ${FONT}`, inner, 12)) { g.fillText(l, 10, y); y += 17; }
    }
    g.fillStyle = 'rgba(60,70,100,0.12)'; // 没有摘要、或摘要读完了：下面是一行行灰条
    for (let i = 0; i < 6; i++) { g.fillRect(10, y + i * 15, inner * (0.55 + ((i * 37) % 40) / 100), 6); }
    g.restore();
    // 右边的滚动条
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(w - 6, top + 4, 3, h - top - 8);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(w - 6, top + 4 + (scroll / 60) * (h - top - 50), 3, 38);
  }
  /**
   * 屏幕上放一个指定的视频（主人分享的、或者她自己要看的）：显示它的封面、标题、UP 主和播放进度。
   * 只是把公开的封面和标题画出来，不是真的在播视频。
   * @param v { title, owner, duration（秒）, cover（封面图地址，可以没有） }
   */
  showVideo(v) {
    const video = { title: v.title || 'B 站视频', owner: v.owner || '', duration: v.duration || 0, img: null, t: 0 };
    this.video = video;
    if (v.cover) {
      const img = new Image();
      img.onload = () => { video.img = img; };
      img.onerror = () => console.warn('[电脑] 视频封面没取到，屏幕上只显示标题', v.cover);
      img.src = v.cover;
    }
  }
  /** 不看那个视频了，回到随便刷。 */
  clearVideo() { this.video = null; }
  #player(g, w, h) {
    const v = this.video;
    g.fillStyle = '#0d0f16'; g.fillRect(0, 0, w, h);
    const ph = h - 44; // 画面区
    if (v.img) { // 封面铺满画面区（居中裁切）
      const k = Math.max(w / v.img.width, ph / v.img.height), iw = v.img.width * k, ih = v.img.height * k;
      g.save(); g.beginPath(); g.rect(0, 0, w, ph); g.clip(); g.drawImage(v.img, (w - iw) / 2, (ph - ih) / 2, iw, ih); g.restore();
    } else { const gr = g.createLinearGradient(0, 0, w, ph); gr.addColorStop(0, '#fb7299'); gr.addColorStop(1, '#23ade5'); g.fillStyle = gr; g.fillRect(0, 0, w, ph); }
    // 底部：进度条 + 标题 + UP 主
    const dur = v.duration > 0 ? v.duration : 180, p = Math.min(1, v.t / dur);
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, ph - 3, w, 3); g.fillStyle = '#fb7299'; g.fillRect(0, ph - 3, w * p, 3);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * p, ph - 1.5, 4, 0, TAU); g.fill();
    const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#f4f6fb'; g.font = `600 15px ${FONT}`;
    let title = v.title; while (title.length > 4 && g.measureText(title).width > w - 16) title = title.slice(0, -2) + '…';
    g.fillText(title, 8, ph + 19);
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    g.fillStyle = '#9aa3b8'; g.font = `12px ${FONT}`;
    g.fillText(`${v.owner ? 'UP ' + v.owner + ' · ' : ''}${mmss(Math.min(v.t, dur))} / ${mmss(dur)}`, 8, ph + 37);
  }
  #video() {
    const h = Math.random() * 360;
    return { h, kind: Math.floor(Math.random() * 4), seed: Math.random() * 100, likes: Math.floor(Math.random() * 900) / 10 };
  }
  #scene(g, v, w, h, t) {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${v.h}, 70%, 58%)`); grad.addColorStop(1, `hsl(${(v.h + 70) % 360}, 75%, 34%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    if (v.kind === 0) { // 跳动的音柱
      for (let i = 0; i < 14; i++) { const bh = 20 + Math.abs(Math.sin(t * 5 + i * 0.9 + v.seed)) * 80; g.fillRect(34 + i * 14, h * 0.62 - bh, 9, bh); }
    } else if (v.kind === 1) { // 一只蹦跳的猫脸
      const y = h * 0.5 - Math.abs(Math.sin(t * 4)) * 26;
      g.beginPath(); g.arc(w * 0.42, y, 34, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(w * 0.42 - 30, y - 18); g.lineTo(w * 0.42 - 22, y - 48); g.lineTo(w * 0.42 - 6, y - 28); g.fill();
      g.beginPath(); g.moveTo(w * 0.42 + 30, y - 18); g.lineTo(w * 0.42 + 22, y - 48); g.lineTo(w * 0.42 + 6, y - 28); g.fill();
      g.fillStyle = '#333'; g.fillRect(w * 0.42 - 14, y - 6, 6, 9); g.fillRect(w * 0.42 + 8, y - 6, 6, 9);
    } else if (v.kind === 2) { // 转圈的星星
      for (let i = 0; i < 5; i++) { const a = t * 1.6 + (i / 5) * TAU; star(g, w * 0.42 + Math.cos(a) * 52, h * 0.48 + Math.sin(a) * 40, 13, 6); }
      star(g, w * 0.42, h * 0.48, 22, 10);
    } else { // 游过去的鲸鱼
      const x = ((t * 46 + v.seed * 30) % (w + 160)) - 80;
      g.save(); g.translate(w - x, h * 0.48 + Math.sin(t * 2) * 8); g.scale(1.1, 1.1); whale(g, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0.5)'); g.restore();
    }
    // 右侧的点赞栏、底部文字条
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.arc(w - 26, h * 0.34, 9, 0, TAU); g.fill();
    g.fillStyle = '#ff4d6d'; heart(g, w - 26, h * 0.54, 10);
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(w - 34, h * 0.7, 16, 12);
    g.fillRect(14, h - 40, 120, 7); g.fillRect(14, h - 26, 170, 5);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, h - 5, w, 5);
    g.fillStyle = '#fff'; g.fillRect(0, h - 5, w * ((t * 0.12 + v.seed) % 1), 5);
  }
  #draw() {
    const g = this.g, w = this.canvas.width, h = this.canvas.height;
    if (!this.on) {
      g.fillStyle = '#05070c'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(120,150,220,0.06)'; g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.6, 0); g.lineTo(w, 0); g.lineTo(w * 0.4, h); g.fill();
    } else if (this.video) {
      this.#player(g, w, h);
    } else if (this.page) {
      this.#browser(g, w, h);
    } else if (this.next) {
      const k = this.swipe * this.swipe * (3 - 2 * this.swipe);
      g.save(); g.translate(0, -h * k); this.#scene(g, this.cur, w, h, this.t); g.restore();
      g.save(); g.translate(0, h * (1 - k)); this.#scene(g, this.next, w, h, this.t); g.restore();
    } else {
      this.#scene(g, this.cur, w, h, this.t);
    }
    this.texture.needsUpdate = true;
  }
  set(on) { if (this.on !== on) { this.on = on; this.#draw(); } }
  /** 让她的「滑一下」和画面切换对上。 */
  swipeNow() { if (this.on && !this.next) { this.next = this.#video(); this.swipe = 0; } }
  update(dt) {
    if (!this.on) return;
    this.t += dt; this.acc += dt;
    if (this.video) { this.video.t += dt; if (this.acc > 0.25) { this.acc = 0; this.#draw(); } return; }
    if (this.page) { this.page.t += dt; if (this.acc > 0.2) { this.acc = 0; this.#draw(); } return; }
    if (this.next) {
      this.swipe += dt * 2.6;
      if (this.swipe >= 1) { this.cur = this.next; this.next = null; this.left = 4 + Math.random() * 7; }
    } else {
      this.left -= dt;
      if (this.left <= 0) this.swipeNow();
    }
    if (this.acc > 0.09) { this.acc = 0; this.#draw(); }
  }
}

/** 笔记本上网时各网站顶栏的颜色（按名字里含的字认）。 */
const SITE_COLORS = [['牛客', '#1fb48e'], ['小红书', '#ff2442'], ['百度', '#4e6ef2'], ['澎湃', '#1a7fd1'], ['IT之家', '#d22222'], ['少数派', '#d7262f'], ['量子位', '#2f5bea'], ['阮一峰', '#5c6b7a'], ['B 站', '#fb7299'], ['QQ', '#12b7f5']];

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function heart(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.8);
  g.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.1, x, y - s * 0.3);
  g.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.2, x, y + s * 0.8);
  g.fill();
}

/** 竖着的褶皱布（窗帘）。 */
function curtain(w, h, folds, mat) {
  const geo = new THREE.PlaneGeometry(w, h, folds * 6, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const k = 0.6 + 0.4 * (0.5 - y / h); // 下摆褶子更深
    p.setZ(i, Math.sin((x / w) * folds * TAU) * 0.035 * k + Math.sin((x / w) * folds * 2.3 * TAU + 1) * 0.012);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 被子的花纹：灰蓝底上撒小星星和小圆点。 */
function blanketTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8f9bb8'; g.fillRect(0, 0, 256, 256);
  const star = (x, y, r, col) => {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, q = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    g.closePath(); g.fill();
  };
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = i * 64 + (j % 2 ? 32 : 0) + 16, y = j * 64 + 20;
    star(x, y, 11, (i + j) % 3 ? '#c9d6f2' : '#e9eefc');
    g.fillStyle = '#7a88aa'; g.beginPath(); g.arc(x + 32, y + 30, 3.2, 0, TAU); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); t.anisotropy = 8;
  return t;
}
/** 床单：很淡的细条纹。 */
function sheetTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e3e9f6'; for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 5, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 1); t.anisotropy = 8;
  return t;
}

function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.09, 0.05, 0.11, 0.2, 0, 0.3);
  s.bezierCurveTo(-0.11, 0.2, -0.09, 0.05, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -y * y * 0.9 + Math.abs(p.getX(i)) * 0.25); }
  geo.computeVertexNormals();
  return geo;
}

export function buildRoom(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const R = ROOM;
  const W = R.x1 - R.x0, D = R.z1 - R.z0;

  // ---------- 材质 ----------
  const mWall = std(0xcfc9dc, 0.95);
  mWall.shadowSide = THREE.DoubleSide;
  const mWallB = std(0xbfb8d0, 0.95);
  mWallB.shadowSide = THREE.DoubleSide;
  const mTrim = std(0xf2efe9, 0.7);
  const mWood = std(0x8a5a3a, 0.6);
  const mWoodDark = std(0x5e3b26, 0.65);
  const mWoodLight = std(0xc79a6a, 0.6);
  const mSheet = std(0xe9eef6, 0.95, { map: sheetTexture() });
  const mPillow = std(0xf7f8fc, 0.95);
  const mBlanket = std(0xffffff, 0.98, { side: THREE.DoubleSide, map: blanketTexture() });
  const mCurtain = std(0x5b6a9c, 0.95, { side: THREE.DoubleSide });
  const mMetal = std(0x9aa0aa, 0.35, { metalness: 0.7 });
  const mDark = std(0x23262e, 0.6);
  const mFabric = std(0x4c5f8f, 0.95);

  // ---------- 地板 ----------
  const floor = mesh(new THREE.PlaneGeometry(W, D), std(0xffffff, 0.62, { map: floorTexture() }), 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  g.add(floor);
  // 地板厚度（从侧面看不至于是张纸）
  g.add(box(W + 0.12, 0.12, D + 0.12, mWoodDark, 0, -0.062, 0, false));

  // ---------- 墙（单面：从外面看是透明的，方便随意转镜头） ----------
  const wallPlane = (w, h, mat, x, y, z, ry) => {
    const m = mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z);
    m.rotation.y = ry;
    return m;
  };
  // 后墙绕着窗洞拼四块
  const bw = [
    [R.x0, WIN.x0, 0, R.h], [WIN.x1, R.x1, 0, R.h], [WIN.x0, WIN.x1, 0, WIN.y0], [WIN.x0, WIN.x1, WIN.y1, R.h],
  ];
  for (const [x0, x1, y0, y1] of bw) g.add(wallPlane(x1 - x0, y1 - y0, mWall, (x0 + x1) / 2, (y0 + y1) / 2, R.z0, 0));
  g.add(wallPlane(D, R.h, mWallB, R.x0, R.h / 2, 0, Math.PI / 2));
  g.add(wallPlane(D, R.h, mWallB, R.x1, R.h / 2, 0, -Math.PI / 2));
  g.add(wallPlane(W, R.h, mWall, 0, R.h / 2, R.z1, Math.PI));
  // 只负责挡光的隐形天花板和外沿（不然日光/月光会从没有屋顶的上方漏进来）
  const mBlocker = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  const ceil = mesh(new THREE.PlaneGeometry(W + 6, D + 6), mBlocker, 0, R.h, 0);
  ceil.rotation.x = Math.PI / 2; ceil.receiveShadow = false;
  g.add(ceil);
  for (const [x0, x1, y0, y1] of [[R.x0 - 3, R.x0, 0, R.h], [R.x1, R.x1 + 3, 0, R.h]]) {
    const b = wallPlane(x1 - x0, y1 - y0, mBlocker, (x0 + x1) / 2, (y0 + y1) / 2, R.z0, 0);
    b.receiveShadow = false; g.add(b);
  }
  // 踢脚线
  g.add(box(W, 0.09, 0.02, mTrim, 0, 0.045, R.z0 + 0.01, false));
  g.add(box(0.02, 0.09, D, mTrim, R.x0 + 0.01, 0.045, 0, false));
  g.add(box(0.02, 0.09, D, mTrim, R.x1 - 0.01, 0.045, 0, false));

  // ---------- 窗 ----------
  const wx = (WIN.x0 + WIN.x1) / 2, wy = (WIN.y0 + WIN.y1) / 2, ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
  const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ color: 0x223355 }));
  windowPane.position.set(wx, wy, R.z0 - 0.03);
  windowPane.name = 'window';
  g.add(windowPane);
  const fr = 0.05;
  g.add(box(ww + fr * 2, fr, 0.09, mTrim, wx, WIN.y1 + fr / 2, R.z0));
  g.add(box(ww + fr * 2, fr, 0.09, mTrim, wx, WIN.y0 - fr / 2 + 0.02, R.z0));
  g.add(box(fr, wh, 0.09, mTrim, WIN.x0 - fr / 2, wy, R.z0));
  g.add(box(fr, wh, 0.09, mTrim, WIN.x1 + fr / 2, wy, R.z0));
  g.add(box(0.045, wh, 0.06, mTrim, wx, wy, R.z0));
  g.add(box(ww, 0.035, 0.05, mTrim, wx, WIN.y0 + wh * 0.62, R.z0));
  // 窗台（她能坐上去）
  const sill = rbox(ww + 0.12, 0.045, 0.34, 0.015, mTrim, wx, 0.948, R.z0 + 0.17);
  sill.name = 'sill';
  g.add(sill);
  // 窗帘杆 + 两侧窗帘
  const rod = cyl(0.012, 0.012, ww + 0.9, mMetal, wx, 2.33, R.z0 + 0.07, 10);
  rod.rotation.z = Math.PI / 2; g.add(rod);
  const cl = curtain(0.34, 1.8, 3, mCurtain); cl.position.set(WIN.x0 - 0.2, 1.42, R.z0 + 0.075); g.add(cl);
  const cr = curtain(0.34, 1.8, 3, mCurtain); cr.position.set(WIN.x1 + 0.22, 1.42, R.z0 + 0.075); g.add(cr);
  // 窗框上的小串灯
  const bulbs = [];
  const bulbGeo = new THREE.SphereGeometry(0.016, 10, 8);
  const wire = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = WIN.x0 - 0.02 + t * (ww + 0.04);
    const y = WIN.y1 + 0.1 - Math.abs(Math.sin(t * Math.PI * 4)) * 0.07;
    wire.push(new THREE.Vector3(x, y + 0.012, R.z0 + 0.05));
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4030, emissive: [0xffd27a, 0xffa9c4, 0x9fd4ff][i % 3], emissiveIntensity: 0 });
    const b = new THREE.Mesh(bulbGeo, mat);
    b.position.set(x, y, R.z0 + 0.05);
    bulbs.push(b); g.add(b);
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: 0x2a2a30 })));
  const fairyLight = new THREE.PointLight(0xffc98a, 0, 3.2, 2);
  fairyLight.position.set(wx, WIN.y1 - 0.05, R.z0 + 0.3);
  g.add(fairyLight);

  // ---------- 床 ----------
  const bed = new THREE.Group(); g.add(bed);
  const bx0 = -2.05, bx1 = 0.0, bz0 = -1.75, bz1 = -0.72;
  const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2, bl = bx1 - bx0, bwid = bz1 - bz0;
  bed.add(rbox(bl, 0.2, bwid, 0.02, mWood, bcx, 0.2, bcz));
  for (const [x, z] of [[bx0 + 0.07, bz0 + 0.07], [bx1 - 0.07, bz0 + 0.07], [bx0 + 0.07, bz1 - 0.07], [bx1 - 0.07, bz1 - 0.07]]) bed.add(box(0.08, 0.1, 0.08, mWoodDark, x, 0.05, z));
  const mattress = rbox(bl - 0.06, 0.17, bwid - 0.05, 0.05, mSheet, bcx + 0.01, 0.375, bcz);
  mattress.name = 'bed';
  bed.add(mattress);
  bed.add(rbox(0.06, 0.82, bwid, 0.02, mWood, bx0 + 0.01, 0.5, bcz));
  const pillow = rbox(0.4, 0.13, 0.64, 0.06, mPillow, -1.74, 0.5, bcz);
  pillow.rotation.z = 0.08; bed.add(pillow);
  // 被子：平时堆在床尾；她睡觉时自己拖过来盖上（见 quilt.js）
  const quilt = buildQuilt(bed, mBlanket, { top: 0.46, z: BED_LINE, pileEdge: -0.6, pileFoot: -0.02 });
  let pillowDown = 0;
  const updateBedding = (dt) => {
    quilt.update(dt);
    // 盖好被子睡着时，枕头被头压下去
    pillowDown += ((quilt.mode === 'cover' ? 1 : 0) - pillowDown) * (1 - Math.exp(-dt * 4));
    pillow.scale.y = 1 - 0.42 * pillowDown; pillow.position.y = 0.5 - 0.027 * pillowDown;
  };

  // ---------- 书桌 ----------
  const desk = new THREE.Group(); g.add(desk);
  const dx0 = 0.55, dx1 = 2.02, dz0 = -1.76, dz1 = -1.04, dTop = 0.74;
  const deskTop = rbox(dx1 - dx0, 0.04, dz1 - dz0, 0.01, mWoodLight, (dx0 + dx1) / 2, dTop - 0.02, (dz0 + dz1) / 2);
  deskTop.name = 'desk';
  desk.add(deskTop);
  for (const [x, z] of [[dx0 + 0.05, dz0 + 0.05], [dx0 + 0.05, dz1 - 0.05]]) desk.add(box(0.05, dTop - 0.04, 0.05, mWoodLight, x, (dTop - 0.04) / 2, z));
  const drawers = rbox(0.44, 0.62, 0.62, 0.012, mWoodLight, 1.78, 0.39, -1.4);
  desk.add(drawers);
  for (const y of [0.56, 0.38, 0.2]) { desk.add(box(0.4, 0.004, 0.01, mWoodDark, 1.78, y + 0.085, -1.088, false)); desk.add(box(0.1, 0.018, 0.02, mMetal, 1.78, y, -1.082, false)); }
  desk.add(box(0.05, 0.08, 0.05, mWoodLight, 1.95, 0.04, -1.13));
  desk.add(box(0.05, 0.08, 0.05, mWoodLight, 1.6, 0.04, -1.13));

  // 台灯
  const lampG = new THREE.Group(); lampG.position.set(1.84, dTop, -1.54); desk.add(lampG);
  lampG.add(cyl(0.085, 0.095, 0.022, mDark, 0, 0.011, 0));
  lampG.add(cyl(0.011, 0.011, 0.3, mMetal, 0, 0.17, 0, 10));
  const mShade = new THREE.MeshStandardMaterial({ color: 0xf2dfc0, roughness: 0.8, emissive: 0xffa040, emissiveIntensity: 0, side: THREE.DoubleSide });
  const shade = mesh(new THREE.CylinderGeometry(0.075, 0.15, 0.17, 28, 1, true), mShade, 0, 0.39, 0, false);
  shade.name = 'lamp';
  lampG.add(shade);
  const mBulb = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffc070, emissiveIntensity: 0 });
  const bulb = mesh(new THREE.SphereGeometry(0.035, 12, 10), mBulb, 0, 0.36, 0, false);
  bulb.receiveShadow = false; lampG.add(bulb);
  const lampSpot = new THREE.SpotLight(0xffb060, 0, 5.5, 1.05, 0.85, 1.6);
  lampSpot.position.set(1.84, dTop + 0.42, -1.54);
  lampSpot.target.position.set(1.5, 0, -0.9);
  lampSpot.castShadow = true;
  lampSpot.shadow.mapSize.set(1024, 1024);
  lampSpot.shadow.bias = -0.0015;
  lampSpot.shadow.normalBias = 0.02;
  g.add(lampSpot, lampSpot.target);
  const lampPoint = new THREE.PointLight(0xffab5c, 0, 7, 1.7);
  lampPoint.position.set(1.84, dTop + 0.36, -1.54);
  g.add(lampPoint);

  // 笔记本电脑
  const screen = new LaptopScreen();
  const lap = new THREE.Group(); lap.position.set(1.12, dTop, -1.44); desk.add(lap);
  lap.add(rbox(0.36, 0.014, 0.25, 0.005, mMetal, 0, 0.007, 0));
  const keys = mesh(new THREE.PlaneGeometry(0.31, 0.13), std(0x2b2e36, 0.7), 0, 0.0146, -0.03, false);
  keys.rotation.x = -Math.PI / 2; lap.add(keys);
  const lid = new THREE.Group(); lid.position.set(0, 0.012, -0.123); lid.rotation.x = -0.3; lap.add(lid);
  lid.add(rbox(0.36, 0.24, 0.01, 0.004, mMetal, 0, 0.12, 0));
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.335, 0.215), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
  disp.position.set(0, 0.122, 0.0056); disp.name = 'laptop'; lid.add(disp);
  const lapLight = new THREE.PointLight(0x9cc0ff, 0, 1.9, 1.8);
  lapLight.position.set(1.12, dTop + 0.16, -1.3);
  g.add(lapLight);

  // 桌上的杂物
  const bookCols = [0xb5524a, 0x4f7cc0, 0xe0b85a, 0x5f9e7a, 0x8a63b0, 0xd98a4e, 0x3f5f8f, 0xcfcfd6];
  const rnd = mulberry(21);
  let sy = dTop;
  for (let i = 0; i < 3; i++) { const h = 0.028 + rnd() * 0.014; const b = box(0.2 - i * 0.012, h, 0.15, std(bookCols[i], 0.85), 0.74, sy + h / 2, -1.58); b.rotation.y = (rnd() - 0.5) * 0.35; desk.add(b); sy += h; }
  let bxp = 1.42;
  for (let i = 0; i < 6; i++) { const w = 0.022 + rnd() * 0.02, h = 0.17 + rnd() * 0.06; const b = box(w, h, 0.13, std(bookCols[(i + 3) % 8], 0.85), bxp + w / 2, dTop + h / 2, -1.66); if (i === 5) b.rotation.z = -0.22; desk.add(b); bxp += w + 0.003; }
  desk.add(cyl(0.035, 0.03, 0.08, std(0xf2f2f2, 0.5), 1.47, dTop + 0.04, -1.48));
  const pencup = cyl(0.03, 0.03, 0.075, std(0x3d5aa8, 0.6), 0.92, dTop + 0.037, -1.66); desk.add(pencup);
  for (let i = 0; i < 3; i++) { const p = cyl(0.004, 0.004, 0.13, std([0xe0b85a, 0xd9483b, 0x4f7cc0][i], 0.6), 0.92 + (i - 1) * 0.012, dTop + 0.1, -1.66, 6); p.rotation.z = (i - 1) * 0.16; desk.add(p); }

  // 墙上隔板 + 软木板
  const shelfY = 1.72;
  g.add(box(0.9, 0.025, 0.2, mWoodLight, 1.5, shelfY, R.z0 + 0.1));
  let sx = 1.1;
  for (let i = 0; i < 9; i++) { const w = 0.025 + rnd() * 0.022, h = 0.15 + rnd() * 0.07; g.add(box(w, h, 0.14, std(bookCols[(i * 3) % 8], 0.85), sx + w / 2, shelfY + 0.0125 + h / 2, R.z0 + 0.1)); sx += w + 0.003; }
  const pot2 = cyl(0.045, 0.035, 0.07, std(0xd9c9b0, 0.8), 1.82, shelfY + 0.047, R.z0 + 0.1); g.add(pot2);
  const succ = mesh(new THREE.IcosahedronGeometry(0.05, 0), std(0x6fae7a, 0.8), 1.82, shelfY + 0.11, R.z0 + 0.1); g.add(succ);
  const cork = mesh(new THREE.PlaneGeometry(0.62, 0.46), std(0xffffff, 0.9, { map: corkTexture() }), 0.62, 1.52, R.z0 + 0.012, false); g.add(cork);

  // ---------- 椅子 ----------
  const chair = new THREE.Group(); chair.position.set(1.1, 0, -0.6); g.add(chair);
  const seat = rbox(0.42, 0.07, 0.42, 0.03, mFabric, 0, 0.435, 0); seat.name = 'chair'; chair.add(seat);
  chair.add(cyl(0.028, 0.028, 0.34, mMetal, 0, 0.23, 0, 12));
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; const leg = box(0.26, 0.025, 0.04, mDark, Math.cos(a) * 0.13, 0.055, Math.sin(a) * 0.13); leg.rotation.y = -a; chair.add(leg); chair.add(mesh(new THREE.SphereGeometry(0.024, 8, 6), mDark, Math.cos(a) * 0.25, 0.024, Math.sin(a) * 0.25)); }
  const back = rbox(0.05, 0.4, 0.38, 0.02, mFabric, 0.235, 0.72, 0); back.rotation.z = -0.1; chair.add(back);
  chair.add(box(0.03, 0.2, 0.05, mDark, 0.225, 0.5, 0));

  // ---------- 垃圾桶 ----------
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.24, 20, 1, true), std(0x6d7686, 0.7, { side: THREE.DoubleSide }), 0.3, 0.12, -1.52));
  g.add(cyl(0.085, 0.085, 0.01, std(0x555c68, 0.7), 0.3, 0.006, -1.52));
  const paperBall = mesh(new THREE.IcosahedronGeometry(0.035, 0), std(0xf0f0ea, 0.95), 0.31, 0.08, -1.52); g.add(paperBall);

  // ---------- 矮书架 ----------
  const shelf = new THREE.Group(); g.add(shelf);
  const sx0 = 1.78, sz0 = 0.3, sz1 = 1.4, sh = 0.95, sd = R.x1 - sx0 - 0.01;
  const scx = sx0 + sd / 2, scz = (sz0 + sz1) / 2;
  shelf.add(box(sd, 0.03, sz1 - sz0, mWood, scx, sh, scz));
  shelf.add(box(sd, 0.03, sz1 - sz0, mWood, scx, 0.03, scz));
  shelf.add(box(sd, sh, 0.03, mWood, scx, sh / 2, sz0));
  shelf.add(box(sd, sh, 0.03, mWood, scx, sh / 2, sz1));
  shelf.add(box(0.015, sh, sz1 - sz0, mWoodDark, R.x1 - 0.015, sh / 2, scz, false));
  for (const y of [0.33, 0.64]) shelf.add(box(sd, 0.025, sz1 - sz0, mWood, scx, y, scz));
  const shelfBooks = new THREE.Group(); shelf.add(shelfBooks);
  for (const [tier, y] of [[0, 0.045], [1, 0.3425], [2, 0.6525]]) {
    let z = sz0 + 0.03;
    while (z < sz1 - 0.08) {
      const w = 0.022 + rnd() * 0.03, h = 0.18 + rnd() * 0.08;
      if (rnd() < 0.12) { z += 0.06; continue; }
      const b = box(0.2, h, w, std(bookCols[Math.floor(rnd() * 8)], 0.85), sx0 + 0.13, y + h / 2, z + w / 2);
      if (rnd() < 0.1) b.rotation.x = 0.2;
      b.userData.tier = tier;
      shelfBooks.add(b); z += w + 0.004;
    }
  }
  shelf.add(mesh(new THREE.SphereGeometry(0.07, 16, 12), std(0x7fb8e8, 0.4), scx, sh + 0.085, sz0 + 0.2));
  shelf.name = 'bookshelf';
  // 给点击检测用的隐形整块
  const shelfHit = box(sd, sh, sz1 - sz0, mBlocker, scx, sh / 2, scz, false); shelfHit.name = 'bookshelf'; shelfHit.castShadow = false; g.add(shelfHit);

  // ---------- 地毯、懒人垫 ----------
  const rug = mesh(new THREE.CircleGeometry(RUG.r, 48), std(0xffffff, 1, { map: rugTexture(), transparent: true }), RUG.x, 0.006, RUG.z, false);
  rug.rotation.x = -Math.PI / 2; rug.name = 'rug'; g.add(rug);
  const cushion = mesh(new THREE.SphereGeometry(1, 28, 18), std(0xf0a9b8, 0.98), CUSHION.x, 0.085, CUSHION.z);
  cushion.scale.set(CUSHION.r, 0.11, CUSHION.r); cushion.name = 'cushion'; g.add(cushion);
  const cushBtn = mesh(new THREE.SphereGeometry(0.03, 10, 8), std(0xd97f94, 0.9), CUSHION.x, 0.185, CUSHION.z, false); g.add(cushBtn);

  // ---------- 盆栽 + 小水壶 ----------
  const plant = new THREE.Group(); plant.position.set(PLANT.x, 0, PLANT.z); plant.name = 'plant'; g.add(plant);
  const potM = cyl(0.17, 0.12, 0.26, std(0xd08a5e, 0.85), 0, 0.13, 0); potM.name = 'plant'; plant.add(potM);
  plant.add(cyl(0.155, 0.155, 0.02, std(0x3a2a20, 1), 0, 0.253, 0)); // 比花盆口高出一点，免得两个面叠在一起闪
  const leafGeo = leafGeometry();
  const mLeaf = std(0x62b577, 0.8, { side: THREE.DoubleSide });
  const leaves = [];
  for (let i = 0; i < 11; i++) {
    const stem = new THREE.Group();
    const a = (i / 11) * TAU + rnd() * 0.5;
    const tilt = 0.25 + rnd() * 0.75;
    const len = 0.22 + rnd() * 0.22;
    stem.position.set(0, 0.25, 0); stem.rotation.set(0, a, 0);
    const inner = new THREE.Group(); inner.rotation.x = tilt; stem.add(inner);
    inner.add(cyl(0.006, 0.008, len, std(0x3f7a4c, 0.8), 0, len / 2, 0, 6));
    const leaf = new THREE.Mesh(leafGeo, mLeaf); leaf.position.y = len; leaf.scale.setScalar(0.55 + rnd() * 0.5); leaf.castShadow = true; leaf.name = 'plant';
    inner.add(leaf);
    leaves.push({ inner, tilt, seed: rnd() * 10 });
    plant.add(stem);
  }
  const can = new THREE.Group(); can.position.set(-1.38, 0, 1.52); can.rotation.y = 0.6; g.add(can);
  buildWateringCan(can);

  // ---------- 墙上的画和钟 ----------
  const poster = mesh(new THREE.PlaneGeometry(0.6, 0.8), std(0xffffff, 0.9, { map: posterTexture() }), R.x0 + 0.012, 1.5, 0.35, false);
  poster.rotation.y = Math.PI / 2; g.add(poster);
  const clock = new THREE.Group(); clock.position.set(R.x0 + 0.02, 1.95, 1.05); clock.rotation.y = Math.PI / 2; g.add(clock);
  const face = cyl(0.17, 0.17, 0.03, std(0xf7f5ef, 0.6), 0, 0, 0, 40); face.rotation.x = Math.PI / 2; clock.add(face);
  const rim = mesh(new THREE.TorusGeometry(0.17, 0.014, 10, 40), std(0x3d5aa8, 0.5), 0, 0, 0.012, false); clock.add(rim);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; const tk = box(0.008, i % 3 === 0 ? 0.035 : 0.018, 0.004, mDark, Math.sin(a) * 0.135, Math.cos(a) * 0.135, 0.017, false); tk.rotation.z = -a; clock.add(tk); }
  const hand = (len, w, mat) => { const p = new THREE.Group(); p.position.z = 0.02; const b = box(w, len, 0.004, mat, 0, len / 2 - 0.012, 0, false); p.add(b); clock.add(p); return p; };
  const hourHand = hand(0.085, 0.012, mDark), minHand = hand(0.125, 0.008, mDark), secHand = hand(0.13, 0.003, std(0xd9483b, 0.5));
  clock.add(cyl(0.01, 0.01, 0.012, mDark, 0, 0, 0.022, 10).rotateX(Math.PI / 2));

  // 右墙上的小相框
  const frame = mesh(new THREE.PlaneGeometry(0.42, 0.32), std(0xffffff, 0.9, { map: canvasTex(256, 192, (c, w, h) => {
    c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, w, h);
    const gr = c.createLinearGradient(0, 16, 0, h - 16); gr.addColorStop(0, '#ffd9a8'); gr.addColorStop(1, '#f08a6a');
    c.fillStyle = gr; c.fillRect(16, 16, w - 32, h - 32);
    c.fillStyle = '#fff6da'; c.beginPath(); c.arc(w * 0.5, h * 0.62, 30, 0, TAU); c.fill();
    c.fillStyle = '#5b3a6a'; c.beginPath(); c.moveTo(16, h - 16); c.lineTo(16, h * 0.66); c.quadraticCurveTo(w * 0.3, h * 0.5, w * 0.5, h * 0.7); c.quadraticCurveTo(w * 0.75, h * 0.56, w - 16, h * 0.68); c.lineTo(w - 16, h - 16); c.fill();
  }) }), R.x1 - 0.012, 1.55, -0.6, false);
  frame.rotation.y = -Math.PI / 2; g.add(frame);

  // 地上的小杂物（靠墙放，不挡她的路）
  const fb = box(0.2, 0.025, 0.15, std(0x4f7cc0, 0.85), -1.82, 0.0125, 0.05); fb.rotation.y = 0.4; g.add(fb);
  const fb2 = box(0.19, 0.02, 0.14, std(0xe0b85a, 0.85), -1.8, 0.035, 0.06); fb2.rotation.y = 0.9; g.add(fb2);

  // ---------- 小球（能被她踢着玩） ----------
  const ball = mesh(new THREE.SphereGeometry(0.07, 20, 14), std(0xffffff, 0.6, { map: canvasTex(128, 64, (c, w, h) => {
    const cols = ['#ff6b81', '#ffd166', '#4dabf7', '#fff'];
    for (let i = 0; i < 8; i++) { c.fillStyle = cols[i % 4]; c.fillRect((i / 8) * w, 0, w / 8 + 1, h); }
  }) }), 0.55, 0.07, 0.95);
  ball.name = 'ball';
  g.add(ball);

  // ---------- 接口 ----------
  const lamp = {
    on: false, level: 0,
    set(on) { this.on = on; },
    update(dt) {
      const target = this.on ? 1 : 0;
      this.level += (target - this.level) * Math.min(1, dt * 9);
      const k = this.level * (1 + Math.sin(performance.now() / 90) * 0.004);
      lampSpot.intensity = 9 * k;
      lampPoint.intensity = 2.6 * k;
      mShade.emissiveIntensity = 0.9 * k;
      mBulb.emissiveIntensity = 2.2 * k;
    },
  };
  const laptop = {
    on: false, level: 0, screen,
    set(on) { this.on = on; screen.set(on); },
    update(dt) {
      screen.update(dt);
      this.level += ((this.on ? 1 : 0) - this.level) * Math.min(1, dt * 8);
      lapLight.intensity = 1.1 * this.level * (0.9 + Math.sin(performance.now() / 300) * 0.1);
    },
  };
  const fairy = {
    update(t, dark) {
      const base = dark * 2.6;
      bulbs.forEach((b, i) => { b.material.emissiveIntensity = base * (0.75 + 0.25 * Math.sin(t * 1.3 + i * 1.7)); });
      fairyLight.intensity = dark * 1.1;
    },
  };
  const clockApi = {
    update(date) {
      const s = date.getSeconds(), m = date.getMinutes() + s / 60, h = (date.getHours() % 12) + m / 60;
      hourHand.rotation.z = -(h / 12) * TAU; minHand.rotation.z = -(m / 60) * TAU; secHand.rotation.z = -(s / 60) * TAU;
    },
  };
  const plantApi = {
    happy: 0,
    update(t, dt) {
      this.happy = Math.max(0, this.happy - dt * 0.25);
      for (const l of leaves) l.inner.rotation.x = l.tilt + Math.sin(t * 0.9 + l.seed) * 0.03 + Math.sin(t * 9 + l.seed) * 0.05 * this.happy;
    },
  };

  return {
    group: g, floor, windowPane, lamp, laptop, fairy, clock: clockApi, plant: plantApi, quilt, ball, wateringCan: can, shelfBooks,
    update(t, dt) { lamp.update(dt); laptop.update(dt); plantApi.update(t, dt); updateBedding(dt); },
  };
}

/** 小水壶（盆栽旁放一个，她手里拿的是同款）。 */
export function buildWateringCan(parent) {
  const m = new THREE.MeshStandardMaterial({ color: 0x6fc3df, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 16), m); body.position.y = 0.045; body.castShadow = true;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.11, 8), m); spout.position.set(0.075, 0.07, 0); spout.rotation.z = -0.95; spout.castShadow = true;
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.01, 0.015, 10), m); rose.position.set(0.12, 0.102, 0); rose.rotation.z = -0.95;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 8, 16, Math.PI), m); handle.position.set(-0.05, 0.05, 0); handle.rotation.z = Math.PI / 2;
  parent.add(body, spout, rose, handle);
  return parent;
}

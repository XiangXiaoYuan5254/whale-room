// 环境：跟着真实时钟走的昼夜、天气（模拟或真实）、窗外的城市，以及从窗户照进来的日光/月光。
import * as THREE from 'three';
import { clamp, lerp, damp, mixHex, mulberry, TAU, hex, pick } from './util.js';
import { WIN, ROOM } from './room.js';

// 一天里的关键时刻：小时 → 天空/灯光参数，中间线性过渡。
const KEYS = [
  { h: 0, top: 0x060a20, bot: 0x1a2a5c, hemiSky: 0x5a7ae0, hemiGnd: 0x222648, hemi: 1.35, sun: 0x86a6ff, sunI: 1.25, sx: -1.4, sy: 5.2, dark: 1, bg: 0x05070f },
  { h: 4.6, top: 0x060a20, bot: 0x1a2a5c, hemiSky: 0x5a7ae0, hemiGnd: 0x222648, hemi: 1.35, sun: 0x86a6ff, sunI: 1.25, sx: -1.4, sy: 5.2, dark: 1, bg: 0x05070f },
  { h: 6, top: 0x39488c, bot: 0xf4a67c, hemiSky: 0x9ea8dc, hemiGnd: 0x2c2832, hemi: 0.95, sun: 0xffb48a, sunI: 1.5, sx: -3.4, sy: 2.4, dark: 0.55, bg: 0x1b1d36 },
  { h: 7.6, top: 0x6db0ee, bot: 0xd2e8f8, hemiSky: 0xdfe9ff, hemiGnd: 0x5a4c40, hemi: 1.55, sun: 0xfff0d4, sunI: 2.8, sx: -3.0, sy: 4.2, dark: 0, bg: 0x8ea0bc },
  { h: 12, top: 0x4c9ce8, bot: 0xc2e2fb, hemiSky: 0xeaf1ff, hemiGnd: 0x62544a, hemi: 1.8, sun: 0xffffff, sunI: 3.2, sx: -0.6, sy: 7.5, dark: 0, bg: 0x98abc8 },
  { h: 16.4, top: 0x5a9fe0, bot: 0xf2dfc2, hemiSky: 0xe9e6f4, hemiGnd: 0x5e5044, hemi: 1.55, sun: 0xffe0aa, sunI: 2.9, sx: 2.2, sy: 4.4, dark: 0.04, bg: 0x94a2ba },
  { h: 18, top: 0x3c3e8a, bot: 0xff9264, hemiSky: 0xb9a4d4, hemiGnd: 0x3c2e32, hemi: 1.05, sun: 0xff8a52, sunI: 2.1, sx: 3.2, sy: 2.2, dark: 0.45, bg: 0x2a2440 },
  { h: 19.4, top: 0x131b4a, bot: 0x4b417c, hemiSky: 0x7286d8, hemiGnd: 0x262844, hemi: 1.2, sun: 0x8090e0, sunI: 1.0, sx: 1.0, sy: 4.0, dark: 0.86, bg: 0x0a0c1c },
  { h: 20.6, top: 0x060a20, bot: 0x1a2a5c, hemiSky: 0x5a7ae0, hemiGnd: 0x222648, hemi: 1.35, sun: 0x86a6ff, sunI: 1.25, sx: -1.4, sy: 5.2, dark: 1, bg: 0x05070f },
  { h: 24, top: 0x060a20, bot: 0x1a2a5c, hemiSky: 0x5a7ae0, hemiGnd: 0x222648, hemi: 1.35, sun: 0x86a6ff, sunI: 1.25, sx: -1.4, sy: 5.2, dark: 1, bg: 0x05070f },
];
const COLOR_KEYS = ['top', 'bot', 'hemiSky', 'hemiGnd', 'sun', 'bg'];
const NUM_KEYS = ['hemi', 'sunI', 'sx', 'sy', 'dark'];

function sampleKeys(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
  const out = {};
  for (const k of COLOR_KEYS) out[k] = mixHex(a[k], b[k], t);
  for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
}

const TIME_PRESET = { dawn: 6.1, day: 11.5, dusk: 18.1, night: 22.5 };
export const WEATHER_LABEL = { clear: '晴', cloudy: '多云', rain: '下雨', snow: '下雪' };

const WINDOW_VERT = /* glsl */`
varying vec3 vWorld; varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WINDOW_FRAG = /* glsl */`
uniform sampler2D uBack; uniform sampler2D uDrops;
uniform vec2 uCenter; uniform vec2 uSize; uniform float uDepth;
uniform float uTime; uniform float uRain; uniform float uSnow; uniform float uDark; uniform float uGlow;
varying vec3 vWorld; varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rainLayer(vec2 p, float scale, float speed) {
  p.x += p.y * 0.14;
  p *= vec2(scale, scale * 0.085);
  p.y += uTime * speed;
  vec2 id = floor(p); vec2 f = fract(p);
  float h = hash(id);
  float x = abs(f.x - (0.2 + 0.6 * h));
  float s = smoothstep(0.05, 0.0, x) * smoothstep(0.0, 0.25, f.y) * smoothstep(1.0, 0.45, f.y);
  return s * step(0.5, hash(id + 7.3));
}
float snowLayer(vec2 p, float scale, float speed) {
  p *= scale;
  p.y += uTime * speed;
  p.x += sin(p.y * 0.8 + uTime * 0.4) * 0.35;
  vec2 id = floor(p); vec2 f = fract(p) - 0.5;
  vec2 o = vec2(hash(id), hash(id + 3.1)) - 0.5;
  float d = length(f - o * 0.6);
  return smoothstep(0.11, 0.03, d) * step(0.45, hash(id + 9.7));
}
void main() {
  vec3 V = normalize(vWorld - cameraPosition);
  float vz = max(0.1, -V.z);
  vec2 slope = V.xy / vz;
  // 玻璃上的水珠把后面的景色折一下
  vec4 d1 = texture2D(uDrops, vUv * vec2(1.4, 0.95));
  vec4 d2 = texture2D(uDrops, vUv * vec2(1.1, 0.75) + vec2(0.37, uTime * 0.012));
  float wet = uRain * clamp(d1.a + d2.a * 0.8, 0.0, 1.0);
  vec2 refr = ((d1.rg - 0.5) * d1.a + (d2.rg - 0.5) * d2.a * 0.8) * uRain;
  vec2 hit = vWorld.xy + slope * uDepth;
  vec2 uv = (hit - uCenter) / uSize + 0.5 + refr * 0.07;
  vec3 col = texture2D(uBack, clamp(uv, 0.003, 0.997)).rgb;
  col *= 1.0 + uGlow;
  vec2 pn = vWorld.xy + slope * 1.2;
  vec2 pf = vWorld.xy + slope * 3.5;
  float rain = rainLayer(pn, 7.0, 3.4) * 0.55 + rainLayer(pf + 3.7, 13.0, 2.6) * 0.35 + rainLayer(pf * 1.3 + 9.1, 22.0, 2.0) * 0.2;
  col += vec3(0.62, 0.72, 0.95) * rain * uRain * mix(0.55, 0.28, uDark);
  float snow = snowLayer(pn, 3.2, 0.35) + snowLayer(pf + 5.0, 5.5, 0.26) * 0.8 + snowLayer(pf * 1.4 + 2.0, 9.0, 0.2) * 0.6;
  col += vec3(0.95, 0.97, 1.0) * snow * uSnow * mix(0.9, 0.55, uDark);
  col += vec3(0.75, 0.85, 1.0) * wet * mix(0.07, 0.025, uDark);
  float fres = pow(1.0 - clamp(vz, 0.0, 1.0), 3.0);
  col = mix(col, vec3(0.7, 0.8, 1.0) * mix(0.55, 0.12, uDark), fres * 0.4);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function dropsTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 128; d[i + 3] = 0; }
  const rnd = mulberry(99);
  const put = (cx, cy, r, sy = 1) => {
    for (let y = Math.floor(cy - r * sy); y <= cy + r * sy; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = (x - cx) / r, dy = (y - cy) / (r * sy);
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const xi = ((x % S) + S) % S, yi = ((y % S) + S) % S, k = (yi * S + xi) * 4;
      const a = Math.min(1, (1 - q) * 3);
      if (a * 255 < d[k + 3]) continue;
      d[k] = 128 - dx * 118; d[k + 1] = 128 + dy * 118; d[k + 3] = a * 255;
    }
  };
  for (let i = 0; i < 170; i++) put(rnd() * S, rnd() * S, 1.5 + rnd() * rnd() * 6);
  for (let i = 0; i < 26; i++) { // 往下淌的水痕
    let x = rnd() * S, y = rnd() * S; const len = 40 + rnd() * 120;
    for (let s = 0; s < len; s += 2) { x += (rnd() - 0.5) * 1.2; put(x, y + s, 1.6 + rnd() * 0.8, 1.6); }
    put(x, y + len, 5 + rnd() * 3, 1.25);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Environment {
  constructor(scene, room) {
    this.scene = scene; this.room = room;
    this.timeMode = 'auto';
    this.weatherMode = 'auto';
    this.weather = pick(['rain', 'rain', 'clear', 'clear', 'cloudy']);
    this.realWeather = null;
    this.nextWeatherAt = 15 * 60 + Math.random() * 20 * 60;
    this.elapsed = 0;
    this.hour = this.#targetHour();
    this.rain = this.weather === 'rain' ? 1 : 0; this.snow = 0; this.cloud = this.weather === 'clear' ? 0 : 0.8;
    this.state = { hour: this.hour, dark: 1, weather: this.weather, phase: 'night' };
    this.drawn = { hour: -99, cloud: -1, at: 0 };

    scene.background = new THREE.Color(0x05070f);
    this.hemi = new THREE.HemisphereLight(0x4f6cd0, 0x15162c, 0.6);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0x86a6ff, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -3.6; sc.right = 3.6; sc.top = 3.6; sc.bottom = -3.6; sc.near = 0.5; sc.far = 18;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3; this.sun.shadow.blurSamples = 12; // 影子边缘柔一点
    scene.add(this.sun, this.sun.target);

    // 窗外的景色画在一张画布上，再用视差着色器「贴」到窗玻璃后面 10 米远的地方
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 512;
    this.g = this.canvas.getContext('2d');
    this.backTex = new THREE.CanvasTexture(this.canvas);
    this.backTex.colorSpace = THREE.SRGBColorSpace;
    const cx = (WIN.x0 + WIN.x1) / 2;
    this.windowMat = new THREE.ShaderMaterial({
      vertexShader: WINDOW_VERT, fragmentShader: WINDOW_FRAG,
      uniforms: {
        uBack: { value: this.backTex }, uDrops: { value: dropsTexture() },
        uCenter: { value: new THREE.Vector2(cx, 2.0) }, uSize: { value: new THREE.Vector2(40, 20) }, uDepth: { value: 10 },
        uTime: { value: 0 }, uRain: { value: 0 }, uSnow: { value: 0 }, uDark: { value: 1 }, uGlow: { value: 0 },
      },
    });
    room.windowPane.material = this.windowMat;

    const rnd = mulberry(5);
    this.buildings = [];
    for (let layer = 0; layer < 3; layer++) {
      let x = -20;
      while (x < 1044) {
        const w = 26 + rnd() * (50 - layer * 8);
        const h = (layer === 0 ? 40 : layer === 1 ? 70 : 110) * (0.45 + rnd() * rnd() * 1.6);
        const wins = [];
        const cols = Math.max(2, Math.floor(w / 7)), rows = Math.max(2, Math.floor(h / 8));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (rnd() < 0.34) wins.push([c / cols, r / rows, Math.floor(rnd() * 4), 0.5 + rnd() * 0.5]);
        this.buildings.push({ layer, x, w, h, cols, rows, wins, tone: rnd() });
        x += w + rnd() * 10 - (layer === 2 ? 0 : 3);
      }
    }
    this.lights = [];
    for (let i = 0; i < 300; i++) this.lights.push([rnd(), rnd() * rnd(), 1.5 + rnd() * 4, Math.floor(rnd() * 5), 0.35 + rnd() * 0.65]);
    this.stars = [];
    for (let i = 0; i < 170; i++) this.stars.push([rnd(), rnd(), rnd()]);
    this.clouds = [];
    for (let i = 0; i < 14; i++) this.clouds.push([rnd(), rnd(), 0.6 + rnd() * 1.2, rnd()]);
    this.#apply(0);
    this.#fetchWeather();
  }

  #targetHour() {
    if (this.timeMode !== 'auto') return TIME_PRESET[this.timeMode];
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  setTimeMode(mode) { this.timeMode = mode; }
  setWeatherMode(mode) { this.weatherMode = mode; if (mode !== 'auto') this.weather = mode; else if (this.realWeather) this.weather = this.realWeather; }

  async #fetchWeather() {
    try {
      const r = await fetch('/api/weather');
      const j = await r.json();
      if (j.mode === 'real' && j.kind) {
        this.realWeather = j.kind; this.temperature = j.temperature;
        if (this.weatherMode === 'auto') this.weather = j.kind;
      }
    } catch (err) {
      console.warn('天气获取失败，使用模拟天气', err);
    }
    setTimeout(() => this.#fetchWeather(), 10 * 60 * 1000);
  }

  #draw(k) {
    const g = this.g, W = 1024, H = 512;
    const horizon = H * 0.56;
    const dark = k.dark, cloud = this.cloud;
    const grayTop = mixHex(0x7c8796, 0x0a0e1e, dark), grayBot = mixHex(0xaab4c0, 0x1c2238, dark);
    const top = mixHex(k.top, grayTop, cloud * 0.8), bot = mixHex(k.bot, grayBot, cloud * 0.8);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, hex(top)); sky.addColorStop(1, hex(bot));
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon + 2);
    // 星星和月亮 / 太阳
    const clearNight = clamp((dark - 0.35) / 0.5, 0, 1) * (1 - cloud);
    if (clearNight > 0.01) {
      g.fillStyle = '#fff';
      for (const [x, y, s] of this.stars) { g.globalAlpha = clearNight * (0.25 + s * 0.75); const r = 0.6 + s * 1.1; g.fillRect(x * W, y * horizon * 0.92, r, r); }
      g.globalAlpha = clearNight;
      const mx = W * 0.6, my = H * 0.16;
      const halo = g.createRadialGradient(mx, my, 6, mx, my, 70);
      halo.addColorStop(0, 'rgba(210,225,255,0.55)'); halo.addColorStop(1, 'rgba(210,225,255,0)');
      g.fillStyle = halo; g.fillRect(mx - 70, my - 70, 140, 140);
      g.fillStyle = '#f4f6ff'; g.beginPath(); g.arc(mx, my, 15, 0, TAU); g.fill();
      g.fillStyle = hex(top); g.globalAlpha = clearNight * 0.9; g.beginPath(); g.arc(mx + 7, my - 4, 13, 0, TAU); g.fill();
    }
    const dayness = 1 - clamp(dark / 0.7, 0, 1);
    if (dayness > 0.01 && cloud < 0.85) {
      const sxp = W * (0.5 + clamp(k.sx / 8, -0.4, 0.4)), syp = horizon - (k.sy / 8) * horizon * 0.95;
      g.globalAlpha = (1 - cloud) * Math.min(1, dayness + 0.4);
      const halo = g.createRadialGradient(sxp, syp, 8, sxp, syp, 110);
      halo.addColorStop(0, 'rgba(255,250,225,0.95)'); halo.addColorStop(0.25, 'rgba(255,240,200,0.5)'); halo.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = halo; g.fillRect(sxp - 110, syp - 110, 220, 220);
    }
    // 云
    g.globalAlpha = 1;
    const cloudCol = mixHex(mixHex(0xffffff, k.bot, 0.25), 0x1b2238, dark * 0.9);
    const nClouds = Math.round(3 + cloud * 11);
    for (let i = 0; i < nClouds; i++) {
      const [x, y, s, seed] = this.clouds[i];
      const cxp = ((x * W + this.elapsed * 0.6 * (0.5 + seed)) % (W + 300)) - 150, cyp = 30 + y * horizon * 0.7;
      g.globalAlpha = (0.25 + cloud * 0.5) * (0.6 + seed * 0.4);
      g.fillStyle = hex(cloudCol);
      for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(cxp + (j - 2) * 34 * s, cyp + Math.sin(j * 2.1 + seed * 9) * 8, 48 * s, 20 * s, 0, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
    // 地平线以下：城市
    const base = mixHex(mixHex(0x8ea2bc, k.bot, 0.35), 0x070b1c, dark);
    const hz = g.createLinearGradient(0, horizon - 4, 0, H);
    hz.addColorStop(0, hex(mixHex(bot, base, 0.35))); hz.addColorStop(0.35, hex(base)); hz.addColorStop(1, hex(mixHex(base, 0x000000, 0.35)));
    g.fillStyle = hz; g.fillRect(0, horizon - 2, W, H - horizon + 2);
    const winCols = ['#ffd98a', '#fff3cf', '#a8d4ff', '#ff9d6a'];
    for (const b of this.buildings) {
      const depth = b.layer / 2;
      const baseY = horizon + 6 + b.layer * 34;
      const col = mixHex(mixHex(bot, base, 0.45 + depth * 0.4), 0x05060f, dark * (0.35 + depth * 0.3));
      g.fillStyle = hex(mixHex(col, 0x000000, b.tone * 0.12));
      g.fillRect(b.x, baseY - b.h, b.w, b.h + 80);
      if (dark > 0.25) {
        const a = clamp((dark - 0.25) / 0.5, 0, 1);
        for (const [cxn, ryn, ci, br] of b.wins) {
          g.globalAlpha = a * br * (0.55 + depth * 0.45);
          g.fillStyle = winCols[ci];
          g.fillRect(b.x + 2 + cxn * (b.w - 4), baseY - b.h + 3 + ryn * (b.h - 4), Math.max(2, (b.w - 6) / b.cols - 2), 3.4);
        }
        g.globalAlpha = 1;
      } else {
        g.globalAlpha = 0.16; g.fillStyle = '#dff1ff';
        for (const [cxn, ryn] of b.wins) g.fillRect(b.x + 2 + cxn * (b.w - 4), baseY - b.h + 3 + ryn * (b.h - 4), Math.max(2, (b.w - 6) / b.cols - 2), 3.4);
        g.globalAlpha = 1;
      }
    }
    // 街道上的灯：下雨时晕成一片光斑
    if (dark > 0.2) {
      const a = clamp((dark - 0.2) / 0.5, 0, 1);
      g.globalCompositeOperation = 'lighter';
      const cols = ['255,214,140', '255,170,110', '150,205,255', '255,240,210', '255,120,140'];
      const blur = 1 + this.rain * 1.9 + this.snow * 0.8;
      for (const [x, y, r, ci, br] of this.lights) {
        const px = x * W, py = horizon + 14 + y * (H - horizon - 10), rr = r * blur * (0.6 + y * 1.6);
        const gr = g.createRadialGradient(px, py, 0, px, py, rr);
        gr.addColorStop(0, `rgba(${cols[ci]},${0.85 * a * br})`); gr.addColorStop(0.6, `rgba(${cols[ci]},${0.3 * a * br})`); gr.addColorStop(1, `rgba(${cols[ci]},0)`);
        g.fillStyle = gr; g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
      }
      g.globalCompositeOperation = 'source-over';
    }
    // 雨雾
    if (this.rain > 0.02 || this.snow > 0.02) {
      g.globalAlpha = 0.22 * Math.max(this.rain, this.snow * 0.8);
      g.fillStyle = hex(mixHex(0xb8c4d4, 0x1a2444, dark)); g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    this.backTex.needsUpdate = true;
  }

  #apply(dt) {
    const k = sampleKeys(this.hour);
    const overcast = clamp(this.cloud, 0, 1);
    this.hemi.color.setHex(mixHex(k.hemiSky, mixHex(0x9aa4b4, 0x4a5a98, k.dark), overcast * 0.6));
    this.hemi.groundColor.setHex(k.hemiGnd);
    this.hemi.intensity = k.hemi * (1 - overcast * 0.22);
    this.sun.color.setHex(mixHex(k.sun, mixHex(0xc8d0dc, 0x7f95d8, k.dark), overcast * 0.7));
    this.sun.intensity = k.sunI * (1 - overcast * lerp(0.72, 0.45, k.dark));
    const cx = (WIN.x0 + WIN.x1) / 2;
    this.sun.position.set(cx + k.sx, k.sy, ROOM.z0 - 6.5);
    this.sun.target.position.set(cx - k.sx * 0.28, 0.25, 0.1);
    this.scene.background.setHex(mixHex(k.bg, mixHex(0x7e8898, 0x05070f, k.dark), overcast * 0.5));
    const u = this.windowMat.uniforms;
    u.uRain.value = this.rain; u.uSnow.value = this.snow; u.uDark.value = k.dark; u.uGlow.value = k.dark * 0.55;
    u.uTime.value = this.elapsed;
    const phase = k.dark > 0.8 ? 'night' : k.dark > 0.3 ? (this.hour < 12 ? 'dawn' : 'dusk') : 'day';
    this.state = { hour: this.hour, dark: k.dark, weather: this.weather, phase, temperature: this.temperature ?? null, real: Boolean(this.realWeather) && this.weatherMode === 'auto' };
    const need = Math.abs(this.hour - this.drawn.hour) > 0.04 || Math.abs(this.cloud - this.drawn.cloud) > 0.03 || Math.abs(this.rain - (this.drawn.rain ?? 0)) > 0.05 || Math.abs(this.snow - (this.drawn.snow ?? 0)) > 0.05 || (overcast > 0.2 && this.elapsed - this.drawn.at > 4);
    if (need && (this.elapsed - this.drawn.at > 0.12 || dt === 0)) {
      this.#draw(k);
      this.drawn = { hour: this.hour, cloud: this.cloud, rain: this.rain, snow: this.snow, at: this.elapsed };
    }
  }

  update(dt) {
    this.elapsed += dt;
    // 时间：自动模式跟真实时钟；手动切换时让天色平滑扫过去
    const target = this.#targetHour();
    let diff = target - this.hour;
    if (diff > 12) diff -= 24; if (diff < -12) diff += 24;
    this.hour = Math.abs(diff) < 0.02 ? target : (this.hour + diff * (1 - Math.exp(-dt * 2.2)) + 24) % 24;
    // 天气：没有真实天气就自己慢慢变
    if (this.weatherMode === 'auto' && !this.realWeather && this.elapsed > this.nextWeatherAt) {
      const winter = [11, 0, 1].includes(new Date().getMonth());
      this.weather = pick(winter ? ['clear', 'cloudy', 'rain', 'snow', 'snow'] : ['clear', 'clear', 'cloudy', 'rain', 'rain']);
      this.nextWeatherAt = this.elapsed + 15 * 60 + Math.random() * 25 * 60;
    }
    const w = this.weather;
    this.rain = damp(this.rain, w === 'rain' ? 1 : 0, 0.6, dt);
    this.snow = damp(this.snow, w === 'snow' ? 1 : 0, 0.6, dt);
    this.cloud = damp(this.cloud, w === 'clear' ? 0.08 : w === 'cloudy' ? 0.7 : 0.92, 0.5, dt);
    this.#apply(dt);
  }
}

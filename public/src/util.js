// 小工具：数学、缓动、随机、可取消的等待。
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** 与帧率无关的指数趋近。rate 越大跟得越紧。 */
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

/** 把角度差规整到 [-π, π]。 */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const dampAngle = (cur, target, rate, dt) => cur + angleDiff(cur, target) * (1 - Math.exp(-rate * dt));

/** 平滑的一维噪声（几条不同频率正弦叠加），输出约 [-1, 1]，用来让动作不重复。 */
export function wobble(t, seed = 0) {
  return (
    Math.sin(t * 1.0 + seed * 12.9898) * 0.5 +
    Math.sin(t * 2.31 + seed * 78.233) * 0.3 +
    Math.sin(t * 0.47 + seed * 37.719) * 0.2
  );
}

/** 可重复的伪随机（给程序化贴图用）。 */
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 被打断时抛出的错误；行为脚本靠它提前收尾。 */
export class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled'; }
}

/** 取消令牌：一个行为脚本一枚，被新指令/来信打断时置位。 */
export class Token {
  constructor() { this.cancelled = false; }
  cancel() { this.cancelled = true; }
  check() { if (this.cancelled) throw new Cancelled(); }
}

/** 由渲染循环驱动的时钟：sleep() 的 Promise 在 tick 里兑现，页面切到后台时自然暂停。 */
export class Clock {
  constructor() { this.now = 0; this.waiters = new Set(); }
  tick(dt) {
    this.now += dt;
    for (const w of this.waiters) {
      if (w.token?.cancelled) { this.waiters.delete(w); w.reject(new Cancelled()); continue; }
      if (w.until !== undefined && this.now >= w.until) { this.waiters.delete(w); w.resolve(); continue; }
      if (w.cond && w.cond()) { this.waiters.delete(w); w.resolve(); }
    }
  }
  sleep(sec, token) {
    return new Promise((resolve, reject) => {
      if (token?.cancelled) { reject(new Cancelled()); return; }
      this.waiters.add({ until: this.now + sec, token, resolve, reject });
    });
  }
  /** 等到条件成立（每帧检查），可带超时；超时返回 false。 */
  until(cond, token, timeout = Infinity) {
    const deadline = this.now + timeout;
    return new Promise((resolve, reject) => {
      if (token?.cancelled) { reject(new Cancelled()); return; }
      let ok = false;
      this.waiters.add({
        token,
        cond: () => { if (cond()) { ok = true; return true; } return this.now >= deadline; },
        resolve: () => resolve(ok),
        reject,
      });
    });
  }
}

export const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** 两个 0xRRGGBB 之间线性混色。 */
export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

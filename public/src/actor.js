// 身体控制器：按寻路结果走路、转身、在平台之间跳。所有移动都是连续模拟出来的。
import * as THREE from 'three';
import { angleDiff, clamp, damp, dampAngle, Cancelled, TAU } from './util.js';
import { SURFACES } from './nav.js';

const SPEED = { walk: 0.42, run: 1.0, skip: 0.62, sneak: 0.24 };
const CYCLE = 0.3; // 一个完整步态周期（两步）走多远（米）

export class Actor {
  constructor(char, anim, nav, clock) {
    this.c = char; this.anim = anim; this.nav = nav; this.clock = clock;
    this.pos = new THREE.Vector3(0.2, 0, 0.9);
    this.yaw = 0;
    this.surface = 'floor';
    this.speed = 0;
    this.yawRate = 0;
    this.motion = null; // 当前正在执行的位移：走一段路 / 跳 / 原地转身
    this.spin = 0; // 跳舞时的自转速度（弧度/秒）
    this.#sync();
  }

  #sync() {
    this.c.root.position.copy(this.pos);
    this.c.root.rotation.y = this.yaw;
  }

  get where() { return { surface: this.surface, x: this.pos.x, z: this.pos.z }; }
  get moving() { return this.motion !== null; }
  /** 头顶上方的世界坐标（气泡挂在这）。 */
  headTop(out = new THREE.Vector3()) {
    this.c.J.head.getWorldPosition(out);
    out.y += 0.3;
    return out;
  }

  #begin(m, token) {
    if (this.motion) this.motion.reject(new Cancelled());
    return new Promise((resolve, reject) => { this.motion = { ...m, token, resolve, reject }; });
  }

  /** 走一段（同一个平台上的若干路径点）。back：倒退着走（脸朝着来的方向，拖东西时用）。 */
  walk(pts, token, style = 'walk', { back = false } = {}) {
    if (!pts.length) return Promise.resolve();
    this.anim.setBase('walk', { style });
    return this.#begin({ type: 'walk', pts: pts.map((p) => ({ x: p.x, z: p.z })), i: 0, style, back }, token);
  }

  /** 原地转到某个朝向。 */
  turnTo(yaw, token) {
    if (Math.abs(angleDiff(this.yaw, yaw)) < 0.05) return Promise.resolve();
    return this.#begin({ type: 'turn', yaw }, token);
  }
  facePoint(x, z, token) { return this.turnTo(Math.atan2(x - this.pos.x, z - this.pos.z), token); }

  /**
   * 跳到某个点（可以换平台，也可以是原地蹦）。to: {x, y, z, surface}。
   * keep：保持现在的姿势和朝向跳（练枪时端着枪蹦一下），不换回站姿、不举手。
   */
  jump(to, token, { height, keep = false } = {}) {
    const from = this.pos.clone();
    const d = Math.hypot(to.x - from.x, to.z - from.z), dy = to.y - from.y;
    const h = height ?? Math.max(0.16, Math.abs(dy) * 0.35 + 0.13 + d * 0.12);
    return this.#begin({ type: 'jump', from, to: new THREE.Vector3(to.x, to.y, to.z), surface: to.surface ?? this.surface, t: 0, crouch: 0.16, air: 0.36 + d * 0.3 + Math.abs(dy) * 0.12, h, phase: 0, keep, yaw: d > 0.03 && !keep ? Math.atan2(to.x - from.x, to.z - from.z) : this.yaw }, token);
  }

  /** 不换姿势、不迈步地平移到 (x, z)（练枪时弓步往前一送、再收回来）。 */
  slide(to, dur, token) {
    return this.#begin({ type: 'slide', from: this.pos.clone(), to: { x: to.x, z: to.z }, t: 0, dur: Math.max(0.01, dur) }, token);
  }

  /** 走到任意目的地（自动规划：走 + 跳）。dest: {surface, x, z, yaw?}。走不到会抛错。 */
  async goTo(dest, token, style = 'walk') {
    const steps = this.nav.route(this.where, dest);
    if (!steps) throw new Error(`去不了 ${dest.surface} (${dest.x.toFixed(2)}, ${dest.z.toFixed(2)})`);
    for (const st of steps) {
      token?.check();
      if (st.type === 'walk') await this.walk(st.pts, token, style);
      else { await this.turnTo(Math.atan2(st.to.x - this.pos.x, st.to.z - this.pos.z), token); await this.jump(st.to, token); }
    }
    this.anim.setBase('stand');
    if (dest.yaw !== undefined) await this.turnTo(dest.yaw, token);
  }

  /** 立刻停下（被打断时用）。 */
  halt() {
    if (this.motion) { const m = this.motion; this.motion = null; m.reject(new Cancelled()); }
    if (this.pos.y !== SURFACES[this.surface]?.y && SURFACES[this.surface]) this.pos.y = SURFACES[this.surface].y;
    this.speed = 0; this.spin = 0;
  }

  update(dt) {
    const m = this.motion;
    const prevYaw = this.yaw;
    if (m) {
      if (m.token?.cancelled) {
        this.motion = null;
        if (m.type === 'jump') { this.pos.copy(m.phase >= 1 && m.t / m.air > 0.5 ? m.to : m.from); if (this.pos.equals(m.to)) this.surface = m.surface; }
        this.speed = 0;
        if (this.anim.base === 'walk') this.anim.setBase('stand');
        m.reject(new Cancelled());
      } else if (m.type === 'walk') this.#stepWalk(m, dt);
      else if (m.type === 'turn') this.#stepTurn(m, dt);
      else if (m.type === 'jump') this.#stepJump(m, dt);
      else if (m.type === 'slide') this.#stepSlide(m, dt);
    } else {
      this.speed = damp(this.speed, 0, 12, dt);
      if (this.spin) this.yaw += this.spin * dt;
    }
    this.yawRate = dt > 0 ? damp(this.yawRate, angleDiff(prevYaw, this.yaw) / dt, 14, dt) : 0;
    this.anim.speedK = this.speed / SPEED.walk;
    this.#sync();
  }

  #finish(m) { if (this.motion === m) this.motion = null; m.resolve(); }

  #stepWalk(m, dt) {
    const target = m.pts[m.i];
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const last = m.i === m.pts.length - 1;
    if (dist < (last ? 0.025 : 0.07)) {
      if (last) { this.pos.x = target.x; this.pos.z = target.z; this.speed = 0; this.anim.setBase('stand'); this.#finish(m); return; }
      m.i++; return;
    }
    const want = Math.atan2(dx, dz) + (m.back ? Math.PI : 0);
    const err = angleDiff(this.yaw, want);
    this.yaw = dampAngle(this.yaw, want, 11, dt);
    const max = SPEED[m.style] ?? SPEED.walk;
    let remain = dist;
    for (let k = m.i + 1; k < m.pts.length; k++) remain += Math.hypot(m.pts[k].x - m.pts[k - 1].x, m.pts[k].z - m.pts[k - 1].z);
    const facing = Math.max(0, Math.cos(err));
    const goal = max * Math.pow(facing, 2) * clamp(remain / 0.16 + 0.25, 0.25, 1);
    this.speed = damp(this.speed, goal, 7, dt);
    // 朝目标点走（而不是朝当前朝向走），免得绕着路径点打转；朝向只影响快慢
    const step = Math.min(dist, this.speed * dt);
    this.pos.x += (dx / dist) * step; this.pos.z += (dz / dist) * step;
    this.anim.walkPhase += (m.back ? -1 : 1) * (step / CYCLE) * TAU;
  }

  #stepTurn(m, dt) {
    this.speed = damp(this.speed, 0, 12, dt);
    this.yaw = dampAngle(this.yaw, m.yaw, 9, dt);
    if (Math.abs(angleDiff(this.yaw, m.yaw)) < 0.04) { this.yaw = m.yaw; this.#finish(m); }
  }

  #stepJump(m, dt) {
    m.t += dt;
    this.speed = 0;
    this.yaw = dampAngle(this.yaw, m.yaw, 14, dt);
    if (m.phase === 0) { // 下蹲蓄力
      if (m.t === dt) { if (!m.keep) this.anim.setBase('stand'); this.anim.bump(2.2); }
      if (m.t >= m.crouch) { m.phase = 1; m.t = 0; this.anim.bump(-3.2); if (!m.keep) this.anim.gesture('airJump', (m.air + 0.1) / 0.75); }
    } else if (m.phase === 1) { // 腾空
      const u = clamp(m.t / m.air, 0, 1);
      this.pos.x = m.from.x + (m.to.x - m.from.x) * u;
      this.pos.z = m.from.z + (m.to.z - m.from.z) * u;
      this.pos.y = m.from.y + (m.to.y - m.from.y) * u + m.h * 4 * u * (1 - u);
      if (u >= 1) { this.pos.copy(m.to); this.surface = m.surface; m.phase = 2; m.t = 0; this.anim.bump(2.6); }
    } else if (m.t >= 0.16) this.#finish(m); // 落地缓冲
  }

  #stepSlide(m, dt) {
    m.t += dt;
    this.speed = 0;
    const u = clamp(m.t / m.dur, 0, 1), e = u * u * (3 - 2 * u);
    this.pos.x = m.from.x + (m.to.x - m.from.x) * e; this.pos.z = m.from.z + (m.to.z - m.from.z) * e;
    if (u >= 1) this.#finish(m);
  }
}

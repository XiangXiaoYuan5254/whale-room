// 小球：很简单的滚动物理。她走路碰到会把它拱开，也会专门去踢它玩。
import * as THREE from 'three';

const R = 0.07;
const _axis = new THREE.Vector3();

export class Ball {
  constructor(mesh, nav) {
    this.mesh = mesh; this.nav = nav;
    this.pos = new THREE.Vector3(mesh.position.x, R, mesh.position.z);
    this.vel = new THREE.Vector3();
    this.hop = 0; this.hopV = 0;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  /** 朝 (dx, dz) 方向踢一脚。 */
  kick(dx, dz, power = 1.8) {
    const l = Math.hypot(dx, dz) || 1;
    this.vel.x = (dx / l) * power; this.vel.z = (dz / l) * power;
    this.hopV = 1.1 + power * 0.25;
  }

  update(dt, actor) {
    // 被她的脚拱开
    if (actor && actor.surface === 'floor') {
      const dx = this.pos.x - actor.pos.x, dz = this.pos.z - actor.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.15 && d > 1e-4) {
        const push = 0.35 + actor.speed * 1.4;
        this.vel.x += (dx / d) * push * dt * 14; this.vel.z += (dz / d) * push * dt * 14;
      }
    }
    const sp = this.speed;
    if (sp > 0.003) {
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      // 撞到家具/墙：哪个方向走不通就把哪个方向的速度弹回去
      if (this.nav.isFree(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (this.nav.isFree(nx, this.pos.z)) { this.pos.x = nx; this.vel.z *= -0.55; }
      else if (this.nav.isFree(this.pos.x, nz)) { this.pos.z = nz; this.vel.x *= -0.55; }
      else { this.vel.x *= -0.55; this.vel.z *= -0.55; }
      const drag = Math.exp(-dt * 1.3);
      this.vel.x *= drag; this.vel.z *= drag;
      _axis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(_axis, (sp * dt) / R);
    } else { this.vel.x = 0; this.vel.z = 0; }
    // 被踢起来的小弹跳
    if (this.hop > 0 || this.hopV > 0) {
      this.hopV -= 9.8 * dt; this.hop += this.hopV * dt;
      if (this.hop <= 0) { this.hop = 0; this.hopV = this.hopV < -0.6 ? -this.hopV * 0.45 : 0; }
    }
    this.mesh.position.set(this.pos.x, R + this.hop, this.pos.z);
  }
}

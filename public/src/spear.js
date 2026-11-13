// 红缨枪：平时竖着插在前墙根的小枪架上（水壶和小音箱之间，那一溜原来空着）。她练枪时走过去拔下来，到地毯上练一段，练完插回去；
// 练到一半被叫走（比如手机响了），就先横放在脚边的地上，回头再捡起来。
// 拿在手里时，枪的朝向、握在哪儿由动作系统给出（animator.js 的 BASE.spear / ARMS.spear 写进 anim.spear），
// 这里只负责让枪身真的穿过她的手：哪只手是「后手」，枪就以那只手现在的位置为准摆上去。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Carry } from './body.js';
import { clamp } from './util.js';

/** 枪长（米）。她身高约 0.65 米，枪差不多是她的一倍半多一点。 */
export const SPEAR_LEN = 1.15;
/** 插在枪架上：枪尾落在架子底座的插口里（这一点），枪竖直。 */
export const SPEAR_HOME = { x: -0.75, z: 1.665, y: 0.024 };
/** 枪架占的地方（寻路、小球都要绕开）：[x, z, 半径]。 */
export const SPEAR_RACK_CIRCLE = [SPEAR_HOME.x, 1.7, 0.06];
/** 她去拿 / 放回枪时站的地方：枪架跟前，面朝前墙；稍微偏左一点，右手正好对着枪。 */
export const SPEAR_SPOT = { surface: 'floor', x: SPEAR_HOME.x + 0.05, z: 1.49, yaw: 0 };

const Y = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _h = new THREE.Vector3(), _h2 = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export function buildSpear(scene) {
  const group = new THREE.Group(); group.name = 'spear'; scene.add(group);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a3a22, roughness: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9d1dc, roughness: 0.28, metalness: 0.55 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb98b3e, roughness: 0.4, metalness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd3202c, roughness: 0.9, side: THREE.DoubleSide });
  // 红缨的贴图：一缕一缕的红丝，下摆参差、透空（alphaTest 剪掉），远看不再是一个实心红锥
  const tasselMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5, map: (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const x = c.getContext('2d');
    for (let i = 0; i < 64; i++) {
      const len = 64 * (0.62 + 0.38 * Math.abs(Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 4.1) * 0.5));
      const gr = x.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, '#9e1018'); gr.addColorStop(0.5, i % 3 ? '#e02a32' : '#c81e28'); gr.addColorStop(1, '#ff4a4e');
      x.fillStyle = gr; x.fillRect(i * 2, 0, 1.6, len);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
    return t;
  })() });
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; group.add(m); return m; };
  // 枪杆（枪尾在原点，沿 +Y 到枪尖）
  const shaftTop = 1.0;
  add(new THREE.CylinderGeometry(0.0062, 0.0069, shaftTop - 0.02, 10), wood, 0.02 + (shaftTop - 0.02) / 2);
  add(new THREE.ConeGeometry(0.0074, 0.028, 10).rotateX(Math.PI), brass, 0.014); // 枪纂
  add(new THREE.CylinderGeometry(0.0085, 0.0078, 0.026, 10), brass, shaftTop + 0.013); // 枪头底下的箍
  // 枪头：细长的菱形叶片
  const blade = add(new THREE.ConeGeometry(0.017, 0.12, 4), steel, shaftTop + 0.026 + 0.06);
  blade.scale.set(1, 1, 0.38);
  add(new THREE.SphereGeometry(0.0105, 10, 8), steel, shaftTop + 0.03).scale.set(1, 0.7, 0.6);
  // 红缨：挂在箍下面的一束红穗子，枪一动就被甩起来
  const tassel = new THREE.Group(); tassel.position.y = shaftTop + 0.004; group.add(tassel);
  // 两层：外面一圈散开的、里面一圈贴着杆子的，看着蓬一点
  for (const [r, h] of [[0.036, 0.095], [0.022, 0.08]]) {
    const tm = new THREE.Mesh(new THREE.ConeGeometry(r, h, 18, 3, true), tasselMat); tm.position.y = -h / 2; tm.castShadow = true; tassel.add(tm);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), red); tassel.add(knot);
  // 点击判定用的隐形粗一点的杆子（枪太细，不好点中）
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, SPEAR_LEN, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.y = SPEAR_LEN / 2; hit.castShadow = false; hit.name = 'spear'; group.add(hit);

  // 枪架：贴着前墙的一根小立柱，底座上有个插口接住枪尾，上面伸出一只小环扶着枪杆。点它也算点枪
  const rack = new THREE.Group(); rack.name = 'spear'; scene.add(rack);
  const rackWood = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.6 });
  const rbox = (w, h, d, x, y, z, r = 0.004) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), rackWood); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; rack.add(m); return m; };
  const { x: hx, z: hz } = SPEAR_HOME;
  rbox(0.13, 0.02, 0.11, hx, 0.01, hz + 0.025, 0.006); // 底座
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.03, 14, 1, true), brass); cup.position.set(hx, 0.035, hz); rack.add(cup); // 插口
  rbox(0.024, 0.62, 0.024, hx, 0.33, hz + 0.065); // 立柱
  rbox(0.02, 0.018, 0.07, hx, 0.6, hz + 0.035); // 横撑
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0035, 8, 20), brass); ring.rotation.x = Math.PI / 2; ring.position.set(hx, 0.6, hz); rack.add(ring);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), rackWood); knob.position.set(hx, 0.645, hz + 0.065); rack.add(knob);

  const carry = new Carry(group);
  const homePose = (pos, quat) => { pos.set(SPEAR_HOME.x, SPEAR_HOME.y, SPEAR_HOME.z); quat.identity(); };
  carry.to(homePose); carry.update(0);

  // 红缨的摆动：一个小弹簧，跟着枪头的速度往反方向甩，平时往下垂
  const tip = new THREE.Vector3(), prevTip = new THREE.Vector3(), vel = new THREE.Vector3(), tdir = new THREE.Vector3(0, -1, 0), tvel = new THREE.Vector3();
  let hasPrev = false;

  const api = {
    group, carry,
    /** 在哪：home 插在枪架上 | hand 在手里 | floor 横放在地上。 */
    at: 'home',
    floor: null, // 横放在地上时：{ x, z, yaw }（枪尾的位置、枪尖朝向）
    /** 插回枪架上。 */
    toHome(dur = 0.4) { this.at = 'home'; this.floor = null; carry.to(homePose, dur, 0.03); },
    /** 横放到地上：枪尾在 (x, z)，枪尖朝 yaw 方向。 */
    toFloor(x, z, yaw, dur = 0.4) {
      this.at = 'floor'; this.floor = { x, z, yaw };
      carry.to((pos, quat) => { pos.set(x, 0.0075, z); quat.setFromUnitVectors(Y, _d.set(Math.sin(yaw), 0, Math.cos(yaw))); }, dur, 0.05);
    },
    /** 拿到手里：之后每帧按 anim.spear 摆在后手上。 */
    toHand(body, anim, actor, dur = 0.35) { this.at = 'hand'; this.floor = null; carry.to(holdPose(body, anim, actor), dur, 0.03); },
    /** 后手换了一只（左右镜像时）：枪从一只手平滑地递到另一只手。 */
    regrip(body, anim, actor, dur = 0.3) { if (this.at === 'hand') carry.to(holdPose(body, anim, actor), dur, 0); },
    /** 枪身上离枪尾 d 米的那一点（世界坐标）。 */
    pointAt(d, out = new THREE.Vector3()) { return out.set(0, d, 0).applyQuaternion(group.quaternion).add(group.position); },
    update(dt) {
      carry.update(dt);
      // 红缨：枪头往哪边动，穗子往反方向飘；不动时往下垂（横放在地上时顺着枪杆平躺）
      this.pointAt(SPEAR_LEN - 0.12, tip);
      if (hasPrev && dt > 0) vel.lerp(_v.subVectors(tip, prevTip).divideScalar(dt), 1 - Math.exp(-dt * 20));
      prevTip.copy(tip); hasPrev = true;
      const axis = _w.set(0, 1, 0).applyQuaternion(group.quaternion);
      const want = _v.copy(axis).multiplyScalar(-0.75).addScaledVector(DOWN, this.at === 'floor' ? 0.05 : 0.7).addScaledVector(vel, -0.35).normalize();
      tvel.addScaledVector(_h.subVectors(want, tdir), 90 * dt).multiplyScalar(Math.exp(-dt * 9));
      tdir.addScaledVector(tvel, dt).normalize();
      // 穗子是从箍上垂下来的，和枪杆的夹角有个上限，不会翻到枪头上去
      if (tdir.dot(axis) > -0.15) tdir.addScaledVector(axis, -(tdir.dot(axis) + 0.15)).normalize();
      _q.copy(group.quaternion).invert();
      tassel.quaternion.setFromUnitVectors(DOWN, _h.copy(tdir).applyQuaternion(_q));
      const stretch = clamp(vel.length() * 0.12, 0, 0.35);
      tassel.scale.set(1 - stretch * 0.4, 1 + stretch, 1 - stretch * 0.4);
    },
  };
  return api;
}

/**
 * 拿在手里时枪该在哪：枪身穿过「后手」，朝向是动作系统给的方向（胸口坐标，跟着上身转），
 * 后手离枪尾 grip 米。ground：立枪时枪尾杵在地上（grip 按手的高度现算）。
 * 另外兜个底：枪尖、枪尾都不许插进地板里（短手短腿的她举不高，枪又长）。
 */
function holdPose(body, anim, actor) {
  return (pos, quat) => {
    const s = anim.spear;
    body.quat('spine', _q);
    _d.fromArray(s.dir).normalize().applyQuaternion(_q);
    // 后手的位置；换手的那一下按 mainK 在两只手之间过渡
    body.hand('R', _h); body.hand('L', _h2); _h.lerp(_h2, s.mainK);
    const floorY = actor.pos.y;
    const handY = _h.y - floorY;
    let grip = s.grip;
    if (s.ground && _d.y > 0.3) grip = clamp(handY / _d.y, 0.05, 0.5);
    // 枪尖和枪尾都留在地板上面
    const front = SPEAR_LEN - grip;
    const lo = (0.02 - handY) / front, hi = grip > 0.02 ? (handY - 0.004) / grip : 1;
    if (_d.y < lo || _d.y > hi) {
      const y = clamp(_d.y, lo, Math.max(lo, hi)), hl = Math.hypot(_d.x, _d.z) || 1, k = Math.sqrt(Math.max(0, 1 - y * y)) / hl;
      _d.set(_d.x * k, y, _d.z * k);
    }
    pos.copy(_h).addScaledVector(_d, -grip);
    // 绕枪杆的转角跟着上身走（不然枪头的刃面会乱翻）
    _x.set(1, 0, 0).applyQuaternion(_q); _x.addScaledVector(_d, -_x.dot(_d));
    if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).applyQuaternion(_q).addScaledVector(_d, -_d.z);
    _x.normalize(); _z.crossVectors(_x, _d);
    quat.setFromRotationMatrix(_m.makeBasis(_x, _d, _z));
  };
}

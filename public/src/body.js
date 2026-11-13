// 身体上的点：手现在在哪、嘴在哪、胸口朝哪。手里拿的东西（碗、勺、手机、书、水壶、被头）都靠它跟着手走，
// 而不是固定挂在胸口的某个位置上——那样手一动，东西就悬空或者插进身体里。
// 换了外部模型后看得见的是蒙皮骨骼，所以有模型时按蒙皮骨骼算，没有时按内置骨架算，两边给出同样的结果。
import * as THREE from 'three';
import { restPose } from './animator.js';
import { SCALE } from './character.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** 一样能被拿起、放下的东西：从现在的位置平滑地移到新的去处；去处可以是活的（比如一直跟着手）。 */
export class Carry {
  /** @param obj 直接挂在场景下的物体（位置、朝向就是世界坐标） */
  constructor(obj) {
    this.obj = obj; this.get = null; this.k = 1; this.dur = 0; this.arc = 0;
    this.p0 = new THREE.Vector3(); this.q0 = new THREE.Quaternion();
    this.p1 = new THREE.Vector3(); this.q1 = new THREE.Quaternion();
  }
  /**
   * 换一个去处。
   * @param get (pos, quat) => void：每帧写出目标位置和朝向
   * @param dur 花多少秒过去（0 = 立刻）
   * @param arc 路上抬高多少米（拿起、放下时的那一下弧线）
   */
  to(get, dur = 0, arc = 0) {
    this.get = get; this.p0.copy(this.obj.position); this.q0.copy(this.obj.quaternion);
    this.k = dur > 0 ? 0 : 1; this.dur = dur; this.arc = arc;
  }
  /** 还在半路上。 */
  get moving() { return this.k < 1; }
  update(dt) {
    if (!this.get) return;
    this.get(this.p1, this.q1);
    if (this.k < 1) {
      this.k = Math.min(1, this.k + dt / this.dur);
      const e = this.k * this.k * (3 - 2 * this.k);
      this.obj.position.lerpVectors(this.p0, this.p1, e); this.obj.position.y += Math.sin(Math.PI * e) * this.arc;
      this.obj.quaternion.slerpQuaternions(this.q0, this.q1, e);
    } else { this.obj.position.copy(this.p1); this.obj.quaternion.copy(this.q1); }
  }
}

export class Body {
  constructor(char) {
    this.char = char;
    this.rest = restPose(char.J);
    this.restInv = Object.fromEntries(Object.entries(this.rest.quat).map(([k, q]) => [k, q.clone().invert()]));
    this.skin = null;
    /** 各关节在绑定姿势下的位置（模型单位：身高约 1.97，脚底 y=0，脸朝 +Z，她的左手边是 +X）。 */
    this.bind = this.rest.pos;
    /** 嘴在绑定姿势下的位置。 */
    this.mouth = new THREE.Vector3(0, 1.08, 0.42);
  }

  /** 换上外部模型后调用：之后所有的点都按模型的蒙皮骨骼算。 */
  setSkin(skin) {
    this.skin = skin; this.bind = skin.bind;
    if (skin.mouth) this.mouth.copy(skin.mouth); else this.mouth.set(0, this.bind.head.y + 0.05, 0.32);
  }

  /** 让骨骼的世界矩阵跟上当前姿势。一帧里姿势定下来之后、读点之前调用。 */
  sync() {
    this.skin?.syncBones();
    this.char.root.updateWorldMatrix(true, true);
  }

  /** 绑定姿势下的一点（模型坐标），跟着某根骨骼动之后现在的世界坐标。 */
  toWorld(bone, p, out = new THREE.Vector3()) {
    out.copy(p).sub(this.bind[bone]);
    if (this.skin) return out.applyMatrix4(this.skin.bone(bone).matrixWorld);
    return out.applyQuaternion(this.restInv[bone]).applyMatrix4(this.char.J[bone].matrixWorld);
  }

  /** toWorld 的逆运算：世界坐标里的一点，换回「绑定姿势下它相当于哪一点」（模型坐标）。 */
  toBind(bone, w, out = new THREE.Vector3()) {
    if (this.skin) out.copy(w).applyMatrix4(_m.copy(this.skin.bone(bone).matrixWorld).invert());
    else out.copy(w).applyMatrix4(_m.copy(this.char.J[bone].matrixWorld).invert()).applyQuaternion(this.rest.quat[bone]);
    return out.add(this.bind[bone]);
  }

  /** 某根骨骼现在相对绑定姿势转了多少（世界朝向）。 */
  quat(bone, out = new THREE.Quaternion()) {
    if (this.skin) return this.skin.bone(bone).getWorldQuaternion(out);
    return this.char.J[bone].getWorldQuaternion(out).multiply(this.restInv[bone]);
  }

  /** 手心的世界坐标。side: 'L' | 'R'。 */
  hand(side, out = new THREE.Vector3()) { return this.toWorld('fore' + side, this.bind['hand' + side], out); }

  /** 两手中点。 */
  hands(out = new THREE.Vector3()) { return this.hand('L', out).add(this.hand('R', _a)).multiplyScalar(0.5); }

  /** 嘴的世界坐标。 */
  mouthWorld(out = new THREE.Vector3()) { return this.toWorld('head', this.mouth, out); }

  /**
   * 「拿在左手里」的东西该在哪：左手的位置 + 胸口朝向下的一段偏移（模型单位）。
   * 双手拿的东西也以左手为准：右手腾出去挥手、打哈欠时，东西还稳稳在左手里。
   */
  inLeftHand(offset, out = new THREE.Vector3()) {
    this.quat('spine', _q);
    return this.hand('L', out).add(_b.copy(offset).multiplyScalar(SCALE).applyQuaternion(_q));
  }

  /** 她面朝的方向（绕竖轴的角度，0 = 面朝 +Z）。 */
  get yaw() { return this.char.root.rotation.y; }

  /**
   * 身体的大致轮廓：几个球（世界坐标 x, y, z + 半径，米），被子盖在身上时靠它鼓起来。
   * @returns [[x, y, z, r], ...]
   */
  blobs() {
    const B = this.bind, out = [];
    const add = (bone, x, y, z, r) => { this.toWorld(bone, _a.set(x, y, z), _b); out.push([_b.x, _b.y, _b.z, r]); };
    add('hips', 0, B.hips.y - 0.02, 0.02, 0.085); // 胯和裙子
    add('spine', 0, B.spine.y + 0.2, 0.03, 0.07); // 胸口
    for (const s of ['L', 'R']) {
      const k = B['shin' + s];
      add('leg' + s, k.x, k.y + 0.02, 0.02, 0.045); // 膝盖
      add('shin' + s, k.x, 0.07, 0.07, 0.05); // 脚
    }
    return out;
  }
}

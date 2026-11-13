// 程序化动作：没有任何预先录好的动画。每一帧根据「基础姿势 + 手臂动作 + 一次性小动作 + 视线」算出每个关节的角度，
// 再做平滑过渡；头发、尾巴、呆毛、鱼鳍是跟着身体运动甩出来的二级运动。
import * as THREE from 'three';
import { clamp, damp, lerp, wobble, smooth, TAU, rand } from './util.js';
import { SCALE } from './character.js';

export const JOINTS = ['hips', 'spine', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR', 'tail0', 'tail1', 'tail2', 'tail3', 'fluke', 'finL', 'finR', 'ahoge', 'skirt', 'backBow'];
export const REST = {
  hips: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0],
  armL: [0.04, 0, 0.2], armR: [0.04, 0, -0.2], foreL: [-0.18, 0, 0], foreR: [-0.18, 0, 0],
  legL: [0, 0, 0], legR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0],
  tail0: [-1.05, 0, 0], tail1: [0.3, 0, 0], tail2: [0.34, 0, 0], tail3: [0.34, 0, 0], fluke: [0.25, 0, 0],
  finL: [0, 0, 0], finR: [0, 0, 0], ahoge: [0, 0, 0], skirt: [0, 0, 0], backBow: [0, 0, 0],
};
// headFree：头可以比平时多仰多少（0~1）。外部模型的头发是长在模型上的，平时头转太多会把头发拧坏，所以有个限度；趴着时需要把脸抬起来
// hipsX：胯往左右挪多少（练枪弓步、跳舞扭胯时重心移到一条腿上）
export const SCALARS = { hipsY: 0.42, hipsZ: 0, hipsX: 0, skirtSquash: 1, wagAmp: 0.16, wagFreq: 1.3, hairFollow: 0.8, rate: 12, headFree: 0 };

const newPose = () => {
  const p = { ...SCALARS };
  for (const j of JOINTS) p[j] = [...REST[j]];
  // 手的目标点（胸口坐标，见 HOLD）：给了就让手真的伸到那儿，不给就按上面的关节角摆
  p.ikL = null; p.ikR = null;
  p.pole = null; // 手肘往哪边撑（左手的方向，右手自动镜像）
  p.muteL = 0; p.muteR = 0; // 一次性小动作要用这只手时，暂时让目标点让位（0~1）
  p.spear = null; // 手里拿着枪时，枪怎么拿（见 BASE.spear / ARMS.spear）
  return p;
};

/** 内置骨架在「三视图姿势」（REST）下，各关节在模型空间里的位置和朝向。纯计算，不动场景。 */
export function restPose(J) {
  const pos = {}, quat = {};
  const e = new THREE.Euler(), lp = new THREE.Vector3();
  const place = (name, euler) => {
    const j = J[name], parent = j.parent?.name && J[j.parent.name] === j.parent ? j.parent.name : null;
    const lq = new THREE.Quaternion().setFromEuler(e.set(euler[0], euler[1], euler[2]));
    lp.copy(j.position);
    if (name === 'hips') lp.set(0, SCALARS.hipsY, SCALARS.hipsZ);
    if (parent) {
      quat[name] = quat[parent].clone().multiply(lq);
      pos[name] = lp.clone().applyQuaternion(quat[parent]).add(pos[parent]);
    } else { quat[name] = lq; pos[name] = lp.clone(); }
  };
  for (const name of JOINTS) place(name, REST[name]);
  for (const name of ['handL', 'handR']) place(name, [0, 0, 0]);
  return { pos, quat };
}

/**
 * 手里拿东西时，手和东西各在哪。坐标是「胸口坐标」：就是模型站直时的模型坐标（身高约 1.97，脚底 y=0，
 * 脸朝 +Z，她的左手边是 +X），整体跟着胸口一起动。她的手臂很短（肩到手心约 0.36），所以东西都得贴着胸口拿。
 */
export const HOLD = {
  // 手机：两手捏着两侧，屏幕朝脸
  phone: { L: [0.132, 0.69, 0.3], R: [-0.132, 0.69, 0.3], at: [0, 0.715, 0.325] },
  // 碗：两手托着碗的两侧；用勺子时只剩左手托
  bowl: { L: [0.142, 0.655, 0.29], R: [-0.142, 0.655, 0.29], at: [0, 0.592, 0.33] }, // at：碗底中心
  // 勺子（右手）：dip 是勺头在碗里时手的位置，mouth 是勺头送到嘴边时手的位置
  spoon: { dip: [-0.115, 0.83, 0.22], mouth: [-0.155, 0.835, 0.235], len: 0.2 },
  // 书：两手托着下沿两角
  book: { L: [0.165, 0.66, 0.29], R: [-0.165, 0.66, 0.29], at: [0, 0.735, 0.35] },
  // 被头：两手并排抓着
  quilt: { L: [0.075, 0.66, 0.26], R: [-0.075, 0.66, 0.26] },
  // 水壶（右手提着）
  can: { R: [-0.13, 0.64, 0.27] },
};
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// ---------------- 基础姿势（下半身 + 躯干为主） ----------------
const BASE = {
  stand(p, t) {
    const b = Math.sin(t * 1.6);
    p.hipsY = 0.42 + b * 0.004;
    p.spine = [0.02 + b * 0.012, wobble(t * 0.3, 1) * 0.05, wobble(t * 0.23, 2) * 0.025];
    p.head = [wobble(t * 0.4, 5) * 0.04, wobble(t * 0.27, 6) * 0.06, wobble(t * 0.31, 7) * 0.035];
    p.armL = [0.04 + b * 0.02, 0, 0.2 + b * 0.015]; p.armR = [0.04 + b * 0.02, 0, -0.2 - b * 0.015];
    p.hips = [0, 0, wobble(t * 0.2, 3) * 0.02];
  },
  walk(p, t, a) {
    const st = a.params.style ?? 'walk';
    const k = clamp(a.speedK, 0, 1.4);
    const ph = a.walkPhase, s = Math.sin(ph), c = Math.cos(ph);
    let A = 0.62, bob = 0.028, lean = 0.06, armA = 0.55;
    if (st === 'run') { A = 0.95; bob = 0.05; lean = 0.24; armA = 0.2; }
    else if (st === 'skip') { A = 0.7; bob = 0.075; lean = 0.02; armA = 0.9; }
    else if (st === 'sneak') { A = 0.36; bob = 0.012; lean = 0.2; armA = 0.15; }
    p.rate = 24;
    p.legL = [-s * A * k, 0, 0.02]; p.legR = [s * A * k, 0, -0.02];
    p.shinL = [Math.max(0, c) * 0.95 * k, 0, 0]; p.shinR = [Math.max(0, -c) * 0.95 * k, 0, 0];
    p.hipsY = 0.42 - 0.014 * k + Math.abs(c) * bob * k;
    p.hips = [0, s * 0.08 * k, s * 0.05 * k];
    p.spine = [lean * k, -s * 0.1 * k, -s * 0.045 * k];
    p.head = [-lean * 0.5 * k + (st === 'sneak' ? 0.25 : 0), s * 0.03, s * 0.035 * k + (st === 'skip' ? Math.sin(ph * 0.5) * 0.12 : 0)];
    if (st === 'run') {
      p.armL = [0.75, 0, 0.75 + s * 0.06]; p.armR = [0.75, 0, -0.75 + s * 0.06];
      p.foreL = [-0.1, 0, 0]; p.foreR = [-0.1, 0, 0];
    } else if (st === 'sneak') {
      p.armL = [-0.35 + s * armA, 0, 0.12]; p.armR = [-0.35 - s * armA, 0, -0.12];
      p.foreL = [-0.5, 0, 0]; p.foreR = [-0.5, 0, 0];
    } else {
      p.armL = [s * armA * k, 0, 0.24 + (st === 'skip' ? 0.35 : 0)]; p.armR = [-s * armA * k, 0, -0.24 - (st === 'skip' ? 0.35 : 0)];
      p.foreL = [-0.3 - Math.max(0, -s) * 0.4 * k, 0, 0]; p.foreR = [-0.3 - Math.max(0, s) * 0.4 * k, 0, 0];
    }
    p.tail0[1] = -s * 0.22 * k; p.tail1[1] = -Math.sin(ph - 0.7) * 0.2 * k; p.tail2[1] = -Math.sin(ph - 1.4) * 0.22 * k;
    p.wagAmp = 0.04;
    p.backBow = [0, 0, s * 0.08 * k];
    p.skirt = [c * 0.035 * k, 0, s * 0.07 * k]; // 裙摆跟着步子左右摆
  },
  // 坐在床沿/椅子/窗台上，小腿悬空晃
  sit(p, t, a) {
    const b = Math.sin(t * 1.5);
    const kick = a.params.kick ?? 0.6;
    const sw = Math.sin(t * 2.3) * 0.32 * kick * (0.6 + 0.4 * wobble(t * 0.25, 9));
    p.hipsY = 0.095; p.hipsZ = -0.02;
    p.hips = [-0.06, 0, 0];
    p.legL = [-1.5, 0, 0.07]; p.legR = [-1.5, 0, -0.07];
    p.shinL = [1.3 + sw, 0, 0]; p.shinR = [1.3 - sw, 0, 0];
    p.spine = [0.1 + b * 0.012, wobble(t * 0.3, 1) * 0.06, wobble(t * 0.2, 2) * 0.03];
    p.head = [wobble(t * 0.35, 5) * 0.05, wobble(t * 0.22, 6) * 0.1, wobble(t * 0.3, 7) * 0.06];
    p.armL = [0.22, 0, 0.42]; p.armR = [0.22, 0, -0.42]; p.foreL = [-0.1, 0, -0.1]; p.foreR = [-0.1, 0, 0.1];
    p.skirt = [-0.5, 0, 0]; p.skirtSquash = 0.66;
    p.tail0 = [-0.12, 0, 0]; p.tail1 = [0.05, 0, 0]; p.tail2 = [0.05, 0, 0]; p.tail3 = [0.1, 0, 0]; p.fluke = [0.1, 0, 0];
    p.wagAmp = 0.22; p.wagFreq = 1.1;
  },
  // 腿伸直坐在地上/床上
  sitFloor(p, t, a) {
    const b = Math.sin(t * 1.5);
    p.hipsY = 0.095;
    p.hips = [-0.1, 0, 0];
    const toe = Math.sin(t * 1.9) * 0.06;
    p.legL = [-1.45 + toe, 0, 0.24]; p.legR = [-1.45 - toe, 0, -0.24];
    p.shinL = [0.06, 0, 0]; p.shinR = [0.06, 0, 0];
    const turn = a.params.turn ?? 0; // 斜坐：上身往左拧一点（弧度）
    p.spine = [0.12 + b * 0.012, wobble(t * 0.3, 1) * 0.05 + turn, wobble(t * 0.2, 2) * 0.03 - turn * 0.12];
    p.head = [wobble(t * 0.35, 5) * 0.05 - (a.params.lookUp ?? 0) * 0.35, wobble(t * 0.22, 6) * 0.08, wobble(t * 0.3, 7) * 0.05];
    p.armL = [-0.35, 0, 0.25]; p.armR = [-0.35, 0, -0.25]; p.foreL = [-0.55, 0, -0.35]; p.foreR = [-0.55, 0, 0.35];
    p.skirt = [-0.55, 0, 0]; p.skirtSquash = 0.6;
    p.tail0 = [-0.1, 0.35, 0]; p.tail1 = [0.03, 0.25, 0]; p.tail2 = [0.03, 0.2, 0]; p.tail3 = [0.05, 0.1, 0]; p.fluke = [0.1, 0, 0];
    p.wagAmp = 0.12; p.wagFreq = 0.9;
  },
  // 抱膝坐（窗台、躲桌子底下）
  hugKnees(p, t) {
    const b = Math.sin(t * 1.4);
    p.hipsY = 0.1;
    p.hips = [-0.12, 0, 0];
    p.legL = [-2.15, 0, 0.1]; p.legR = [-2.15, 0, -0.1];
    p.shinL = [2.0, 0, 0]; p.shinR = [2.0, 0, 0];
    p.spine = [0.3 + b * 0.012, 0, wobble(t * 0.2, 2) * 0.04];
    p.head = [-0.1 + wobble(t * 0.3, 5) * 0.04, 0, wobble(t * 0.25, 7) * 0.1];
    p.armL = [-1.15, 0, -0.1]; p.armR = [-1.15, 0, 0.1]; p.foreL = [-0.75, 0, -0.5]; p.foreR = [-0.75, 0, 0.5];
    p.skirt = [-0.7, 0, 0]; p.skirtSquash = 0.5;
    p.tail0 = [-0.1, 0.5, 0]; p.tail1 = [0.03, 0.4, 0]; p.tail2 = [0.03, 0.4, 0]; p.tail3 = [0.05, 0.3, 0]; p.fluke = [0.1, 0, 0];
    p.wagAmp = 0.1; p.wagFreq = 0.8;
  },
  // 跪坐（在笔记本前面）
  kneel(p, t) {
    const b = Math.sin(t * 1.5);
    p.hipsY = 0.165;
    p.hips = [0.04, 0, 0];
    p.legL = [-1.22, 0, 0.1]; p.legR = [-1.22, 0, -0.1];
    p.shinL = [2.55, 0, 0]; p.shinR = [2.55, 0, 0];
    p.spine = [0.1 + b * 0.012, wobble(t * 0.3, 1) * 0.04, wobble(t * 0.2, 2) * 0.03];
    p.head = [-0.12 + wobble(t * 0.35, 5) * 0.04, wobble(t * 0.22, 6) * 0.05, wobble(t * 0.3, 7) * 0.05];
    p.armL = [-0.4, 0, 0.2]; p.armR = [-0.4, 0, -0.2]; p.foreL = [-0.7, 0, -0.3]; p.foreR = [-0.7, 0, 0.3];
    p.skirt = [-0.3, 0, 0]; p.skirtSquash = 0.72;
    p.tail0 = [-0.25, 0, 0]; p.tail1 = [0.1, 0, 0]; p.tail2 = [0.1, 0, 0]; p.tail3 = [0.15, 0, 0]; p.fluke = [0.2, 0, 0];
    p.wagAmp = 0.25; p.wagFreq = 1.4;
  },
  // 仰面躺着发呆（头比身子高，因为头大）
  lieBack(p, t, a) {
    const b = Math.sin(t * (a.params.asleep ? 0.9 : 1.3));
    const lazy = a.params.asleep ? 0 : 1;
    p.hipsY = 0.155; p.rate = 7;
    p.hips = [-1.0, 0, 0];
    p.spine = [b * 0.02, 0, wobble(t * 0.15, 2) * 0.03 * lazy];
    p.head = [-0.45, wobble(t * 0.18, 6) * 0.25 * lazy, wobble(t * 0.13, 7) * 0.08 * lazy];
    const kick = Math.max(0, wobble(t * 0.35, 11)) * 0.5 * lazy;
    p.legL = [-0.35 - kick * Math.max(0, Math.sin(t * 2.4)), 0, 0.16]; p.legR = [-0.35 - kick * Math.max(0, -Math.sin(t * 2.4)), 0, -0.16];
    p.shinL = [0.05, 0, 0]; p.shinR = [0.05, 0, 0];
    if (a.params.asleep) { p.armL = [0.3, 0, 0.3]; p.armR = [0.3, 0, -0.3]; p.foreL = [-0.15, 0, 0]; p.foreR = [-0.15, 0, 0]; } // 睡着：手放在身体两侧，盖在被子里
    else { p.armL = [0.1, 0, 1.15 + wobble(t * 0.2, 12) * 0.1]; p.armR = [0.1, 0, -1.15 + wobble(t * 0.2, 13) * 0.1]; p.foreL = [-0.3, 0, 0]; p.foreR = [-0.3, 0, 0]; }
    p.skirt = [0.25, 0, 0]; p.skirtSquash = 0.8;
    p.tail0 = [-1.7, 0.55, 0]; p.tail1 = [0.1, 0.1, 0]; p.tail2 = [0.05, 0, 0]; p.tail3 = [0.05, 0, 0]; p.fluke = [0, 0, 0];
    p.wagAmp = a.params.asleep ? 0.02 : 0.1; p.wagFreq = 0.7;
    p.hairFollow = 0.12;
  },
  // 趴着看手机：身子平趴，手肘撑在床上、两手托着腮，小腿在后面一翘一翘。手机靠在面前的枕头上，不用手拿
  lieProne(p, t) {
    const b = Math.sin(t * 1.4);
    p.hipsY = 0.15; p.rate = 8;
    p.hips = [1.42, 0, 0];
    p.spine = [-0.2 + b * 0.012, wobble(t * 0.2, 1) * 0.04, 0];
    p.head = [-1.15 + wobble(t * 0.3, 5) * 0.03, wobble(t * 0.22, 6) * 0.05, wobble(t * 0.3, 7) * 0.07]; p.headFree = 1;
    p.legL = [0.12, 0, 0.1]; p.legR = [0.12, 0, -0.1];
    p.shinL = [1.25 + Math.sin(t * 1.9) * 0.55, 0, 0]; p.shinR = [1.25 - Math.sin(t * 1.9) * 0.55, 0, 0];
    p.armL = [-1.5, 0, 0.35]; p.armR = [-1.5, 0, -0.35]; p.foreL = [-1.7, 0, -0.3]; p.foreR = [-1.7, 0, 0.3];
    p.ikL = [0.125, 0.985, 0.235]; p.ikR = [-0.125, 0.985, 0.235]; p.pole = [0.45, -0.45, 0.8];
    p.skirt = [0.15, 0, 0]; p.skirtSquash = 0.8;
    p.tail0 = [-0.55, 0, 0]; p.tail1 = [-0.1, 0, 0]; p.tail2 = [-0.1, 0, 0]; p.tail3 = [-0.15, 0, 0]; p.fluke = [-0.1, 0, 0];
    p.wagAmp = 0.35; p.wagFreq = 1.5;
    p.hairFollow = 0.35;
  },
  // 站在窗前，两只手扒着玻璃
  watch(p, t) {
    const b = Math.sin(t * 1.5);
    const tip = Math.max(0, wobble(t * 0.4, 4)) * 0.035;
    p.hipsY = 0.42 + tip + b * 0.004;
    p.spine = [-0.06 + b * 0.012, wobble(t * 0.25, 1) * 0.08, wobble(t * 0.2, 2) * 0.03];
    p.head = [-0.18 + wobble(t * 0.3, 5) * 0.06, wobble(t * 0.2, 6) * 0.22, wobble(t * 0.25, 7) * 0.1];
    p.armL = [-1.8, 0, 0.5]; p.armR = [-1.8, 0, -0.5]; p.foreL = [-0.45, 0, 0]; p.foreR = [-0.45, 0, 0];
    p.legL = [tip * 2, 0, 0.03]; p.legR = [tip * 2, 0, -0.03];
    p.wagAmp = 0.4; p.wagFreq = 1.7;
  },
  dance(p, t, a) {
    const st = a.params.style ?? 0;
    const bt = t * 6.6, s = Math.sin(bt), s2 = Math.sin(bt * 2), c = Math.cos(bt);
    p.rate = 20;
    if (st === 0) { // 左右摇摆 + 举手
      p.hipsY = 0.41 + Math.abs(s) * 0.035;
      p.hips = [0, s * 0.28, s * 0.1]; p.spine = [0.03, -s * 0.2, -s * 0.16]; p.head = [0, s * 0.12, s * 0.2];
      p.armL = [-1.45 + s * 0.35, 0, 0.85 + s * 0.3]; p.armR = [-1.45 - s * 0.35, 0, -0.85 + s * 0.3]; p.foreL = [-0.6 + c * 0.3, 0, 0]; p.foreR = [-0.6 - c * 0.3, 0, 0];
      p.legL = [0, 0, 0.06 + Math.max(0, s) * 0.28]; p.legR = [0, 0, -0.06 + Math.min(0, s) * 0.28];
      p.shinL = [Math.max(0, -s) * 0.4, 0, 0]; p.shinR = [Math.max(0, s) * 0.4, 0, 0];
    } else if (st === 1) { // 张开手转圈
      p.hipsY = 0.42 + Math.abs(s2) * 0.02;
      p.spine = [-0.05, 0, s * 0.08]; p.head = [-0.1, 0, s * 0.12];
      p.armL = [-0.95, 0, 1.05 + s2 * 0.12]; p.armR = [-0.95, 0, -1.05 - s2 * 0.12]; p.foreL = [-0.25, 0, 0]; p.foreR = [-0.25, 0, 0];
      p.legL = [-Math.max(0, s) * 0.5, 0, 0.05]; p.legR = [-Math.max(0, -s) * 0.5, 0, -0.05];
      p.shinL = [Math.max(0, s) * 0.8, 0, 0]; p.shinR = [Math.max(0, -s) * 0.8, 0, 0];
    } else if (st === 2) { // 蹦蹦跳跳举高高
      p.hipsY = 0.4 + Math.abs(s) * 0.09;
      p.spine = [0, s2 * 0.08, 0]; p.head = [-0.12, 0, s2 * 0.1];
      p.armL = [-1.9 + c * 0.3, 0, 0.6]; p.armR = [-1.9 - c * 0.3, 0, -0.6]; p.foreL = [-0.45, 0, 0]; p.foreR = [-0.45, 0, 0];
      p.legL = [0, 0, 0.1]; p.legR = [0, 0, -0.1];
      p.shinL = [Math.abs(c) * 0.5, 0, 0]; p.shinR = [Math.abs(c) * 0.5, 0, 0];
    } else DANCE_B[st]?.(p, t, a);
    p.wagAmp = 0.5; p.wagFreq = 3.3;
    p.backBow = [0, 0, s * 0.15];
  },
  /** 练枪：params = { move: 招式名, t0: 开始的时刻（动画时间）, dur: 时长, mirror: 左右镜像（换左手在后、枪尖朝右） }。 */
  spear(p, t, a) {
    const pr = a.params, mv = SPEAR_MOVES[pr.move] ?? SPEAR_MOVES.guard;
    const u = pr.dur ? clamp((t - pr.t0) / pr.dur, 0, 1) : 0;
    const s = { R: [...GUARD.R], dir: [...GUARD.dir], gap: GUARD.gap, grip: GUARD.grip, ground: false, L: null, main: 'R', rate: 14 };
    mv(p, u, t, s);
    if (pr.mirror) mirrorPose(p, s);
    p.spear = s;
  },
  /** 打拳（空击）：params = { move: 招式名, t0, dur }，见 BOX_MOVES。 */
  box(p, t, a) {
    const pr = a.params, mv = BOX_MOVES[pr.move] ?? BOX_MOVES.guard;
    mv(p, pr.dur ? clamp((t - pr.t0) / pr.dur, 0, 1) : 0, t);
  },
};

// ---------------- 打拳（照着主人给的那段视频：侧身出拳亮相、护着脸蹦跶、刺拳、直拳、摆拳、上勾拳、下潜躲闪、喘口气） ----------------
// 左脚在前的架势，身子朝右拧一点；拳是冲着她面前（镜头）打的。她胳膊短，拳头只能伸出去一小截，
// 所以每一拳都靠拧腰、送肩、往前探身把劲儿送出去。手的位置是胸口坐标（见 HOLD）。
const FIST_L = [0.085, 0.86, 0.29], FIST_R = [-0.095, 0.85, 0.27];
/** 一拳的力道曲线：一下子打出去（u 0~0.3），停一下，再慢一点收回来。 */
const punchK = (u) => smooth(u / 0.3) * (1 - smooth((u - 0.45) / 0.45));
/** 拳击架势：bounce 脚下蹦跶，dip 往下蹲（躲闪），shift 重心往左(+)右(-)挪，twist 拧腰（正 = 朝左转，右肩往前），lean 往前探身。 */
function boxStance(p, t, { bounce = 1, dip = 0, shift = 0, twist = 0, lean = 0 } = {}) {
  const b = Math.abs(Math.sin(t * TAU * 0.85)) * bounce;
  p.rate = 20;
  p.hipsY = 0.402 + b * 0.022 - dip * 0.065;
  p.hipsX = shift * 0.045; p.hipsZ = lean * 0.04;
  p.hips = [0, -0.16 + twist * 0.45, -shift * 0.07];
  p.legL = [-0.2 - dip * 0.3, 0, 0.12 + Math.max(0, shift) * 0.05]; p.legR = [0.16 - dip * 0.12, 0, -0.12 + Math.min(0, shift) * 0.05];
  p.shinL = [0.12 + dip * 0.6 + b * 0.25, 0, 0]; p.shinR = [0.2 + dip * 0.5 + b * 0.15, 0, 0];
  p.spine = [0.08 + lean * 0.18 + dip * 0.12, -0.12 + twist, -shift * 0.12];
  p.head = [0.04 - lean * 0.08 + dip * 0.04, 0.26 - twist * 0.7, shift * 0.08]; // 腰怎么拧，眼睛都盯着前面
  p.skirt = [-dip * 0.12, 0, -shift * 0.06];
  p.tail0 = [-0.9, -0.2, 0];
  p.wagAmp = 0.22; p.wagFreq = 2.2;
  p.armL = [-1.3, 0, 0.1]; p.armR = [-1.3, 0, -0.1]; p.foreL = [-1.4, 0, -0.3]; p.foreR = [-1.4, 0, 0.3];
  p.ikL = FIST_L; p.ikR = FIST_R; p.pole = [0.35, -1, 0.1]; // 两只拳头护在下巴前，胳膊肘往下夹
}
const BOX_MOVES = {
  guard(p, u, t) { boxStance(p, t); },
  // 刺拳：左拳直直地打出去，左肩往前送
  jab(p, u, t) {
    const k = punchK(u);
    boxStance(p, t, { twist: -0.15 * k, lean: 0.55 * k, bounce: 1 - k });
    p.ikL = mix3(FIST_L, [0.05, 0.86, 0.52], k); p.pole = [0.25, -1, 0];
  },
  // 直拳：右拳打出去，拧腰把右肩送到前面
  cross(p, u, t) {
    const k = punchK(u);
    boxStance(p, t, { twist: 0.5 * k, lean: 0.7 * k, shift: 0.45 * k, bounce: 1 - k });
    p.ikR = mix3(FIST_R, [-0.02, 0.85, 0.52], k); p.pole = [0.25, -1, 0];
  },
  // 左摆拳：先往左蓄一下，胳膊肘抬平，拳头从左边横着扫到正前方，腰往右拧
  hook(p, u, t) {
    const wind = smooth(u / 0.2) * (1 - smooth((u - 0.2) / 0.12)), k = smooth((u - 0.2) / 0.16) * (1 - smooth((u - 0.55) / 0.4));
    boxStance(p, t, { twist: 0.15 * wind - 0.42 * k, lean: 0.2 * k, shift: -0.3 * k, bounce: 0.3 });
    p.ikL = mix3(mix3(FIST_L, [0.27, 0.9, 0.16], wind), [-0.01, 0.92, 0.3], k); p.pole = [1, 0.7, -0.1];
  },
  // 右上勾拳：先往右下一沉，再从下往上掏
  upper(p, u, t) {
    const sink = smooth(u / 0.25) * (1 - smooth((u - 0.25) / 0.15)), k = smooth((u - 0.25) / 0.17) * (1 - smooth((u - 0.6) / 0.38));
    boxStance(p, t, { dip: 0.7 * sink, shift: -0.6 * sink + 0.3 * k, twist: 0.32 * k, lean: 0.1 * sink - 0.15 * k, bounce: 0.2 });
    p.hipsY += k * 0.015;
    p.ikR = mix3(mix3(FIST_R, [-0.11, 0.66, 0.22], sink), [-0.04, 1.03, 0.28], k); p.pole = [0.3, -1, 0.5];
    p.head[0] -= k * 0.08;
  },
  // 下潜躲闪：护着脸，从右往左画个「U」蹲过去
  weave(p, u, t) {
    const d = Math.sin(Math.PI * smooth(u));
    boxStance(p, t, { dip: d, shift: -Math.cos(Math.PI * smooth(u)), lean: d * 0.3, bounce: 0 });
  },
  // 亮相（视频开头那下）：左胳膊朝左前方直直地打出去，右拳收在太阳穴边，头扭过去盯着拳头
  side(p, u, t) {
    boxStance(p, t, { bounce: 0, shift: 0.5 });
    p.hips[1] = 0.05; p.spine[1] = 0.05; p.spine[2] -= 0.08; p.head = [0.02, 0.45, -0.04];
    p.legL = [-0.05, 0, 0.3]; p.legR = [0.04, 0, -0.25]; p.shinL = [0.25, 0, 0]; p.shinR = [0.12, 0, 0];
    p.ikL = [0.75, 0.86, 0.3]; p.ikR = [-0.1, 0.98, 0.22]; p.pole = [0.2, -1, -0.2];
  },
  // 打累了喘口气：脚并拢站着，两只手垂在身前，肩膀一起一伏
  rest(p, u, t) {
    BASE.stand(p, t);
    const br = Math.sin(t * 4.2);
    p.spine[0] += 0.08 + br * 0.03; p.head[0] += 0.1 - br * 0.03; p.hipsY += br * 0.003;
    p.ikL = [0.07, 0.6, 0.24]; p.ikR = [-0.07, 0.6, 0.24]; p.pole = [0.6, -0.8, -0.2];
    p.wagAmp = 0.1;
  },
};

// ---------------- 第二支舞（照着主人给的那段视频编的：叉腰扭胯、转个身、张开手臂左右晃） ----------------
// 节拍：左右各一拍，一拍约 0.62 秒
const BEAT = Math.PI / 0.62;
const DANCE_B = {
  // 叉腰扭胯：两手叉在腰上，重心一拍左一拍右，另一条腿的膝盖跟着一弯，头往重心那边歪
  3(p, t, a) {
    const s = Math.sin(t * BEAT), b = Math.abs(Math.cos(t * BEAT)), lean = a.params.lean ?? 0;
    p.rate = 14;
    p.hipsX = s * 0.035; p.hipsY = 0.414 - b * 0.012;
    p.hips = [0, s * 0.12, -s * 0.09];
    p.spine = [0.03, -s * 0.1, s * 0.08 + lean * 0.16]; p.head = [0.02, s * 0.14, -s * 0.16 + lean * 0.12];
    p.legL = [-Math.max(0, -s) * 0.22, 0, 0.07 + Math.max(0, s) * 0.06]; p.legR = [-Math.max(0, s) * 0.22, 0, -0.07 - Math.max(0, -s) * 0.06];
    p.shinL = [Math.max(0, -s) * 0.42, 0, 0]; p.shinR = [Math.max(0, s) * 0.42, 0, 0];
    p.armL = [0.1, 0, 0.6]; p.armR = [0.1, 0, -0.6]; p.foreL = [-1.2, 0, 0]; p.foreR = [-1.2, 0, 0];
    p.ikL = [0.255, 0.585, 0.06]; p.ikR = [-0.255, 0.585, 0.06]; p.pole = [1, 0.15, -0.35];
    p.skirt = [0, 0, -s * 0.09];
  },
  // 张开手臂左右晃：两只胳膊往两边张开、拳头朝上，身子像小飞机一样一拍往左倾、一拍往右倾，翘起另一边的脚
  4(p, t) {
    const s = Math.sin(t * BEAT), b = Math.abs(Math.cos(t * BEAT));
    p.rate = 14;
    p.hipsX = s * 0.03; p.hipsY = 0.412 + (1 - b) * 0.015;
    p.hips = [0, 0, -s * 0.12];
    p.spine = [0.0, s * 0.06, s * 0.25]; p.head = [-0.04, -s * 0.08, s * 0.14];
    // 胳膊往两边、稍微往前张开（正侧面张开会埋进两边的长发里，看不见）
    p.armL = [-0.85 - s * 0.15, 0, 1.0 + s * 0.15]; p.armR = [-0.85 + s * 0.15, 0, -1.0 + s * 0.15];
    p.foreL = [-0.95, 0, 0.3]; p.foreR = [-0.95, 0, -0.3];
    p.legL = [-Math.max(0, -s) * 0.28, 0, 0.06 + Math.max(0, -s) * 0.18]; p.legR = [-Math.max(0, s) * 0.28, 0, -0.06 - Math.max(0, s) * 0.18];
    p.shinL = [Math.max(0, -s) * 0.75, 0, 0]; p.shinR = [Math.max(0, s) * 0.75, 0, 0];
    p.skirt = [0, 0, -s * 0.1];
  },
  // 起势：右手往右边一指，身子跟着一歪，左手叉腰
  5(p, t) {
    const s = Math.sin(t * BEAT * 0.5);
    p.rate = 10;
    p.hipsX = -0.03; p.hipsY = 0.41 + Math.abs(s) * 0.008;
    p.hips = [0, -0.15, 0.08];
    p.spine = [0.02, -0.18, -0.16]; p.head = [0, -0.3, -0.14 + s * 0.05];
    p.armR = [-1.3, 0, -0.85]; p.foreR = [-0.1, 0, 0];
    p.armL = [0.1, 0, 0.6]; p.foreL = [-1.2, 0, 0]; p.ikL = [0.255, 0.585, 0.06]; p.pole = [1, 0.15, -0.35];
    p.legL = [-0.1, 0, 0.1]; p.legR = [0.05, 0, -0.16]; p.shinL = [0.3, 0, 0];
    p.skirt = [0, 0, 0.08];
  },
};

// ---------------- 练枪的招式 ----------------
// 都按「右手在后、枪尖朝她左手边」来写：她面朝镜头时，枪横在身前、指向画面右边，头扭过去盯着枪尖。
// params.mirror 时整个左右镜像（换左手在后、枪尖朝右）。
// 每个招式写出两脚怎么站、身子怎么拧，再填 s：
//   R 后手在哪（胸口坐标）  dir 枪朝哪（胸口坐标）  gap 前手握在枪身上离后手多远（模型单位，null = 前手不握）
//   grip 后手离枪尾多远（米）  ground 枪尾杵在地上  L 前手不握枪时放在哪
// 她手臂很短（肩到手心约 0.36），两只手都只能在胸前一小块地方，所以「刺」主要靠弓步送胯、枪从前手里滑出去。
const GUARD = { R: [-0.11, 0.62, 0.2], dir: [0.974, 0.078, 0.214], gap: 0.24, grip: 0.14 };
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** 侧身站桩：low 往下蹲（0~1），lunge 弓步（重心送到左腿、身子往枪尖那边探，0~1），look 头往枪尖那边扭多少，rise 踮起来一点。 */
function stance(p, t, { low = 0, lunge = 0, look = 0.5, rise = 0 } = {}) {
  const b = Math.sin(t * 1.8);
  p.rate = 16;
  p.hipsY = 0.395 - low * 0.07 - lunge * 0.025 + rise * 0.025 + b * 0.003;
  p.hipsX = lunge * 0.07 - 0.01;
  p.hips = [0, 0.1, -lunge * 0.05];
  p.legL = [-0.06 - low * 0.35 - lunge * 0.22, 0, 0.27 + low * 0.08 - lunge * 0.04];
  p.legR = [0.04, 0, -0.25 - low * 0.16 - lunge * 0.12];
  p.shinL = [0.16 + low * 0.7 + lunge * 0.45, 0, 0];
  p.shinR = [0.1 + low * 0.28, 0, 0];
  p.spine = [0.05 + low * 0.08 + lunge * 0.06, 0.1, -0.04 - lunge * 0.12];
  p.head = [0.03 - lunge * 0.04, look, 0.04];
  p.skirt = [-low * 0.15, 0, -lunge * 0.06];
  p.tail0 = [-0.95, -0.25, 0];
  p.wagAmp = 0.08; p.wagFreq = 1.6;
  p.armL = [-0.6, 0, 0.3]; p.armR = [-0.5, 0, -0.3]; p.foreL = [-0.6, 0, 0]; p.foreR = [-0.7, 0, 0];
}

/** 弓步扎枪的一下：u 0~0.28 往回一收（蓄力），0.28~0.42 扎出去，停一下，0.68 以后收回来。返回「扎出去」的程度。 */
function thrust(p, t, s, u, low = 0) {
  const cock = smooth(u / 0.28) * (1 - smooth((u - 0.28) / 0.1));
  const out = smooth((u - 0.28) / 0.14) * (1 - smooth((u - 0.68) / 0.32));
  stance(p, t, { low, lunge: out, look: 0.5 + out * 0.08 });
  p.spine[2] += cock * 0.05; p.hipsX -= cock * 0.025;
  s.R = [s.R[0] - cock * 0.05 + out * 0.12, s.R[1] - low * 0.02, s.R[2] - cock * 0.02 + out * 0.03];
  s.gap -= out * 0.12; // 后手往前手那儿推，枪从前手里滑出去
  s.grip += cock * 0.06 - out * 0.11;
  // 弓步时上身往枪尖那边探，枪跟着胸口一歪枪尖就往下栽了：抬回来一点，让枪还是平着扎出去（低扎就扎得低一点）
  s.dir = nrm([s.dir[0], s.dir[1] + out * 0.17 - low * 0.08, s.dir[2]]);
  return out;
}

const SPEAR_MOVES = {
  // 持枪立正：枪立在右手边、枪尾杵地，左手立掌在胸前（开始和收势时）
  ready(p, u, t, s) {
    BASE.stand(p, t);
    p.legL = [0, 0, 0.03]; p.legR = [0, 0, -0.03];
    p.head[1] *= 0.3;
    s.R = [-0.245, 0.6, 0.1]; s.dir = nrm([-0.06, 1, 0.05]); s.gap = null; s.ground = true; s.grip = 0.2;
    s.L = [0.03, 0.74, 0.25];
    p.armL = [-1.1, 0, 0.2]; p.foreL = [-1.2, 0, -0.3];
  },
  // 中平枪：侧身站稳，枪平端在身前，枪尖对着左边
  guard(p, u, t, s) {
    stance(p, t);
    const w = Math.sin(t * 2.1) * 0.012; // 枪尖微微晃
    s.dir = nrm([s.dir[0], s.dir[1] + w, s.dir[2]]);
  },
  thrust(p, u, t, s) { thrust(p, t, s, u); },
  // 下势低扎：蹲得很低，往低处扎
  low(p, u, t, s) { thrust(p, t, s, u, 1); },
  // 拦拿扎：前手不动，后手画圈，枪尖在前面画两个圈，接着扎出去
  circle(p, u, t, s) {
    if (u >= 0.62) { thrust(p, t, s, (u - 0.62) / 0.38); return; }
    stance(p, t, { low: 0.25 });
    const amp = smooth(u / 0.1) * (1 - smooth((u - 0.5) / 0.12)), th = (u / 0.62) * TAU * 2;
    const L0 = [s.R[0] + s.dir[0] * s.gap, s.R[1] + s.dir[1] * s.gap, s.R[2] + s.dir[2] * s.gap];
    s.dir = nrm([s.dir[0], s.dir[1] + Math.cos(th) * 0.2 * amp, s.dir[2] + Math.sin(th) * 0.2 * amp]);
    s.R = [L0[0] - s.dir[0] * s.gap, L0[1] - s.dir[1] * s.gap, L0[2] - s.dir[2] * s.gap];
    p.head[1] += Math.sin(th) * 0.05 * amp;
  },
  // 转身横扫：蹲低一点，枪尖朝前扫（转身本身由大脑让她原地转一圈）
  sweep(p, u, t, s) {
    stance(p, t, { low: 0.45, look: 0.35 });
    p.spine[1] += 0.12; p.head[2] -= 0.06;
    s.dir = nrm([0.86, 0.17, 0.5]); s.R = [-0.09, 0.61, 0.2]; s.gap = 0.22;
  },
  // 劈枪：枪尖往上一挑举起来，再往前下方劈下去（枪尖停在离地一点点的地方）
  chop(p, u, t, s) {
    const up = smooth(u / 0.32) * (1 - smooth((u - 0.34) / 0.12)), down = smooth((u - 0.34) / 0.12) * (1 - smooth((u - 0.74) / 0.26));
    stance(p, t, { rise: up, low: down * 0.35, lunge: down, look: 0.5 - up * 0.1 });
    p.spine[0] -= up * 0.08;
    const d0 = s.dir;
    s.dir = nrm([d0[0] - up * 0.55 + down * 0.0, d0[1] + up * 0.85 - down * 0.24, d0[2] - up * 0.05 + down * 0.12]);
    s.R = [s.R[0] - up * 0.03 + down * 0.06, s.R[1] - up * 0.04, s.R[2] - up * 0.03 + down * 0.02];
    s.gap -= down * 0.05;
  },
  // 挑枪：枪尖往上一崩，再落回来
  flick(p, u, t, s) {
    const k = smooth((u - 0.12) / 0.14) * (1 - smooth((u - 0.38) / 0.4));
    stance(p, t, { rise: k * 0.6, look: 0.5 });
    s.dir = nrm([s.dir[0], s.dir[1] + k * 0.62, s.dir[2]]);
    s.R = [s.R[0], s.R[1] - k * 0.035, s.R[2]];
  },
  // 腾空：两腿收起来，枪端平（跳本身由大脑让她原地蹦一下）
  air(p, u, t, s) {
    stance(p, t, { look: 0.45 });
    p.legL = [-0.55, 0, 0.18]; p.legR = [-0.35, 0, -0.18]; p.shinL = [1.1, 0, 0]; p.shinR = [0.9, 0, 0];
    p.hipsX = 0; p.skirt = [-0.2, 0, 0];
    s.dir = nrm([s.dir[0], s.dir[1] + 0.12, s.dir[2]]);
  },
};

const MIRROR_PAIRS = [['armL', 'armR'], ['foreL', 'foreR'], ['legL', 'legR'], ['shinL', 'shinR'], ['finL', 'finR']];
const MIRROR_MID = ['hips', 'spine', 'head', 'skirt', 'backBow', 'tail0', 'tail1', 'tail2', 'tail3', 'fluke', 'ahoge'];
/** 整个姿势左右镜像（她的左手边是 +X）：左右关节对调，绕竖轴、绕前后轴的转角反过来；手的目标点和枪也一起镜像。 */
function mirrorPose(p, s) {
  for (const [l, r] of MIRROR_PAIRS) { const a = p[l], b = p[r]; p[l] = [b[0], -b[1], -b[2]]; p[r] = [a[0], -a[1], -a[2]]; }
  for (const j of MIRROR_MID) p[j] = [p[j][0], -p[j][1], -p[j][2]];
  p.hipsX = -p.hipsX;
  const mx = (v) => v && [-v[0], v[1], v[2]];
  const ikL = p.ikL; p.ikL = mx(p.ikR); p.ikR = mx(ikL);
  s.R = mx(s.R); s.dir = mx(s.dir); s.L = mx(s.L); s.main = 'L';
}

/** 「枪在手里怎么拿」的平滑状态：每帧往招式给的目标靠，招式之间切换时枪不会一下子跳过去。spear.js 按它把枪摆到手上。 */
function dampHold(cur, want, dt) {
  const rate = want.rate ?? 14;
  if (!cur.on) { cur.R = [...want.R]; cur.dir = [...want.dir]; cur.grip = want.grip; cur.mainK = want.main === 'L' ? 1 : 0; cur.on = true; }
  for (let i = 0; i < 3; i++) { cur.R[i] = damp(cur.R[i], want.R[i], rate, dt); cur.dir[i] = damp(cur.dir[i], want.dir[i], rate, dt); }
  cur.dir = nrm(cur.dir);
  cur.grip = damp(cur.grip, want.grip, rate, dt);
  cur.mainK = damp(cur.mainK, want.main === 'L' ? 1 : 0, 10, dt);
  cur.gap = want.gap; cur.ground = want.ground; cur.L = want.L; cur.main = want.main;
}

// ---------------- 手臂动作（叠在基础姿势上） ----------------
const ARMS = {
  // 两只手捏着手机两侧；打字时右手拇指在屏幕上点
  phone(p, t, a) {
    const tap = a.hand.typing ? Math.sin(t * 17) * 0.012 * (0.5 + 0.5 * wobble(t * 2, 3)) : 0;
    p.armL = [-0.95, 0, -0.25]; p.armR = [-0.95, 0, 0.25];
    p.foreL = [-0.5, 0, -0.3]; p.foreR = [-0.5, 0, 0.3];
    p.ikL = HOLD.phone.L; p.ikR = [HOLD.phone.R[0] + Math.abs(tap) * 1.5, HOLD.phone.R[1] + tap, HOLD.phone.R[2]];
    p.head[0] += 0.26;
  },
  // 敲键盘
  type(p, t) {
    const n = 0.5 + 0.5 * wobble(t * 1.7, 4);
    p.armL = [-0.95, 0, 0.1]; p.armR = [-0.95, 0, -0.1];
    p.foreL = [-0.72 + Math.sin(t * 15) * 0.1 * n, 0, -0.2]; p.foreR = [-0.72 + Math.sin(t * 15 + 2.1) * 0.1 * n, 0, 0.2];
    p.head[0] += 0.05;
  },
  // 两手托着摊开的书
  book(p) {
    p.armL = [-0.62, 0, 0.02]; p.armR = [-0.62, 0, -0.02];
    p.foreL = [-1.05, 0, -0.38]; p.foreR = [-1.05, 0, 0.38];
    p.ikL = HOLD.book.L; p.ikR = HOLD.book.R;
    p.head[0] += 0.34;
  },
  // 托腮：两只手托着脸颊
  chin(p) {
    p.armL = [-1.1, 0, -0.1]; p.armR = [-1.1, 0, 0.1];
    p.foreL = [-1.9, 0, -0.35]; p.foreR = [-1.9, 0, 0.35];
    p.ikL = [0.13, 0.875, 0.2]; p.ikR = [-0.13, 0.875, 0.2]; p.pole = [0.55, -0.75, 0.1];
    p.head[0] += 0.06;
  },
  // 手背在身后
  behind(p) {
    p.armL = [0.5, 0, 0.1]; p.armR = [0.5, 0, -0.1];
    p.foreL = [0.2, 0, -0.9]; p.foreR = [0.2, 0, 0.9];
  },
  // 右手提着水壶；params.pour（0~1）是往前倾着倒水的程度
  water(p, t, a) {
    const k = a.hand.pour;
    p.armR = [-1.25, 0, -0.1]; p.foreR = [-0.35, 0, -0.55];
    p.ikR = [HOLD.can.R[0], HOLD.can.R[1] + k * 0.05, HOLD.can.R[2] + k * 0.03 + Math.sin(t * 2.2) * 0.008 * k];
    p.armL = [0.1, 0, 0.3];
    p.spine[0] += 0.12 * k; p.head[0] += 0.2;
  },
  // 端着碗。hand.spoon：右手是不是拿着勺子；hand.bite（0~1）：勺子从碗里送到嘴边的程度
  eat(p, t, a) {
    const b = a.hand.bite;
    p.armL = [-0.8, 0, -0.08]; p.armR = [-0.8, 0, 0.08];
    p.foreL = [-0.75, 0, -0.42]; p.foreR = [-0.75, 0, 0.42];
    p.ikL = HOLD.bowl.L;
    if (a.hand.spoon) {
      const k = smooth(b), m = mix3(HOLD.spoon.dip, HOLD.spoon.mouth, k);
      m[2] += Math.sin(k * Math.PI) * 0.035; // 勺子从碗里出来先往外绕一下，别蹭着下巴
      p.ikR = m;
      p.head[0] += 0.24 - k * 0.2;
    } else { p.ikR = HOLD.bowl.R; p.head[0] += 0.12; }
  },
  // 自拍：左手把手机举到面前，右手在脸旁边比划一下
  selfie(p, t) {
    p.armL = [-1.3, 0, 0.1]; p.foreL = [-0.4, 0, -0.2]; p.armR = [-1.2, 0, -0.5]; p.foreR = [-1.6, 0, 0.3];
    p.ikL = [0.1, 0.9, 0.31]; p.ikR = [-0.235, 0.93 + Math.sin(t * 6) * 0.012, 0.17];
    p.head[2] += 0.12; p.spine[2] -= 0.05;
  },
  // 两手抓着被头（拖被子、往上拉）
  quilt(p) {
    p.armL = [-0.9, 0, -0.1]; p.armR = [-0.9, 0, 0.1]; p.foreL = [-0.7, 0, -0.3]; p.foreR = [-0.7, 0, 0.3];
    p.ikL = HOLD.quilt.L; p.ikR = HOLD.quilt.R;
  },
  // 双手垫在脑后（躺着）
  pillow(p) {
    p.armL = [-0.9, 0, 0.9]; p.armR = [-0.9, 0, -0.9];
    p.foreL = [-1.6, 0, -0.3]; p.foreR = [-1.6, 0, 0.3];
  },
  // 右手握着枪、枪竖在身边（走路时枪尾离地，站着时杵在地上）。练枪的招式（BASE.spear）自己管手，这里不插手
  spear(p, t, a) {
    if (a.base === 'spear') return;
    p.armR = [-0.35, 0, -0.3]; p.foreR = [-0.6, 0, 0];
    p.spear = { R: [-0.25, 0.585, 0.1], dir: [-0.05, 0.99, 0.1], gap: null, grip: 0.16, ground: a.base === 'stand', L: null, main: 'R', rate: 12 };
  },
};

// ---------------- 一次性小动作（按进度 τ∈[0,1] 叠加） ----------------
const env = (u, a = 0.2, b = 0.25) => smooth(u / a) * smooth((1 - u) / b);
const GESTURES = {
  nod: { dur: 0.9, f(p, u) { p.head[0] += Math.sin(u * TAU * 2) * 0.28 * env(u); } },
  shake: { dur: 1.0, f(p, u) { p.head[1] += Math.sin(u * TAU * 2.5) * 0.42 * env(u); } },
  tilt: { dur: 1.6, f(p, u) { p.head[2] += 0.32 * env(u, 0.25, 0.3); } },
  surprise: { dur: 0.7, f(p, u) { const e = env(u, 0.12, 0.5); p.hipsY += 0.05 * e; p.armL[2] += 0.7 * e; p.armR[2] -= 0.7 * e; p.spine[0] -= 0.12 * e; p.finL[2] -= 0.5 * e; p.finR[2] += 0.5 * e; } },
  wave: { dur: 2.4, f(p, u, t) { const e = env(u, 0.15, 0.2); p.muteR = Math.max(p.muteR, e); p.armR = [lerp(p.armR[0], -1.75, e), 0, lerp(p.armR[2], -0.6 + Math.sin(t * 10) * 0.28, e)]; p.foreR = [lerp(p.foreR[0], -0.75, e), 0, lerp(p.foreR[2], Math.sin(t * 10 + 0.6) * 0.3, e)]; p.head[2] += 0.12 * e; p.spine[2] -= 0.06 * e; } },
  cheer: { dur: 1.6, f(p, u, t) { const e = env(u, 0.15, 0.25); p.armL = [lerp(p.armL[0], -1.95, e), 0, lerp(p.armL[2], 0.75, e)]; p.armR = [lerp(p.armR[0], -1.95, e), 0, lerp(p.armR[2], -0.75, e)]; p.foreL[0] = lerp(p.foreL[0], -0.5, e); p.foreR[0] = lerp(p.foreR[0], -0.5, e); p.hipsY += Math.abs(Math.sin(t * 9)) * 0.05 * e; p.head[0] -= 0.15 * e; } },
  stretch: { dur: 3.0, f(p, u) { const e = env(u, 0.3, 0.3); p.armL = [lerp(p.armL[0], -2.1, e), 0, lerp(p.armL[2], 0.65, e)]; p.armR = [lerp(p.armR[0], -2.1, e), 0, lerp(p.armR[2], -0.65, e)]; p.foreL[0] = lerp(p.foreL[0], -0.35, e); p.foreR[0] = lerp(p.foreR[0], -0.35, e); p.spine[0] -= 0.22 * e; p.head[0] -= 0.25 * e; p.hipsY += 0.03 * e; } },
  yawn: { dur: 2.6, f(p, u) { const e = env(u, 0.25, 0.3); p.muteR = Math.max(p.muteR, e); p.head[0] -= 0.28 * e; p.armR = [lerp(p.armR[0], -1.5, e), 0, lerp(p.armR[2], 0.25, e)]; p.foreR = [lerp(p.foreR[0], -1.9, e), 0, lerp(p.foreR[2], 0.3, e)]; } },
  rubEyes: { dur: 2.2, f(p, u, t) { const e = env(u, 0.2, 0.25), r = Math.sin(t * 11) * 0.08; p.armL = [lerp(p.armL[0], -1.35, e), 0, lerp(p.armL[2], -0.2, e)]; p.armR = [lerp(p.armR[0], -1.35, e), 0, lerp(p.armR[2], 0.2, e)]; p.foreL = [lerp(p.foreL[0], -2.0 + r, e), 0, lerp(p.foreL[2], -0.3, e)]; p.foreR = [lerp(p.foreR[0], -2.0 - r, e), 0, lerp(p.foreR[2], 0.3, e)]; p.head[0] += 0.12 * e; } },
  wiggle: { dur: 1.5, f(p, u, t) { const e = env(u); p.spine[2] += Math.sin(t * 13) * 0.1 * e; p.head[2] -= Math.sin(t * 13) * 0.09 * e; p.finL[2] += Math.sin(t * 22) * 0.35 * e; p.finR[2] += Math.sin(t * 22) * 0.35 * e; p.wagAmp += 0.5 * e; p.wagFreq = lerp(p.wagFreq, 4, e); } },
  shy: { dur: 2.2, f(p, u, t) { const e = env(u, 0.2, 0.3); p.armL = [lerp(p.armL[0], -1.3, e), 0, lerp(p.armL[2], -0.15, e)]; p.armR = [lerp(p.armR[0], -1.3, e), 0, lerp(p.armR[2], 0.15, e)]; p.foreL = [lerp(p.foreL[0], -1.95, e), 0, lerp(p.foreL[2], -0.5, e)]; p.foreR = [lerp(p.foreR[0], -1.95, e), 0, lerp(p.foreR[2], 0.5, e)]; p.spine[1] += Math.sin(t * 6) * 0.12 * e; p.head[0] += 0.15 * e; } },
  kick: { dur: 0.7, f(p, u) { const back = smooth(u / 0.35) * (1 - smooth((u - 0.35) / 0.12)), fwd = smooth((u - 0.38) / 0.12) * (1 - smooth((u - 0.6) / 0.4)); p.legR[0] += back * 0.6 - fwd * 1.25; p.shinR[0] += back * 0.7; p.spine[0] -= fwd * 0.12; p.armL[0] -= fwd * 0.5; p.armR[0] += fwd * 0.4; } },
  reach: { dur: 1.4, f(p, u) { const e = env(u, 0.3, 0.3); p.muteR = Math.max(p.muteR, e); p.armR = [lerp(p.armR[0], -1.8, e), 0, lerp(p.armR[2], -0.3, e)]; p.foreR[0] = lerp(p.foreR[0], -0.15, e); p.spine[0] += 0.08 * e; p.hipsY += 0.02 * e; } },
  swipe: { dur: 0.5, f(p, u) { const e = env(u, 0.3, 0.4); p.armR[0] -= 0.35 * e; p.foreR[0] -= 0.3 * e; if (p.ikR) p.ikR = [p.ikR[0] + 0.025 * e, p.ikR[1] + 0.04 * e, p.ikR[2] + 0.015 * e]; } },
  flap: { dur: 1.0, f(p, u, t) { const e = env(u); p.finL[2] += Math.sin(t * 24) * 0.4 * e; p.finR[2] += Math.sin(t * 24) * 0.4 * e; } },
  bounce: { dur: 0.9, f(p, u, t) { const e = env(u); p.hipsY += Math.abs(Math.sin(t * 10)) * 0.035 * e; p.wagAmp += 0.4 * e; } },
  flipPage: { dur: 0.7, f(p, u) { const e = env(u, 0.3, 0.3); p.armR[0] -= 0.12 * e; p.foreR[2] -= 0.35 * e; if (p.ikR) p.ikR = [p.ikR[0] + 0.1 * e, p.ikR[1] + 0.05 * e, p.ikR[2] + 0.02 * e]; } },
  lookAround: { dur: 3.2, f(p, u) { p.head[1] += Math.sin(u * TAU) * 0.7 * env(u, 0.15, 0.15); } },
  airJump: { dur: 0.75, f(p, u) { const e = env(u, 0.2, 0.3); p.armL = [lerp(p.armL[0], -1.85, e), 0, lerp(p.armL[2], 0.85, e)]; p.armR = [lerp(p.armR[0], -1.85, e), 0, lerp(p.armR[2], -0.85, e)]; p.legL[0] -= 0.3 * e; p.legR[0] -= 0.3 * e; p.shinL[0] += 0.8 * e; p.shinR[0] += 0.8 * e; } },
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3(), _pole = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qf = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Animator {
  /** @param body 身体上的点（body.js），手臂够东西时用它换算坐标 */
  constructor(char, body) {
    this.c = char; this.J = char.J; this.body = body;
    this.ik = { L: { w: 0, p: new THREE.Vector3(), world: null, on: false }, R: { w: 0, p: new THREE.Vector3(), world: null, on: false } };
    this.lean = 0; this.leanCur = 0; // 弯腰去够东西：上身往前倾多少（弧度），由大脑设置
    /** 手上的状态（换基础姿势时不会被冲掉）：typing 在手机上打字；spoon 右手拿着勺子；bite 勺子送到嘴边的程度；pour 水壶倾倒的程度。 */
    this.hand = { typing: false, spoon: false, bite: 0, pour: 0 };
    /** 手里的枪怎么拿（平滑过的）：R 后手（胸口坐标）、dir 枪的朝向、grip 后手离枪尾多远（米）、ground 枪尾杵地、mainK 后手是右手(0)还是左手(1)。spear.js 读它。 */
    this.spear = { on: false, R: [-0.25, 0.585, 0.1], dir: [0, 1, 0], grip: 0.16, gap: null, ground: false, L: null, main: 'R', mainK: 0 };
    this.tweak = null; // 调试用：(p, t) => void，在姿势算完之后临时改它
    this.t = rand(0, 100);
    this.base = 'stand'; this.arms = 'auto'; this.params = {};
    this.cur = newPose();
    this.gestures = [];
    this.walkPhase = 0; this.speedK = 0;
    this.lookTarget = null; this.lookW = 0; this.lookYaw = 0; this.lookPitch = 0;
    this.gazeT = 0; this.gaze = { x: 0, y: 0 };
    this.squash = 0; this.squashV = 0;
    this.tailLag = 0; this.prevHead = new THREE.Vector3(); this.headVel = new THREE.Vector3(); this.headAcc = new THREE.Vector3(); this.hasPrev = false;
    this.ahogeA = 0; this.ahogeV = 0;
    this.finMood = 0;
    this.#apply(this.cur);
  }

  /** 换基础姿势。params 会整体替换（比如 walk 的 style、sit 的 kick）。 */
  setBase(name, params = {}) { if (!BASE[name]) throw new Error('没有这个姿势: ' + name); this.base = name; this.params = params; }
  setArms(name) { if (name !== 'auto' && !ARMS[name]) throw new Error('没有这个手臂动作: ' + name); this.arms = name; }
  /** 播一个一次性小动作，返回它的时长（秒）。 */
  gesture(name, scale = 1) {
    const g = GESTURES[name];
    if (!g) throw new Error('没有这个小动作: ' + name);
    const dur = g.dur * scale;
    this.gestures.push({ g, t: 0, dur });
    return dur;
  }
  /** 让她看向世界坐标里的某一点（传 null 就随便看）。 */
  lookAt(target) { this.lookTarget = target; }
  /**
   * 让一只手去够世界坐标里的一点（传 null 放开）。够不着时手臂伸直指向它。
   * @param side 'L' | 'R'
   * @param target THREE.Vector3（之后改它的值，手会跟着动）或 null
   */
  reach(side, target) { this.ik[side].world = target; }
  /** 挤压/拉伸一下（起跳、落地时用）。正数压扁。 */
  bump(v) { this.squashV += v; }

  update(dt, motion) {
    this.t += dt;
    const t = this.t;
    const p = newPose();
    BASE[this.base](p, t, this);
    if (this.arms !== 'auto') ARMS[this.arms](p, t, this);
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const ge = this.gestures[i];
      ge.t += dt;
      if (ge.t >= ge.dur) { this.gestures.splice(i, 1); continue; }
      ge.g.f(p, ge.t / ge.dur, t);
    }
    // 拿着枪：后手伸到招式给的位置，前手握在枪身上（离后手 gap），或者放在招式指定的地方
    if (p.spear) {
      const s = this.spear;
      dampHold(s, p.spear, dt);
      const main = s.main === 'L' ? 'L' : 'R', off = main === 'R' ? 'L' : 'R';
      p['ik' + main] = s.R;
      if (s.gap != null) p['ik' + off] = [s.R[0] + s.dir[0] * s.gap, s.R[1] + s.dir[1] * s.gap, s.R[2] + s.dir[2] * s.gap];
      else if (s.L) p['ik' + off] = s.L;
    } else this.spear.on = false;
    this.leanCur = damp(this.leanCur, this.lean, 5, dt);
    p.spine[0] += this.leanCur; p.head[0] -= this.leanCur * 0.35;
    this.tweak?.(p, t);
    // 鱼鳍：心情好就竖起来一点，偶尔自己抖一下
    const twitch = Math.max(0, wobble(t * 0.9, 20) - 0.72) * 2.2;
    p.finL[2] += -this.finMood * 0.25 + twitch * Math.sin(t * 30) * 0.3; p.finR[2] += this.finMood * 0.25 + twitch * Math.sin(t * 30) * 0.3;

    // 视线：头先转，转不过去的部分交给眼珠
    let gx = 0, gy = 0;
    if (this.lookTarget) {
      this.J.spine.updateWorldMatrix(true, false);
      _v.copy(this.lookTarget); this.J.spine.worldToLocal(_v);
      _v.y -= 0.76; _v.z -= 0.02;
      const yaw = Math.atan2(_v.x, _v.z), pitch = -Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      const cy = clamp(yaw, -1.15, 1.15), cp = clamp(pitch, -0.6, 0.7);
      this.lookYaw = damp(this.lookYaw, cy * 0.85, 7, dt); this.lookPitch = damp(this.lookPitch, cp * 0.8, 7, dt);
      this.lookW = damp(this.lookW, 1, 6, dt);
      gx = clamp((yaw - this.lookYaw) / 0.5, -1, 1); gy = clamp((pitch - this.lookPitch) / 0.4, -1, 1);
    } else {
      this.lookW = damp(this.lookW, 0, 4, dt);
      this.gazeT -= dt;
      if (this.gazeT <= 0) { this.gazeT = rand(0.8, 3.5); this.gaze = Math.random() < 0.45 ? { x: 0, y: 0 } : { x: rand(-0.7, 0.7), y: rand(-0.4, 0.4) }; }
      gx = this.gaze.x; gy = this.gaze.y;
    }
    const w = this.lookW;
    p.head[0] = lerp(p.head[0], p.head[0] * 0.3 + this.lookPitch, w);
    p.head[1] = lerp(p.head[1], p.head[1] * 0.3 + this.lookYaw, w);
    this.c.face.look(gx, gy);

    // 平滑过渡到目标姿势
    const cur = this.cur, rate = p.rate;
    for (const j of JOINTS) { const a = cur[j], b = p[j]; a[0] = damp(a[0], b[0], rate, dt); a[1] = damp(a[1], b[1], rate, dt); a[2] = damp(a[2], b[2], rate, dt); }
    cur.hipsY = damp(cur.hipsY, p.hipsY, rate, dt); cur.hipsZ = damp(cur.hipsZ, p.hipsZ, rate, dt); cur.hipsX = damp(cur.hipsX, p.hipsX, rate, dt);
    cur.skirtSquash = damp(cur.skirtSquash, p.skirtSquash, rate, dt);
    cur.wagAmp = damp(cur.wagAmp, p.wagAmp, 5, dt); cur.wagFreq = damp(cur.wagFreq, p.wagFreq, 5, dt);
    cur.hairFollow = damp(cur.hairFollow, p.hairFollow, 4, dt);
    cur.headFree = damp(cur.headFree, p.headFree, 6, dt);
    this.#apply(cur);
    this.#arms(p, dt);
    this.#secondary(dt, motion ?? {});
  }

  /** 手有目标点时，解出肩和肘该怎么转，让手心正好落在目标点上（够不着就伸直）。 */
  #arms(p, dt) {
    const body = this.body, B = body.bind, J = this.J, rq = body.rest.quat, ri = body.restInv;
    let synced = false;
    for (const s of ['L', 'R']) {
      const ik = this.ik[s], sg = s === 'L' ? 1 : -1;
      let has = false;
      if (ik.world) {
        if (!synced) { body.sync(); synced = true; }
        body.toBind('spine', ik.world, _t); has = true;
      } else if (p['ik' + s]) { _t.fromArray(p['ik' + s]); has = true; }
      ik.w = damp(ik.w, has ? 1 - p['mute' + s] : 0, 10, dt);
      if (has) { if (ik.on) ik.p.lerp(_t, 1 - Math.exp(-dt * 16)); else ik.p.copy(_t); ik.on = true; }
      if (ik.w < 0.003) { if (!has) ik.on = false; continue; }
      const sh = B['arm' + s], el = B['fore' + s], ha = B['hand' + s];
      _u.subVectors(el, sh); const a = _u.length(); _u.divideScalar(a);
      _f.subVectors(ha, el); const b = _f.length(); _f.divideScalar(b);
      _d.subVectors(ik.p, sh); const dist = _d.length();
      if (dist < 1e-4) continue;
      _d.divideScalar(dist);
      const d = clamp(dist, Math.abs(a - b) + 0.01, a + b - 0.003);
      const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      if (p.pole) _pole.set(sg * p.pole[0], p.pole[1], p.pole[2]); else _pole.set(sg * 0.85, -0.5, -0.3);
      _pole.addScaledVector(_d, -_pole.dot(_d)).normalize();
      _e.copy(_d).multiplyScalar(cosA).addScaledVector(_pole, sinA); // 上臂的方向
      _qa.setFromUnitVectors(_u, _e);
      _h.copy(_d).multiplyScalar(d).addScaledVector(_e, -a).normalize(); // 小臂的方向
      _v.copy(_f).applyQuaternion(_qa);
      _qf.setFromUnitVectors(_v, _h).multiply(_qa);
      // 换回内置骨架的关节转角
      _q.copy(ri.spine).multiply(_qa).multiply(rq['arm' + s]);
      _q2.copy(_q).invert().multiply(ri.spine).multiply(_qf).multiply(rq['fore' + s]);
      J['arm' + s].quaternion.slerp(_q, ik.w); J['fore' + s].quaternion.slerp(_q2, ik.w);
    }
  }

  #apply(p) {
    const J = this.J;
    for (const j of JOINTS) { const r = p[j]; J[j].rotation.set(r[0], r[1], r[2]); }
    J.hips.position.x = p.hipsX; J.hips.position.y = p.hipsY; J.hips.position.z = p.hipsZ;
    J.skirt.scale.y = p.skirtSquash;
    this.c.headFree = p.headFree;
  }

  #secondary(dt, motion) {
    const J = this.J, t = this.t, cur = this.cur;
    // 挤压拉伸（弹簧）
    this.squashV += (-this.squash * 120 - this.squashV * 12) * dt;
    this.squash = clamp(this.squash + this.squashV * dt, -0.35, 0.35);
    const sq = this.squash;
    this.c.model.scale.set(SCALE * (1 + sq * 0.6), SCALE * (1 - sq), SCALE * (1 + sq * 0.6));

    // 尾巴：摇摆 + 转身时被甩出去的滞后
    this.wagPhase = (this.wagPhase ?? 0) + dt * cur.wagFreq * TAU * 0.5;
    this.tailLag = damp(this.tailLag, clamp(-(motion.yawRate ?? 0) * 0.16, -0.8, 0.8), 5, dt);
    for (let i = 0; i < 4; i++) {
      const jt = J['tail' + i];
      jt.rotation.y += Math.sin(this.wagPhase - i * 0.75) * cur.wagAmp * (0.6 + i * 0.25) + this.tailLag * (0.5 + i * 0.3);
    }
    J.fluke.rotation.z += Math.sin(this.wagPhase - 3.2) * cur.wagAmp * 0.5;

    // 头的速度/加速度（给头发、呆毛用）
    J.head.updateWorldMatrix(true, false);
    const hw = _v.setFromMatrixPosition(J.head.matrixWorld);
    if (this.hasPrev && dt > 0) {
      _v2.copy(hw).sub(this.prevHead).divideScalar(dt);
      this.headAcc.copy(_v2).sub(this.headVel).divideScalar(dt).clampLength(0, 30);
      this.headVel.lerp(_v2, 1 - Math.exp(-dt * 20));
    }
    this.prevHead.copy(hw); this.hasPrev = true;
    J.head.getWorldQuaternion(_q); _q2.copy(_q).invert();
    const localDown = _v2.copy(DOWN).applyQuaternion(_q2); // 头的局部坐标里，重力朝哪
    const velL = _v.copy(this.headVel).applyQuaternion(_q2);
    const yawRate = motion.yawRate ?? 0;
    // 让头发大致保持下垂：把「局部的下」转回世界的下（按 hairFollow 打折）
    const ang = Math.acos(clamp(-localDown.y, -1, 1));
    const axis = new THREE.Vector3(0, -1, 0).cross(localDown);
    const hasAxis = axis.lengthSq() > 1e-6;
    if (hasAxis) axis.normalize();
    const surfaceY = motion.surfaceY ?? 0;
    for (const st of this.c.strands) {
      const out = st.out, tan = st.tan;
      // 惯性：头往哪边动，头发往反方向飘；转身时被甩向切线方向
      const targetSwing = clamp(-(velL.x * out.x + velL.z * out.z) * 0.55 + wobble(t * 0.5, st.az) * 0.025, -0.7, 0.7);
      const targetSway = clamp(-(velL.x * tan.x + velL.z * tan.z) * 0.5 - yawRate * 0.07 + wobble(t * 0.43, st.az + 4) * 0.03, -0.7, 0.7);
      const k = 70 * st.stiff, d = 9;
      st.swingV += (k * (targetSwing - st.swing) - d * st.swingV) * dt; st.swing += st.swingV * dt;
      st.swayV += (k * (targetSway - st.sway) - d * st.swayV) * dt; st.sway += st.swayV * dt;
      // 坐下/躺下时发梢不够长的地方：往外摊开，别插进地面
      st.pivot.getWorldPosition(_v2);
      const h = (_v2.y - surfaceY) / SCALE + 0.14;
      const need = h >= st.len ? 0 : Math.min(0.34, Math.acos(clamp(h / st.len, 0.15, 1)));
      st.spread = damp(st.spread ?? 0, need * (st.name === 'lock' ? 0.5 : 1), 6, dt);
      _q.identity();
      if (hasAxis) _q.setFromAxisAngle(axis, clamp(ang, 0, 1.5) * cur.hairFollow);
      _q3.setFromAxisAngle(tan, -(st.swing + st.spread));
      _q.multiply(_q3);
      _q3.setFromAxisAngle(out, st.sway);
      _q.multiply(_q3);
      st.pivot.quaternion.copy(_q);
    }
    // 呆毛：上下弹
    const targetA = clamp(-this.headVel.y * 0.5 - velL.x * 0.4, -0.8, 0.8);
    this.ahogeV += (90 * (targetA - this.ahogeA) - 7 * this.ahogeV) * dt; this.ahogeA += this.ahogeV * dt;
    J.ahoge.rotation.z += this.ahogeA + Math.sin(t * 1.7) * 0.04;
    J.ahoge.rotation.x += clamp(velL.z * 0.4, -0.5, 0.5);
  }
}

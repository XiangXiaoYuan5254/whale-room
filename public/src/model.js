// 外部模型接入：把「图生 3D」生成的 GLB（一整块网格、不带骨骼）换到她身上。
// 做三件事：
//   ① 归一化：缩放到内置角色的身高，脚踩在原点，脸朝 +Z；
//   ② 绑骨：按内置骨架的关节位置给每个顶点算蒙皮权重（头 / 躯干 / 手臂 / 腿 / 尾巴 / 鱼鳍 / 呆毛）；
//   ③ 转写动作：每帧把内置骨架（动画系统驱动的那一套）的姿势换算到蒙皮骨骼上。
// 内置的几何体角色不删，只是隐藏：它继续当「驱动骨架」，手里的道具、点击判定、头顶气泡都还挂在它上面。
// 模型不减面、不压贴图，原样使用。每个模型可以带一个同名的 .rig.json 微调对位参数（见 RIG_DEFAULTS）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SCALARS, restPose } from './animator.js';
import { FaceOverlay } from './faceoverlay.js';

/** 蒙皮骨骼（顺序就是 skinIndex 里的编号）。 */
const BONES = ['hips', 'spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR', 'tail0', 'tail1', 'tail2', 'tail3', 'fluke', 'finL', 'finR', 'ahoge', 'skirt'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

/** 内置角色（三视图姿势、含呆毛）的身高，模型单位。外部模型按这个高度缩放。 */
const BUILTIN_HEIGHT = 1.965;

/**
 * 对位参数的默认值（模型单位：身高约 1.97，脚底 y=0，她的左手边是 +X，脸朝 +Z）。
 * .rig.json 里写同名字段就能覆盖；joints 里可以给任何关节写绝对位置 [x, y, z]。
 */
export const RIG_DEFAULTS = {
  yaw: 0, // 模型脸没朝前时，绕竖轴转多少度
  scale: 1, // 在「按身高对齐」的基础上再缩放
  offset: [0, 0, 0], // 再平移
  height: BUILTIN_HEIGHT,
  joints: {}, // 例：{ "armL": [0.2, 0.8, 0] }
  tail: null, // 尾巴的走向：从根到尖 5~6 个点 [[x,y,z], ...]；不给就不单独绑尾巴
  finTip: [0.46, 0.0, -0.08], // 鱼鳍尖相对鱼鳍根的偏移（左侧；右侧自动镜像）
  neckBand: 0.04, // 头和身体的过渡带宽度
  chinDrop: 0.08, // 脸前方的分界线比后脑勺低多少（下巴盖住领口）
  coreR: [0.3, 0.2], // 脖子以下「身体」的截面半径 [左右, 前后]；这个范围外的算垂下来的头发
  hairFall: 0.6, // 垂下来的头发从脖子往下多长之内还跟着头转（越长拧得越缓）
  headSoft: 0.55, // 头转动超过这个角度（弧度）后，多出来的部分只保留 headOver
  headOver: 0.45,
  shade: [0.7, 0.86, 1], // 卡通着色三档的亮度（暗部 / 过渡 / 亮部）；贴图本身已经画了明暗，暗部别压太黑
  hemY: 0.27, // 裙摆下沿的高度，以下才是露出来的腿
  hemBand: 0.06,
  legR: [0.105, 0.17], // 离腿轴多近算腿（内径全算，外径不算）
  kneeBand: 0.04,
  armR: [0.085, 0.135], // 离手臂轴线多近算手臂
  armReach: 0.15, // 找手臂时，离手臂轴线多远之内的表面才考虑
  armTaper: 0.35, // 这个范围从肩到手收窄多少
  handInnerY: 0.62, handInnerX: 0.2, // 这个高度以下、比这更靠里的是裙子和围裙，不算手
  armCutFrom: 0.22, // 手臂上从这个位置（0 肩 → 1 手）往下，和别处粘连的地方切开
  handFrom: 0.72, // 手臂上从这个位置往下是手（袖口以外）：这一段里裙子颜色的顶点不算手
  tailR: [0.09, 0.16],
  finR: [0.1, 0.17],
  ahogeR: [0.1, 0.22],
  drape: 0.15, // 坐下时裙子前摆额外跟着大腿抬起的程度（主要靠裙子自己的骨骼）
  skirtTop: 0.53, skirtBand: 0.14, // 腰的高度；从腰往下这么长，裙子逐渐完全跟裙子骨骼走
  skirtW: 0.92, // 裙摆跟裙子骨骼的程度
  skirtPad: 0.035, // 比量出来的裙子半径再往外多少之内还算裙子（再外面是头发）
  hairWave: 1, // 发梢自己轻轻飘的幅度（0 = 不飘）
  hairLag: 1, // 走动、转身时发梢被甩出去的幅度
  outline: 0.011, // 描边粗细（模型单位），0 = 不描边
  face: null, // 表情层：{ rect, eyeL, eyeR, mouth, blush }，见 faceoverlay.js；不给就没有眨眼和表情
  faceFront: 0.02, faceSkinBack: 0.05, // 肤色顶点离脸的曲面多近才算「脸上」
  faceBack: 0.1, // 眼睛、嘴范围内不是肤色的顶点可以比曲面凹进去多少（眼窝）
  faceFeatureFront: 0.02, // 眼睛、嘴范围内不是肤色的顶点（眼珠、睫毛），比曲面靠前这么多以内才算；更靠前的是垂下来的刘海
  shading: 'toon', // toon = 卡通分层着色；flat = 只显示贴图本色；pbr = 用模型自带的材质
  nightGlow: 1.7, // 夜里的自发光倍数（越大，她在暗处越清楚）
};

const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const _seg = { d: 0, t: 0 };
/** 点到线段的距离；t 是垂足在线段上的位置（0~1）。结果写在共用的 _seg 里。 */
function segDist(x, y, z, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-12 ? ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (a.x + abx * t), dy = y - (a.y + aby * t), dz = z - (a.z + abz * t);
  _seg.d = Math.sqrt(dx * dx + dy * dy + dz * dz); _seg.t = t;
  return _seg;
}

/** 取每个顶点在底色贴图上的颜色（RGB，0~255）。贴图读不出来就返回 null。 */
function sampleColors(map, geom) {
  const img = map?.image, uv = geom.attributes.uv;
  if (!img || !uv || !img.width) return null;
  try {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data, n = uv.count, out = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const px = Math.min(c.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * c.width)));
      const py = Math.min(c.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * c.height)));
      const o = (py * c.width + px) * 4;
      out[i * 3] = data[o]; out[i * 3 + 1] = data[o + 1]; out[i * 3 + 2] = data[o + 2];
    }
    return out;
  } catch (err) {
    console.warn('[模型] 读不到贴图颜色，手臂和头发就只按位置区分', err);
    return null;
  }
}
/** 这个颜色像不像头发（偏蓝、不深也不白）。深色的袖子、白色的袖口、肤色的手都不算。 */
const isHairColor = (r, g, b) => b > 135 && r < 120 && b - r > 60;

/**
 * 按网格连通性找出两条手臂：从手出发，沿着表面一路连到肩膀的那一片才算手臂。
 * 只按「离手臂轴线多近」来分的话，贴着手的裙子、挨着袖子的头发都会被带走，抬手时扯成一块板。
 * @returns member[i]：0 不是手臂，1 左臂，2 右臂；along[i]：在手臂上的位置（0 肩 → 1 手）
 */
function findArms(geom, arms, rig, col) {
  const P = geom.attributes.position, n = P.count, idx = geom.index?.array;
  const member = new Uint8Array(n), along = new Float32Array(n);
  if (!idx) return null;
  arms.forEach((A, ai) => {
    const cand = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (A.sg * x < 0.05) continue;
      const u = segDist(x, y, z, A.a, A.e), dU = u.d, tU = u.t;
      const f = segDist(x, y, z, A.e, A.h), dF = f.d, tF = f.t;
      const al = dU <= dF ? tU * 0.5 : 0.5 + tF * 0.5;
      if (Math.min(dU, dF) > rig.armReach * (1 - rig.armTaper * al)) continue;
      if (y < rig.handInnerY && A.sg * x < rig.handInnerX) continue; // 手内侧紧挨着的是裙子和围裙
      if (col && isHairColor(col[i * 3], col[i * 3 + 1], col[i * 3 + 2])) continue; // 贴着手臂的头发
      if (col && al > rig.handFrom && isSkirtColor(col[i * 3], col[i * 3 + 1], col[i * 3 + 2])) continue; // 手底下压着的那块裙子：不能跟着手走，不然抬手时裙子上会被带走一块、露出洞
      cand[i] = 1; along[i] = al;
    }
    // 贴图接缝处顶点是拆开的，先按位置焊起来再看连通
    const weld = new Map(), wid = new Int32Array(n).fill(-1), parent = [];
    const idOf = (i) => {
      if (wid[i] >= 0) return wid[i];
      const k = Math.round(P.getX(i) * 2e4) + ',' + Math.round(P.getY(i) * 2e4) + ',' + Math.round(P.getZ(i) * 2e4);
      let v = weld.get(k);
      if (v === undefined) { v = parent.length; weld.set(k, v); parent.push(v); }
      return (wid[i] = v);
    };
    const find = (v) => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      if (!cand[i0] || !cand[i1] || !cand[i2]) continue;
      const r0 = find(idOf(i0)), r1 = find(idOf(i1)); parent[r0] = r1;
      parent[find(idOf(i2))] = find(r1);
    }
    const roots = new Set();
    for (let i = 0; i < n; i++) {
      if (!cand[i] || wid[i] < 0) continue;
      const dx = P.getX(i) - A.h0.x, dy = P.getY(i) - A.h0.y, dz = P.getZ(i) - A.h0.z;
      if (dx * dx + dy * dy + dz * dz < 0.07 * 0.07) roots.add(find(wid[i]));
    }
    for (let i = 0; i < n; i++) if (cand[i] && wid[i] >= 0 && roots.has(find(wid[i]))) member[i] = ai + 1;
  });
  return { member, along };
}

/** 这个颜色像不像裙子（深蓝的底，或者上面金色的花纹）。肤色的手、白色的袖口都不算。 */
const isSkirtColor = (r, g, b) => (b > r + 25 && 0.3 * r + 0.59 * g + 0.11 * b < 110) || (r > 135 && g > 105 && b < g * 0.8);
const isSkinColor = (r, g, b) => r > 190 && g > 150 && b > 125 && r >= b && r - b < 110;

/**
 * 找出「脸的皮肤表面」上的顶点（表情只画在这一层上，垂在脸前面的刘海不受影响）。
 * 做法：用肤色的顶点量出脸这块曲面有多靠前，眼睛、嘴这些不是肤色的地方用周围补齐，然后只留贴着这层曲面的顶点。
 * @returns { skin: 脸的平均肤色（CSS）, eyes: [左眼, 右眼] 周围的肤色 }，找不到脸就返回 null
 */
function buildFaceMask(geom, col, F, rig) {
  const P = geom.attributes.position, N = geom.attributes.normal, n = P.count;
  const [x0, y0, w, h] = F.rect, cx = x0 + w / 2, cy = y0 + h / 2;
  // 用肤色顶点拟合一张二次曲面 z = Q(x, y)（脸是鼓起来的，眼睛、嘴这些不是肤色的地方靠它补出来）。
  // 范围里还有脖子、耳朵这些更靠后的皮肤，所以反复拟合几次，每次把明显落在曲面后面的点剔掉，最后贴住的是最靠前的那层：脸。
  const basis = (x, y) => { const u = x - cx, v = y - cy; return [1, u, v, u * u, u * v, v * v]; };
  const samples = [];
  let cr = 0, cg = 0, cb = 0, cn = 0;
  // 每只眼睛周围一圈皮肤的颜色：闭眼时盖在眼睛上的那块「眼皮」用它，才不会比旁边的脸白一块
  const ring = [F.eyeL, F.eyeR].map((e) => ({ e, r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h || z < 0.05 || N.getZ(i) < 0.35) continue;
    const r = col[i * 3], g = col[i * 3 + 1], b = col[i * 3 + 2];
    if (!isSkinColor(r, g, b)) continue;
    samples.push(x, y, z); cr += r; cg += g; cb += b; cn++;
    for (const k of ring) {
      const d = Math.hypot((x - k.e[0]) / (k.e[2] + 0.07), (y - k.e[1]) / (k.e[3] + 0.065));
      if (d > 1 && d < 1.4) { k.r += r; k.g += g; k.b += b; k.n++; }
    }
  }
  if (cn < 200) return null;
  let K = null;
  const Q = (x, y) => { const f = basis(x, y); return K[0] + K[1] * f[1] + K[2] * f[2] + K[3] * f[3] + K[4] * f[4] + K[5] * f[5]; };
  for (let pass = 0; pass < 6; pass++) {
    const A = Array.from({ length: 6 }, () => new Float64Array(7));
    for (let k = 0; k < samples.length; k += 3) {
      const x = samples[k], y = samples[k + 1], z = samples[k + 2];
      if (K) { const d = z - Q(x, y); if (d < -0.02 || d > 0.04) continue; }
      const f = basis(x, y);
      for (let a = 0; a < 6; a++) { for (let c = 0; c < 6; c++) A[a][c] += f[a] * f[c]; A[a][6] += f[a] * z; }
    }
    for (let c = 0; c < 6; c++) { // 高斯消元
      let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < 6; r++) { if (r === c) continue; const q = A[r][c] / A[c][c]; for (let j = c; j < 7; j++) A[r][j] -= q * A[c][j]; }
    }
    K = A.map((row, i) => row[6] / row[i]);
  }
  const inEll = (x, y, ex, ey, rx, ry) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 < 1;
  const mask = new Float32Array(n), noLine = new Float32Array(n), hist = new Int32Array(24);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) continue;
    const d = z - Q(x, y);
    const feature = inEll(x, y, F.eyeL[0], F.eyeL[1], F.eyeL[2] + 0.04, F.eyeL[3] + 0.04) || inEll(x, y, F.eyeR[0], F.eyeR[1], F.eyeR[2] + 0.04, F.eyeR[3] + 0.04) || inEll(x, y, F.mouth[0], F.mouth[1], F.mouth[2] + 0.045, 0.06);
    const skin = isSkinColor(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
    if (d < rig.faceFeatureFront && d > -rig.faceBack) { // 眼睛周围：越靠近眼睛中心，描边越细，到眼眶处为零
      const eL = Math.hypot((x - F.eyeL[0]) / (F.eyeL[2] + 0.07), (y - F.eyeL[1]) / (F.eyeL[3] + 0.07)), eR = Math.hypot((x - F.eyeR[0]) / (F.eyeR[2] + 0.07), (y - F.eyeR[1]) / (F.eyeR[3] + 0.07));
      noLine[i] = 1 - ss(0.72, 1, Math.min(eL, eR));
    }
    if (feature && !skin) { const k = Math.floor((d + 0.06) / 0.005); if (k >= 0 && k < 24) hist[k]++; }
    if (!feature && N.getZ(i) < 0.05) continue; // 眼睛、嘴的范围内不看朝向：眼窝侧壁是朝旁边的
    if (skin ? d > -rig.faceSkinBack && d < rig.faceFront : feature && d > -rig.faceBack && d < rig.faceFeatureFront) mask[i] = 1;
  }
  geom.setAttribute('faceMask', new THREE.Float32BufferAttribute(mask, 1));
  geom.setAttribute('noLine', new THREE.Float32BufferAttribute(noLine, 1));
  geom.userData.faceFit = { K, cx, cy };
  geom.userData.faceHist = Array.from(hist); // 调参用：眼睛和嘴范围内、非肤色顶点离曲面的距离分布（每格 0.005，从 -0.06 起）
  const skin = `rgb(${Math.round(cr / cn)},${Math.round(cg / cn)},${Math.round(cb / cn)})`;
  return { skin, eyes: ring.map((k) => (k.n > 30 ? `rgb(${Math.round(k.r / k.n)},${Math.round(k.g / k.n)},${Math.round(k.b / k.n)})` : skin)) };
}

/** 给一块网格算蒙皮权重。geom 的顶点已经在模型空间里。bp：各关节的绑定位置。 */
function computeSkin(geom, bp, rig, col = null) {
  const P = geom.attributes.position, n = P.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), dr = new Float32Array(n);
  const NB = BONES.length, w = new Float32Array(NB);
  const scale = (k) => { for (let b = 0; b < NB; b++) w[b] *= k; };
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

  const legs = [['L', 1], ['R', -1]].map(([s, sg]) => ({
    sg, hip: bp['leg' + s], knee: bp['shin' + s], foot: new THREE.Vector3(bp['shin' + s].x, 0, bp['shin' + s].z), th: BI['leg' + s], sh: BI['shin' + s],
  }));
  const arms = [['L', 1], ['R', -1]].map(([s, sg]) => {
    const a = bp['arm' + s], e = bp['fore' + s], h = bp['hand' + s];
    return { sg, a, e, h0: h, h: h.clone().add(h.clone().sub(e).multiplyScalar(0.6)), up: BI['arm' + s], fo: BI['fore' + s] };
  });
  const fins = [['L', 1], ['R', -1]].map(([s, sg]) => ({
    a: bp['fin' + s], b: bp['fin' + s].clone().add(new THREE.Vector3(sg * rig.finTip[0], rig.finTip[1], rig.finTip[2])), bone: BI['fin' + s],
  }));
  const tail = rig.tail?.length >= 2 ? rig.tail.map(V) : null;
  const tailBones = [BI.tail0, BI.tail1, BI.tail2, BI.tail3, BI.fluke];
  const neckY = bp.head.y, ah = bp.ahoge;
  const armInfo = findArms(geom, arms, rig, col);
  // 裙子有多宽：在正前方（那里没有头发挡着）按高度量出最大半径
  const SB = 24, sy0 = rig.hemY - 0.06, sdy = (rig.skirtTop - sy0) / SB, skirtR = new Float32Array(SB);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (z < 0.05 || Math.abs(x) > 0.2 || y < sy0 || y >= rig.skirtTop) continue;
    if (col && isHairColor(col[i * 3], col[i * 3 + 1], col[i * 3 + 2])) continue;
    const k = Math.floor((y - sy0) / sdy), r = Math.hypot(x, z);
    if (r > skirtR[k]) skirtR[k] = r;
  }
  for (let k = SB - 2; k >= 0; k--) if (skirtR[k] < skirtR[k + 1] * 0.9) skirtR[k] = Math.max(skirtR[k], skirtR[k + 1]); // 裙子越往下越宽，补上量漏的
  const hs = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    w.fill(0);
    // 躯干：下半归胯，上半归胸
    const sp = ss(bp.spine.y - 0.04, bp.spine.y + 0.16, y);
    w[BI.hips] = 1 - sp; w[BI.spine] = sp;

    // 腿（只有裙摆以下、靠近腿轴的才算）+ 裙子前摆跟着大腿
    let legMask = 0;
    for (const L of legs) {
      const side = ss(-0.012, 0.012, L.sg * x);
      if (side <= 0) continue;
      const dT = segDist(x, y, z, L.hip, L.knee).d, dS = segDist(x, y, z, L.knee, L.foot).d;
      const m = (1 - ss(rig.legR[0], rig.legR[1], Math.min(dT, dS))) * (1 - ss(rig.hemY, rig.hemY + rig.hemBand, y)) * side;
      if (m > 0) {
        const t = ss(L.knee.y + rig.kneeBand, L.knee.y - rig.kneeBand, y);
        scale(1 - m); w[L.sh] += m * t; w[L.th] += m * (1 - t);
        if (m > legMask) legMask = m;
      }
      if (y > rig.hemY - 0.04) {
        const dm = rig.drape * ss(L.hip.y + 0.06, rig.hemY + 0.02, y) * ss(-0.1, 0.08, z) * side * (1 - m);
        if (dm > 0) { scale(1 - dm); w[L.th] += dm; }
      }
    }

    // 裙子：腰以下、裙子半径以内的，越靠近裙摆越跟裙子骨骼走（坐下时整条裙子前倾、压扁）
    if (y >= sy0 && y < rig.skirtTop && legMask < 1) {
      const hair = col ? isHairColor(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]) : false;
      if (!hair && Math.hypot(x, z) < skirtR[Math.min(SB - 1, Math.floor((y - sy0) / sdy))] + rig.skirtPad) {
        const ws = rig.skirtW * ss(rig.skirtTop, rig.skirtTop - rig.skirtBand, y) * (1 - legMask);
        scale(1 - ws); w[BI.skirt] += ws;
      }
    }

    // 手臂：肩 → 肘 → 手。整条手臂完全跟骨骼走，只有肩头和身体过渡
    if (armInfo) {
      const am = armInfo.member[i];
      if (am) {
        const A = arms[am - 1], al = armInfo.along[i];
        const m = 0.35 + 0.65 * ss(0, 0.2, al), fo = ss(0.42, 0.58, al);
        scale(1 - m); w[A.fo] += m * fo; w[A.up] += m * (1 - fo);
      }
    } else {
      for (const A of arms) { // 没有索引的网格：只能按距离分
        const side = ss(0.05, 0.1, A.sg * x);
        if (side <= 0) continue;
        const u = segDist(x, y, z, A.a, A.e), dU = u.d, tU = u.t;
        const f = segDist(x, y, z, A.e, A.h), dF = f.d, tF = f.t;
        let m = (1 - ss(rig.armR[0], rig.armR[1], Math.min(dU, dF))) * side;
        if (m <= 0) continue;
        const al = dU <= dF ? tU * 0.5 : 0.5 + tF * 0.5;
        m *= 0.35 + 0.65 * ss(0, 0.2, al);
        const fo = ss(0.42, 0.58, al);
        scale(1 - m); w[A.fo] += m * fo; w[A.up] += m * (1 - fo);
      }
    }

    // 尾巴：沿给定的走向分段
    if (tail) {
      let best = Infinity, bk = 0, bt = 0;
      for (let k = 0; k < tail.length - 1; k++) { const s = segDist(x, y, z, tail[k], tail[k + 1]); if (s.d < best) { best = s.d; bk = k; bt = s.t; } }
      let m = 1 - ss(rig.tailR[0], rig.tailR[1], best);
      if (m > 0) {
        if (bk === 0) m *= ss(-0.1, 0.5, bt); // 尾根和身体连着
        const b0 = tailBones[Math.min(bk, tailBones.length - 1)], b1 = tailBones[Math.min(bk + 1, tailBones.length - 1)];
        const t = ss(0.5, 1.0, bt) * 0.5;
        scale(1 - m); w[b0] += m * (1 - t); w[b1] += m * t;
      }
    }

    // 头：脖子分界线以上全算头（脸前方的分界线低一点，让下巴盖住领口）。
    // 分界线以下分两种：贴近身体的（脖子、领口、肩）很快交给身体；外圈的长发则越往下越少跟头走，
    // 这样转头时头发是顺着拧过去的，不会在脖子高度断成两截。
    const cut = neckY - rig.chinDrop * ss(0.08, 0.32, z);
    const dCut = y - cut;
    let mh = 1;
    if (dCut < rig.neckBand) {
      const shell = ss(1, 1.35, Math.sqrt((x / rig.coreR[0]) ** 2 + (z / rig.coreR[1]) ** 2));
      const core = ss(-rig.neckBand, rig.neckBand, dCut);
      const hair = dCut >= 0 ? 1 : 1 - ss(0, rig.hairFall, -dCut);
      mh = (1 - shell) * core + shell * hair;
    }
    if (mh > 0) {
      let extra = 0, eb = -1;
      for (const F of fins) {
        const s = segDist(x, y, z, F.a, F.b);
        const m = (1 - ss(rig.finR[0], rig.finR[1], s.d)) * ss(0.05, 0.4, s.t);
        if (m > extra) { extra = m; eb = F.bone; }
      }
      const hd = Math.hypot(x - ah.x, z - ah.z);
      const ma = (1 - ss(rig.ahogeR[0], rig.ahogeR[1], hd)) * ss(ah.y + 0.03, ah.y + 0.12, y);
      if (ma > extra) { extra = ma; eb = BI.ahoge; }
      scale(1 - mh); w[BI.head] += mh * (1 - extra);
      if (eb >= 0) w[eb] += mh * extra;
    }

    dr[i] = 1 - legMask;
    if (col && isHairColor(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]) && !(armInfo && armInfo.member[i])) {
      hs[i] = ss(neckY - 0.08, neckY - 0.62, y) * ss(0.9, 1.4, Math.sqrt((x / rig.coreR[0]) ** 2 + (z / rig.coreR[1]) ** 2));
    }
    // 取最大的 4 个，归一化
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      let bi = 0, bv = -1;
      for (let b = 0; b < NB; b++) if (w[b] > bv) { bv = w[b]; bi = b; }
      si[i * 4 + k] = bi; sw[i * 4 + k] = bv > 0 ? bv : 0; sum += sw[i * 4 + k]; w[bi] = -1;
    }
    if (sum > 0) for (let k = 0; k < 4; k++) sw[i * 4 + k] /= sum; else { si[i * 4] = BI.hips; sw[i * 4] = 1; }
  }
  if (armInfo) {
    const idx = geom.index.array, { member, along } = armInfo;
    let o = 0, cut = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = member[idx[t]], b = member[idx[t + 1]], c = member[idx[t + 2]];
      if (!(a === b && b === c)) {
        const far = Math.max(a ? along[idx[t]] : 0, b ? along[idx[t + 1]] : 0, c ? along[idx[t + 2]] : 0);
        if (far > rig.armCutFrom) { cut++; continue; }
      }
      idx[o++] = idx[t]; idx[o++] = idx[t + 1]; idx[o++] = idx[t + 2];
    }
    if (cut) { geom.setIndex(new THREE.BufferAttribute(idx.slice(0, o), 1)); }
    geom.userData.armCut = cut;
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geom.setAttribute('drape', new THREE.Float32BufferAttribute(dr, 1));
  geom.setAttribute('hairSway', new THREE.Float32BufferAttribute(hs, 1));
}

// 着色器里加两样：描边的外扩；以及「垂到坐着/躺着的那个面以下的头发和裙摆，摊平在面上往外铺开」。
const FLOOR_CHUNK = /* glsl */ `
  {
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    float under = uFloorY - wp.y;
    if (under > 0.0 && drape > 0.0) {
      vec2 o = wp.xz - uCenter.xz; float l = length(o); o = l > 1e-4 ? o / l : vec2(0.0);
      vec3 tgt = vec3(wp.x + o.x * under * 0.7, uFloorY + 0.006 - under * 0.04, wp.z + o.y * under * 0.7);
      wp.xyz = mix(wp.xyz, tgt, drape);
      transformed = (uInvModel * wp).xyz;
    }
  }
`;
function patchMaterial(mat, uniforms, outline, face = false) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'attribute float drape;\nattribute float hairSway;\nuniform float uFloorY;\nuniform vec3 uCenter;\nuniform mat4 uInvModel;\nuniform float uTime;\nuniform vec3 uSway;\nuniform float uWave;\n'
      + (face ? (outline ? 'attribute float noLine;\n' : 'attribute float faceMask;\nattribute float noLine;\nuniform float uLid;\nuniform vec4 uFaceK0;\nuniform vec4 uFaceK1;\nvarying vec3 vRest;\nvarying float vFaceMask;\n') : '') + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += hairSway * (vec3(sin(uTime * 1.6 + position.y * 5.0) * 0.012, 0.0, cos(uTime * 1.3 + position.x * 4.0) * 0.010) * uWave + uSway * (0.35 + 0.65 * hairSway));\n' + (outline ? `  transformed += normalize(normal) * ${outline.toFixed(4)}${face ? ' * (1.0 - noLine)' : ''};\n` : '') + (face && !outline ? '  vRest = position; vFaceMask = faceMask;\n' : ''))
      .replace('#include <project_vertex>', FLOOR_CHUNK + '\n#include <project_vertex>');
    if (face && !outline) {
      // 闭眼、笑眯眼时：模型的眼窝是凹进去的，受光和脸颊不一样，盖上肤色以后还是会透出一圈明暗，看着像翻白眼。
      // 所以眼皮合上时，把眼睛那一块的朝向换成「脸这张曲面本来的朝向」，受光就和周围的脸一样了。
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  {
    float fu = position.x - uFaceK1.y, fv = position.y - uFaceK1.z;
    vec3 fn = normalize(vec3(-(uFaceK0.x + 2.0 * uFaceK0.z * fu + uFaceK0.w * fv), -(uFaceK0.y + uFaceK0.w * fu + 2.0 * uFaceK1.x * fv), 1.0));
    objectNormal = normalize(mix(objectNormal, fn, clamp(noLine * faceMask * uLid, 0.0, 1.0)));
  }`);
    }
    if (!outline && mat.isMeshToonMaterial) {
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `{
    float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
    outgoingLight += uRim * rim * (0.3 + 0.7 * diffuseColor.rgb);
  }
  #include <opaque_fragment>`);
    }
    if (face && !outline) {
      // 表情层：按「绑定姿势下的正面坐标」取样，只画在脸的皮肤那一层上
      sh.fragmentShader = 'uniform sampler2D uFace;\nuniform vec4 uFaceRect;\nvarying vec3 vRest;\nvarying float vFaceMask;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
  if (vFaceMask > 0.5) {
    vec2 fuv = (vRest.xy - uFaceRect.xy) / uFaceRect.zw;
    if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
      vec4 fo = texture2D(uFace, fuv);
      diffuseColor.rgb = mix(diffuseColor.rgb, fo.rgb, fo.a);
    }
  }`)
        // 夜里的自发光用的是原贴图：不把表情层也盖上去，闭眼时画在贴图上的眼珠会透出来，看着像翻白眼
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (vFaceMask > 0.5) {
    vec2 fuv2 = (vRest.xy - uFaceRect.xy) / uFaceRect.zw;
    if (fuv2.x > 0.0 && fuv2.x < 1.0 && fuv2.y > 0.0 && fuv2.y < 1.0) {
      vec4 fo2 = texture2D(uFace, fuv2);
      totalEmissiveRadiance = mix(totalEmissiveRadiance, emissive * fo2.rgb, fo2.a);
    }
  }`);
    }
  };
  mat.customProgramCacheKey = () => 'whale-skin-' + (outline ? outline.toFixed(4) : 'main') + (face ? '-face' : '');
  return mat;
}

function convertMaterial(src, rig, gm, hasColors) {
  if (rig.shading === 'pbr') { const m = src.clone(); m.userData.glow = new THREE.Color(0xffffff); return m; }
  const map = src.map ?? null;
  const base = { map, color: map || hasColors ? 0xffffff : 0xb9c4e8, vertexColors: hasColors, side: src.side, transparent: src.transparent, alphaTest: src.alphaTest };
  const m = rig.shading === 'flat' ? new THREE.MeshBasicMaterial(base) : new THREE.MeshToonMaterial({ ...base, gradientMap: gm });
  m.userData.glow = map || hasColors ? new THREE.Color(rig.nightGlow, rig.nightGlow, rig.nightGlow) : new THREE.Color(0x6f86d8);
  if (map && m.isMeshToonMaterial) m.emissiveMap = map;
  return m;
}

/**
 * 加载一个 GLB 并换到角色身上。
 * @param char buildCharacter() 的返回值
 * @param info { url, rig? }（/api/model 的返回）
 * @returns 控制器：update(surfaceY) 每帧调用；debug(on) 显示骨骼位置和内置角色的半透明对照；dispose() 换回内置角色。
 */
export async function attachModel(char, info, { debug = false, anisotropy = 1 } = {}) {
  const rig = { ...RIG_DEFAULTS, ...(info.rig ?? {}) };
  const gltf = await new GLTFLoader().loadAsync(info.url);
  gltf.scene.updateMatrixWorld(true);
  const sources = [];
  gltf.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) sources.push(o); });
  if (!sources.length) throw new Error('这个 GLB 里没有网格');

  // ① 归一化：先转正，量包围盒和脚的位置，再缩放、落地
  const yawM = new THREE.Matrix4().makeRotationY(rig.yaw * Math.PI / 180);
  const geoms = sources.map((o) => { const g = o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(yawM, o.matrixWorld)); return g; });
  const box = new THREE.Box3();
  for (const g of geoms) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const h = box.max.y - box.min.y;
  let fx = 0, fz = 0, fn = 0;
  for (const g of geoms) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < box.min.y + h * 0.05) { fx += p.getX(i); fz += p.getZ(i); fn++; }
  }
  if (!fn) { fx = (box.min.x + box.max.x) / 2; fz = (box.min.z + box.max.z) / 2; fn = 1; }
  const s = (rig.height / h) * rig.scale;
  const N = new THREE.Matrix4().makeTranslation(rig.offset[0], rig.offset[1], rig.offset[2] + 0.02)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-fx / fn, -box.min.y, -fz / fn));
  let verts = 0, tris = 0;
  for (const g of geoms) {
    g.applyMatrix4(N);
    if (!g.attributes.normal) g.computeVertexNormals();
    verts += g.attributes.position.count; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }

  // ② 骨骼：位置默认取内置骨架的三视图姿势，.rig.json 可逐个覆盖
  const rest = restPose(char.J);
  const bp = {};
  for (const name of [...BONES, 'handL', 'handR']) bp[name] = rig.joints[name] ? new THREE.Vector3(...rig.joints[name]) : rest.pos[name].clone();
  if (rig.tail?.length >= 5) ['tail0', 'tail1', 'tail2', 'tail3', 'fluke'].forEach((b, k) => bp[b].set(...rig.tail[k]));
  const parentOf = {};
  for (const name of BONES) { const p = char.J[name].parent; parentOf[name] = p && char.J[p.name] === p && p.name in BI ? p.name : null; }
  const skinRoot = new THREE.Group(); skinRoot.name = 'skin';
  const bones = BONES.map((name) => { const b = new THREE.Bone(); b.name = 'skin_' + name; return b; });
  BONES.forEach((name, i) => {
    const p = parentOf[name];
    if (p) { bones[BI[p]].add(bones[i]); bones[i].position.copy(bp[name]).sub(bp[p]); } else { skinRoot.add(bones[i]); bones[i].position.copy(bp[name]); }
  });
  char.model.add(skinRoot);
  skinRoot.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton(bones);

  // ③ 蒙皮网格 + 描边
  const t0 = performance.now();
  const uniforms = { uFloorY: { value: -100 }, uCenter: { value: new THREE.Vector3() }, uInvModel: { value: new THREE.Matrix4() }, uRim: { value: new THREE.Color(0, 0, 0) }, uTime: { value: 0 }, uSway: { value: new THREE.Vector3() }, uWave: { value: rig.hairWave } };
  const gm = new THREE.DataTexture(new Uint8Array([...rig.shade.map((v) => Math.round(v * 255)), 255]), 4, 1, THREE.RedFormat);
  gm.minFilter = gm.magFilter = THREE.NearestFilter; gm.needsUpdate = true;
  const meshes = [], mats = [];
  let overlay = null;
  let outlineMat = null;
  geoms.forEach((g, k) => {
    const srcMat = Array.isArray(sources[k].material) ? sources[k].material[0] : sources[k].material;
    const col = sampleColors(srcMat.map, g);
    if (srcMat.map) { srcMat.map.anisotropy = anisotropy; srcMat.map.needsUpdate = true; } // 斜着看贴图也清楚
    computeSkin(g, bp, rig, col);
    const skinCss = rig.face && col ? buildFaceMask(g, col, rig.face, rig) : null;
    if (skinCss && !overlay) {
      overlay = new FaceOverlay(rig.face, skinCss.skin, skinCss.eyes);
      uniforms.uFace = { value: overlay.texture }; uniforms.uFaceRect = { value: new THREE.Vector4(...rig.face.rect) };
      const { K, cx, cy } = g.userData.faceFit; // 脸的曲面 z = K0 + K1·u + K2·v + K3·u² + K4·uv + K5·v²
      uniforms.uLid = { value: 0 }; uniforms.uFaceK0 = { value: new THREE.Vector4(K[1], K[2], K[3], K[4]) }; uniforms.uFaceK1 = { value: new THREE.Vector4(K[5], cx, cy, 0) };
    }
    const mat = patchMaterial(convertMaterial(srcMat, rig, gm, Boolean(g.attributes.color)), uniforms, 0, Boolean(skinCss));
    mats.push(mat);
    const mesh = new THREE.SkinnedMesh(g, mat);
    mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    mesh.raycast = () => {}; // 点击判定继续用隐藏的内置角色，省得每次点击都遍历上百万个三角形
    skinRoot.add(mesh); mesh.bind(skeleton);
    meshes.push(mesh);
    if (rig.outline > 0) {
      outlineMat ??= patchMaterial(new THREE.MeshBasicMaterial({ color: 0x10152f, side: THREE.BackSide }), uniforms, rig.outline, Boolean(skinCss));
      const o = new THREE.SkinnedMesh(g, outlineMat);
      o.frustumCulled = false; o.raycast = () => {};
      skinRoot.add(o); o.bind(skeleton); meshes.push(o);
    }
  });
  const skinMs = performance.now() - t0;

  // 隐藏内置角色的外观（道具留着），把新材质接进夜间自发光
  const keep = new Set(Object.values(char.props).map((p) => p.group));
  const hidden = [];
  const hide = (o) => {
    if (o === skinRoot || keep.has(o)) return;
    if (o.isMesh && o.visible) { o.visible = false; hidden.push(o); }
    for (const c of o.children) hide(c);
  };
  hide(char.model);
  const glowMats = mats.filter((m) => m.emissive);
  char.mats.push(...glowMats);

  // 每帧：把内置骨架的姿势换算过来
  const cur = {}, delta = {};
  for (const name of BONES) { cur[name] = new THREE.Quaternion(); delta[name] = new THREE.Quaternion(); }
  const inv0 = Object.fromEntries(BONES.map((name) => [name, rest.quat[name].clone().invert()]));
  const _q = new THREE.Quaternion(), _id = new THREE.Quaternion(), hips0 = new THREE.Vector3(0, SCALARS.hipsY, SCALARS.hipsZ);
  const _p = new THREE.Vector3(), prevP = new THREE.Vector3(), swayV = new THREE.Vector3(), swayT = new THREE.Vector3();
  let prevYaw = 0, hasPrev = false;
  let markers = null;

  // 嘴在绑定姿势下的位置（勺子往这儿送）：表情层量出来的脸的曲面上，嘴那一点
  let mouth = null;
  if (rig.face?.mouth) {
    const fit = geoms.map((g) => g.userData.faceFit).find(Boolean);
    if (fit) {
      const u = rig.face.mouth[0] - fit.cx, v = rig.face.mouth[1] - fit.cy, K = fit.K;
      mouth = new THREE.Vector3(rig.face.mouth[0], rig.face.mouth[1], K[0] + K[1] * u + K[2] * v + K[3] * u * u + K[4] * u * v + K[5] * v * v);
    }
  }

  const ctl = {
    info, rig, meshes, bones, skinRoot, get overlay() { return overlay; }, stats: { verts, tris: Math.round(tris), skinMs: Math.round(skinMs), scale: s },
    /** 各关节在绑定姿势下的位置（模型单位），含 handL / handR。 */
    bind: bp,
    /** 嘴在绑定姿势下的位置；模型没有表情层时是 null。 */
    mouth,
    /** 按名字取蒙皮骨骼（hips / spine / head / armL / foreL …）。 */
    bone(name) { return bones[BI[name]]; },
    /** 把内置骨架当前的姿势换算到蒙皮骨骼上（只算骨骼，不动别的）。 */
    syncBones() {
      const J = char.J;
      for (let i = 0; i < BONES.length; i++) {
        const name = BONES[i], p = parentOf[name];
        if (p) cur[name].multiplyQuaternions(cur[p], J[name].quaternion); else cur[name].copy(J[name].quaternion);
        delta[name].multiplyQuaternions(cur[name], inv0[name]);
        if (p) bones[i].quaternion.copy(_q.copy(delta[p]).invert()).multiply(delta[name]); else bones[i].quaternion.copy(delta[name]);
      }
      // 头发是长在模型上的，头转得太猛会把它拧成麻花：超过 headSoft 的部分打折
      // （趴着抬头看东西时姿势会把限度放宽：char.headFree，0~1）
      const hq = bones[BI.head].quaternion, ang = 2 * Math.acos(Math.min(1, Math.abs(hq.w)));
      const soft = rig.headSoft + (1.5 - rig.headSoft) * (char.headFree ?? 0);
      if (ang > soft) hq.slerpQuaternions(_id, _q.copy(hq), (soft + (ang - soft) * rig.headOver) / ang);
      bones[BI.hips].position.copy(bp.hips).add(J.hips.position).sub(hips0);
      bones[BI.skirt].scale.y = J.skirt.scale.y;
    },
    update(surfaceY = 0, dt = 1 / 60) {
      this.syncBones();
      // 发梢的惯性：她往哪边走，发梢往反方向拖；转身时被甩向外侧；再加一点弹性
      uniforms.uTime.value += dt;
      char.root.getWorldPosition(_p);
      const yaw = char.root.rotation.y;
      if (hasPrev && dt > 1e-4) {
        const vx = (_p.x - prevP.x) / dt, vy = (_p.y - prevP.y) / dt, vz = (_p.z - prevP.z) / dt, c = Math.cos(yaw), sn = Math.sin(yaw);
        let dyaw = yaw - prevYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const k = 0.1 * rig.hairLag;
        swayT.set(-(vx * c - vz * sn) * k - (dyaw / dt) * 0.02 * rig.hairLag, -vy * 0.06 * rig.hairLag, -(vx * sn + vz * c) * k).clampLength(0, 0.13);
      }
      prevP.copy(_p); prevYaw = yaw; hasPrev = true;
      const sv = uniforms.uSway.value, h = Math.min(dt, 0.05);
      swayV.x += (70 * (swayT.x - sv.x) - 8 * swayV.x) * h; swayV.y += (70 * (swayT.y - sv.y) - 8 * swayV.y) * h; swayV.z += (70 * (swayT.z - sv.z) - 8 * swayV.z) * h;
      sv.addScaledVector(swayV, h);
      overlay?.update(char.face);
      if (overlay) uniforms.uLid.value += (overlay.lid - uniforms.uLid.value) * Math.min(1, dt * 30);
      uniforms.uFloorY.value = surfaceY;
      char.root.getWorldPosition(uniforms.uCenter.value);
      skinRoot.updateWorldMatrix(true, false);
      uniforms.uInvModel.value.copy(skinRoot.matrixWorld).invert();
    },
    /** 边缘光的颜色和强度（THREE.Color，可以大于 1）。 */
    setRim(r, g, b) { uniforms.uRim.value.setRGB(r, g, b); },
    /** 调对位用：显示骨骼位置；ghost=true 时把内置角色半透明叠上来对照。 */
    debug(on, ghost = false) {
      if (on && !markers) {
        const geo = new THREE.SphereGeometry(0.018, 8, 6);
        markers = bones.map((bone, i) => {
          const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(i / bones.length, 0.9, 0.55), depthTest: false, transparent: true }));
          m.renderOrder = 999; m.raycast = () => {}; bone.add(m);
          return m;
        });
      }
      if (markers) for (const m of markers) m.visible = on;
      for (const o of hidden) o.visible = ghost;
    },
    dispose() {
      for (const o of hidden) o.visible = true;
      for (const m of glowMats) { const k = char.mats.indexOf(m); if (k >= 0) char.mats.splice(k, 1); }
      char.model.remove(skinRoot);
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      outlineMat?.dispose();
    },
  };
  ctl.update(0);
  if (debug) ctl.debug(true);
  return ctl;
}

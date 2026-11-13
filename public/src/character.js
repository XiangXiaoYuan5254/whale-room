// 大肥鱼本体：照着三视图用几何体一块块搭出来的 Q 版模型，带完整的关节（可以摆任意姿势）。
// 坐标：模型单位（mu）下身高约 1.72，脸朝 +z，她的左手边是 +x。整体再缩放到房间尺度。
import * as THREE from 'three';
import { Face } from './face.js';
import { TAU, lerp, clamp, smooth, mulberry } from './util.js';
import { whale } from './room.js';

export const SCALE = 0.33;
const C = {
  skin: 0xffe3d3, hairTop: 0x22379c, hairMid: 0x3562d4, hairTip: 0x5cc0f7, hairShine: 0x5a7ef0,
  navy: 0x1f2b62, white: 0xe9edf8, gold: 0xdcb45c, bow: 0x3f9ee8, pale: 0xcfdcf6, shoe: 0x1a2352, outline: 0x10152f,
};
const HC = new THREE.Vector3(0, 0.36, 0.02); // 头心（相对脖子关节）
const HR = new THREE.Vector3(0.46, 0.42, 0.43); // 头的三个半径
const D2R = Math.PI / 180;

export function gradientMap() {
  const t = new THREE.DataTexture(new Uint8Array([118, 172, 228, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

/** 沿一条曲线扫出一根扁管（头发、呆毛都用它）。radius(t) 返回 [宽, 厚]，ref 是「宽」的大致朝向。 */
function sweep(points, radius, { ref, nu = 14, nv = 8, color } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const pos = [], col = [], idx = [];
  const T = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3(), P = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    curve.getPoint(t, P); curve.getTangent(t, T);
    const r = typeof ref === 'function' ? ref(t, P) : ref;
    U.copy(r).addScaledVector(T, -r.dot(T)).normalize();
    V.crossVectors(T, U).normalize();
    const [rw, rd] = radius(t);
    if (color) color(t, c);
    for (let j = 0; j < nv; j++) {
      const a = (j / nv) * TAU, ca = Math.cos(a) * rw, sa = Math.sin(a) * rd;
      pos.push(P.x + U.x * ca + V.x * sa, P.y + U.y * ca + V.y * sa, P.z + U.z * ca + V.z * sa);
      if (color) col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * nv + j, b = i * nv + ((j + 1) % nv), c2 = (i + 1) * nv + j, d = (i + 1) * nv + ((j + 1) % nv);
    idx.push(a, b, c2, b, d, c2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (color) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 一圈荷叶边：XZ 平面上的环带，外沿上下起伏。a0/a1 可以只做一段弧。 */
function frill(r, width, waves, amp, { a0 = 0, a1 = TAU, drop = 0, seg } = {}) {
  const n = seg ?? Math.max(12, Math.round((waves * 8 * (a1 - a0)) / TAU));
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    const s = Math.sin(a), c = Math.cos(a);
    const w = Math.sin(a * waves);
    const ro = r + width * (0.86 + 0.14 * Math.cos(a * waves * 2));
    pos.push(r * s, 0, r * c, ro * s, -drop + amp * w, ro * c);
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const lathe = (profile, seg = 28, phiStart = 0, phiLen = TAU) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
function ellipsoid(rx, ry, rz, ws = 24, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz); g.computeVertexNormals();
  return g;
}
function capsule(r, len, axis = 'y') {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** 头的椭球面上的一点。az：0° 正前、90° 她的左侧；el：仰角；k：离头皮多远。 */
function onHead(az, el, k = 1) {
  const a = az * D2R, e = el * D2R;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e) * HR.x * k, Math.sin(e) * HR.y * k, Math.cos(a) * Math.cos(e) * HR.z * k).add(HC);
}

export function buildCharacter() {
  const root = new THREE.Group(); // 角色根：位置在脚底，actor 负责移动和转向
  root.userData.isCharacterRoot = true;
  const model = new THREE.Group(); // 模型缩放 + 起跳时的挤压拉伸
  model.scale.setScalar(SCALE);
  root.add(model);

  const gm = gradientMap();
  const mats = [];
  const toon = (color, opts = {}) => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: gm, ...opts });
    m.userData.glow = new THREE.Color(opts.vertexColors ? C.hairMid : color);
    mats.push(m);
    return m;
  };
  const M = {
    skin: toon(C.skin), navy: toon(C.navy), white: toon(C.white), whiteD: toon(C.white, { side: THREE.DoubleSide }),
    gold: toon(C.gold), bow: toon(C.bow), pale: toon(C.pale), shoe: toon(C.shoe),
    hair: toon(0xffffff, { vertexColors: true }), hairD: toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }),
  };
  const mOutline = new THREE.MeshBasicMaterial({ color: C.outline, side: THREE.BackSide });
  mOutline.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * 0.013;');
  };

  const J = {};
  const joint = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.name = name; parent.add(g); J[name] = g; return g;
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, outline = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = false;
    m.userData.isCharacter = true;
    parent.add(m);
    if (outline) { const o = new THREE.Mesh(geo, mOutline); o.userData.isOutline = true; m.add(o); }
    return m;
  };

  // ============ 躯干 ============
  const hips = joint('hips', model, 0, 0.42, 0);
  const spine = joint('spine', hips, 0, 0.08, 0);
  const torsoGeo = lathe([[0.001, -0.02], [0.118, -0.01], [0.128, 0.04], [0.15, 0.2], [0.142, 0.31], [0.1, 0.375], [0.062, 0.41], [0.05, 0.44]], 24);
  torsoGeo.scale(1, 1, 0.86);
  add(spine, torsoGeo, M.navy, 0, 0, 0, true);
  // 围裙的胸前部分 + 两粒扣子
  const bib = lathe([[0.133, 0.0], [0.156, 0.2], [0.149, 0.29]], 12, -0.62, 1.24); bib.scale(1, 1, 0.86);
  add(spine, bib, M.white);
  for (const y of [0.1, 0.19]) add(spine, new THREE.SphereGeometry(0.014, 8, 6), M.navy, 0, y, 0.133 + (y - 0.1) * 0.02);
  // 肩带的荷叶边
  for (const s of [-1, 1]) {
    const f = add(spine, frill(0.05, 0.075, 5, 0.012, { a0: -1.9, a1: 1.9, drop: 0.02 }), M.whiteD, s * 0.125, 0.345, 0.0);
    f.rotation.set(0, s * 0.5, -s * 1.15);
  }
  // 领口荷叶边 + 领结 + 宝石
  add(spine, frill(0.07, 0.06, 9, 0.01, { drop: 0.035 }), M.whiteD, 0, 0.385, 0);
  const tie = new THREE.Group(); tie.position.set(0, 0.315, 0.132); spine.add(tie);
  for (const s of [-1, 1]) { const l = add(tie, ellipsoid(0.058, 0.04, 0.022, 12, 8), M.navy, s * 0.052, 0, 0, true); l.rotation.z = s * 0.25; }
  add(tie, new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: 0x55c0ff, emissive: 0x2a8ae0, emissiveIntensity: 0.6, roughness: 0.2 }), 0, 0, 0.018);
  // 背后的大蝴蝶结
  const backBow = joint('backBow', spine, 0, 0.03, -0.13);
  for (const s of [-1, 1]) {
    const l = add(backBow, ellipsoid(0.17, 0.105, 0.05, 14, 10), M.white, s * 0.15, 0.03, -0.01, true); l.rotation.z = s * 0.38;
    const t = add(backBow, ellipsoid(0.05, 0.16, 0.03, 10, 8), M.white, s * 0.06, -0.15, -0.02, true); t.rotation.z = s * 0.28;
  }
  add(backBow, ellipsoid(0.055, 0.06, 0.05, 10, 8), M.white, 0, 0.02, -0.01, true);

  // ============ 裙子 ============
  const skirt = joint('skirt', hips, 0, 0.06, 0);
  add(skirt, lathe([[0.375, -0.215], [0.3, -0.09], [0.205, 0.02], [0.14, 0.085], [0.122, 0.105]], 32), M.navy, 0, 0, 0, true);
  add(skirt, lathe([[0.37, -0.198], [0.354, -0.172]], 32), M.gold);
  add(skirt, lathe([[0.001, -0.175], [0.345, -0.175]], 24), M.whiteD); // 裙底
  add(skirt, frill(0.33, 0.085, 20, 0.013, { drop: 0.035 }), M.whiteD, 0, -0.205, 0);
  // 腰带
  add(skirt, new THREE.TorusGeometry(0.128, 0.022, 8, 28).rotateX(Math.PI / 2), M.navy, 0, 0.1, 0);
  for (const y of [0.118, 0.082]) add(skirt, new THREE.TorusGeometry(0.146, 0.005, 6, 28).rotateX(Math.PI / 2), M.gold, 0, y, 0);
  // 白围裙 + 荷叶边 + 小鲸鱼徽章
  add(skirt, lathe([[0.366, -0.178], [0.31, -0.09], [0.215, 0.02], [0.152, 0.08]], 14, -0.74, 1.48), M.white);
  add(skirt, frill(0.355, 0.055, 20, 0.012, { a0: -0.78, a1: 0.78, drop: 0.035 }), M.whiteD, 0, -0.172, 0);
  const emblemTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d'); g.translate(62, 56); g.scale(1.05, 1.05); whale(g, '#2740b0', '#bcd6ff');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.09), new THREE.MeshToonMaterial({ map: emblemTex, transparent: true, gradientMap: gm }));
  emblem.position.set(Math.sin(0.36) * 0.305, -0.085, Math.cos(0.36) * 0.305); emblem.rotation.set(-0.55, 0.36, 0, 'YXZ');
  skirt.add(emblem);
  // 裙摆上的金色小蝴蝶结
  for (const a of [-1.15, 1.15, -2.2, 2.2]) {
    const b = new THREE.Group(); b.position.set(Math.sin(a) * 0.345, -0.14, Math.cos(a) * 0.345); b.rotation.set(-0.5, a, 0, 'YXZ'); skirt.add(b);
    for (const s of [-1, 1]) { const l = add(b, ellipsoid(0.03, 0.02, 0.008, 8, 6), M.gold, s * 0.027, 0, 0); l.rotation.z = s * 0.3; }
    add(b, new THREE.SphereGeometry(0.011, 6, 5), M.gold);
  }

  // ============ 腿 ============
  for (const [n, s] of [['L', 1], ['R', -1]]) {
    const leg = joint('leg' + n, hips, s * 0.088, -0.02, 0);
    add(leg, capsule(0.07, 0.09), M.skin, 0, -0.095, 0, true);
    const shin = joint('shin' + n, leg, 0, -0.19, 0);
    add(shin, capsule(0.062, 0.05), M.skin, 0, -0.05, 0, true);
    add(shin, new THREE.CylinderGeometry(0.066, 0.062, 0.09, 14), M.white, 0, -0.125, 0);
    add(shin, frill(0.056, 0.036, 8, 0.008, { drop: 0.004 }), M.whiteD, 0, -0.082, 0);
    add(shin, ellipsoid(0.078, 0.052, 0.118, 16, 10), M.shoe, 0, -0.165, 0.028, true);
    add(shin, new THREE.TorusGeometry(0.068, 0.011, 6, 16).rotateX(Math.PI / 2), M.shoe, 0, -0.128, 0.0);
  }

  // ============ 手臂 ============
  for (const [n, s] of [['L', 1], ['R', -1]]) {
    const arm = joint('arm' + n, spine, s * 0.162, 0.325, 0);
    add(arm, ellipsoid(0.088, 0.08, 0.085, 14, 10), M.navy, 0, -0.015, 0, true);
    add(arm, capsule(0.058, 0.08), M.navy, 0, -0.085, 0, true);
    const fore = joint('fore' + n, arm, 0, -0.15, 0);
    add(fore, capsule(0.056, 0.05), M.navy, 0, -0.045, 0, true);
    add(fore, new THREE.TorusGeometry(0.056, 0.007, 6, 16).rotateX(Math.PI / 2), M.gold, 0, -0.085, 0);
    add(fore, frill(0.04, 0.038, 8, 0.008, { drop: 0.02 }), M.whiteD, 0, -0.098, 0);
    add(fore, new THREE.SphereGeometry(0.056, 14, 10), M.skin, 0, -0.15, 0, true);
    joint('hand' + n, fore, 0, -0.16, 0.02);
  }

  // ============ 尾巴 ============
  const tailLen = [0.16, 0.15, 0.14, 0.12], tailR = [0.1, 0.086, 0.07, 0.054];
  let tp = hips, tz = -0.1, ty = -0.03;
  for (let i = 0; i < 4; i++) {
    const tj = joint('tail' + i, tp, 0, ty, tz);
    add(tj, capsule(tailR[i], tailLen[i] * 0.7, 'z'), M.navy, 0, 0, -tailLen[i] / 2, true);
    add(tj, capsule(tailR[i] * 0.8, tailLen[i] * 0.7, 'z'), M.pale, 0, -tailR[i] * 0.3, -tailLen[i] / 2);
    tp = tj; ty = 0; tz = -tailLen[i];
  }
  const fluke = joint('fluke', tp, 0, 0, tz);
  for (const s of [-1, 1]) { const f = add(fluke, ellipsoid(0.125, 0.024, 0.075, 14, 8), M.navy, s * 0.085, 0, -0.065, true); f.rotation.y = s * 0.75; }
  add(fluke, ellipsoid(0.05, 0.03, 0.06, 10, 8), M.navy, 0, 0, -0.02);

  // ============ 头 ============
  const head = joint('head', spine, 0, 0.4, 0);
  add(head, ellipsoid(HR.x, HR.y, HR.z, 32, 24), M.skin, HC.x, HC.y, HC.z, true);
  // 脸
  const face = new Face();
  const PHI = 2.3, THETA = 1.3;
  const faceGeo = new THREE.SphereGeometry(1, 28, 16, Math.PI / 2 - PHI / 2, PHI, Math.PI / 2 - 0.62, THETA);
  faceGeo.scale(HR.x * 1.006, HR.y * 1.006, HR.z * 1.006);
  const faceMat = new THREE.MeshToonMaterial({ map: face.texture, transparent: true, gradientMap: gm, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.position.copy(HC); faceMesh.renderOrder = 2;
  head.add(faceMesh);

  // ---- 头发 ----
  const cTop = new THREE.Color(C.hairTop), cMid = new THREE.Color(C.hairMid), cTip = new THREE.Color(C.hairTip), cShine = new THREE.Color(C.hairShine);
  const hairColor = (t, c) => { if (t < 0.4) c.copy(cTop).lerp(cMid, smooth(t / 0.4)); else c.copy(cMid).lerp(cTip, smooth((t - 0.4) / 0.6)); };
  // 发壳：盖住头顶、两侧和后脑勺，前面留出脸
  {
    const src = new THREE.SphereGeometry(1, 40, 28);
    const p = src.attributes.position, index = src.index.array, keep = [], col = [];
    const elOf = (i) => Math.asin(clamp(p.getY(i), -1, 1)) / D2R;
    const azOf = (i) => Math.atan2(p.getX(i), p.getZ(i)) / D2R;
    for (let i = 0; i < index.length; i += 3) {
      let drop = false;
      const el = (elOf(index[i]) + elOf(index[i + 1]) + elOf(index[i + 2])) / 3;
      const az = Math.abs(azOf(index[i]) + azOf(index[i + 1]) + azOf(index[i + 2])) / 3;
      const azs = [azOf(index[i]), azOf(index[i + 1]), azOf(index[i + 2])];
      const wrap = Math.max(...azs) - Math.min(...azs) > 180;
      if (!wrap && az < 66 && el < 24) drop = true;
      if (el < -58) drop = true;
      if (!drop) keep.push(index[i], index[i + 1], index[i + 2]);
    }
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const el = elOf(i);
      c.copy(cTop);
      const band = Math.exp(-Math.pow((el - 52) / 9, 2)) * 0.55; // 头顶那圈高光
      c.lerp(cShine, band);
      if (el < 0) c.lerp(cMid, clamp(-el / 60, 0, 1) * 0.5);
      col.push(c.r, c.g, c.b);
    }
    src.setIndex(keep);
    src.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    src.scale(HR.x * 1.075, HR.y * 1.08, HR.z * 1.085); src.computeVertexNormals();
    add(head, src, M.hairD, HC.x, HC.y + 0.005, HC.z - 0.012, true);
  }
  // 刘海
  const bangColor = (t, c) => { c.copy(cTop).lerp(cShine, Math.exp(-Math.pow((t - 0.22) / 0.14, 2)) * 0.5).lerp(cMid, smooth(t) * 0.45); };
  const bang = (az0, el0, az1, el1, w, bulge = 1.1) => {
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      pts.push(onHead(lerp(az0, az1, t), lerp(el0, el1, t), lerp(1.085, 1.06, t) + Math.sin(t * Math.PI) * (bulge - 1.06) * 0.6));
    }
    const azm = ((az0 + az1) / 2) * D2R;
    const ref = new THREE.Vector3(Math.cos(azm), 0, -Math.sin(azm));
    const geo = sweep(pts, (t) => [w * (0.55 + 0.45 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2)) * Math.pow(1 - t, 0.75) + 0.001, 0.034 * Math.pow(1 - t, 0.5) + 0.001], { ref, nu: 10, nv: 8, color: bangColor });
    add(head, geo, M.hair, 0, 0, 0, true);
  };
  bang(0, 56, -3, 1, 0.105);
  bang(-17, 56, -25, 10, 0.125); bang(17, 56, 24, 10, 0.125);
  bang(-36, 54, -46, 3, 0.135); bang(36, 54, 46, 3, 0.135);
  bang(-56, 50, -63, -10, 0.125); bang(56, 50, 63, -10, 0.125);
  bang(-8, 56, -12, 16, 0.09); bang(9, 56, 12, 14, 0.09);
  bang(-27, 56, -36, 12, 0.1); bang(27, 56, 36, 12, 0.1);

  // 长发：一缕一缕挂在各自的轴上，走动、转头时会跟着摆
  const strands = [];
  const strand = (az, { el = -4, len = 1.0, spread = 0.66, w = 0.22, d = 0.085, wave = 0.07, phase = 0, k = 1.03, name }) => {
    const a = az * D2R;
    const rootP = onHead(az, el, k);
    const pts = [new THREE.Vector3()];
    const r0 = Math.hypot(rootP.x, rootP.z);
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const rad = lerp(r0, spread, smooth(Math.min(1, s * 1.35))) - Math.max(0, s - 0.75) * 0.22;
      const da = Math.sin(s * 6.2 + phase) * wave * s;
      const aa = a + da / Math.max(0.3, rad);
      pts.push(new THREE.Vector3(Math.sin(aa) * rad, rootP.y - s * len, Math.cos(aa) * rad * 0.96 - 0.02 * s).sub(new THREE.Vector3(rootP.x, 0, rootP.z)).setY(-s * len));
    }
    const ref = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const geo = sweep(pts, (t) => {
      const body = t < 0.35 ? lerp(0.7, 1, t / 0.35) : 1 - Math.pow((t - 0.35) / 0.65, 2.2);
      return [w * body + 0.002, d * (0.6 + 0.4 * body) * Math.pow(1 - t, 0.3) + 0.002];
    }, { ref, nu: 16, nv: 8, color: hairColor });
    const pivot = new THREE.Group(); pivot.position.copy(rootP); head.add(pivot);
    add(pivot, geo, M.hair, 0, 0, 0, true);
    const st = { pivot, az: a, len, out: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), tan: ref.clone(), sway: 0, swayV: 0, swing: 0, swingV: 0, stiff: 0.75 + Math.random() * 0.5, name };
    strands.push(st);
    return st;
  };
  const rnd = mulberry(42);
  for (let i = 0; i < 11; i++) { // 外层
    const az = 97 + i * 16.6;
    strand(az, { len: 0.96 + rnd() * 0.12, spread: 0.62 + rnd() * 0.08, wave: 0.08 + rnd() * 0.06, phase: rnd() * 6, w: 0.2, d: 0.115 });
  }
  for (let i = 0; i < 8; i++) { // 内层，短一点，把缝补上
    const az = 108 + i * 20.5;
    strand(az, { len: 0.8 + rnd() * 0.1, spread: 0.5 + rnd() * 0.05, wave: 0.04, phase: rnd() * 6, w: 0.26, d: 0.12, k: 0.98, el: -12 });
  }
  // 脸颊两侧的鬓发
  for (const s of [-1, 1]) strand(s * 80, { el: 12, len: 0.78, spread: 0.5, w: 0.13, d: 0.07, wave: 0.035, phase: s, k: 1.07, name: 'lock' });
  for (const s of [-1, 1]) strand(s * 96, { el: 4, len: 0.92, spread: 0.6, w: 0.17, d: 0.08, wave: 0.05, phase: 2 + s, k: 1.05 });

  // 呆毛
  const ahoge = joint('ahoge', head, HC.x, HC.y + HR.y * 1.06, HC.z + 0.03);
  add(ahoge, sweep(
    [new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0.015, 0.09, 0), new THREE.Vector3(-0.03, 0.18, 0.01), new THREE.Vector3(-0.12, 0.225, 0.02), new THREE.Vector3(-0.2, 0.19, 0.02), new THREE.Vector3(-0.235, 0.13, 0.02)],
    (t) => [0.03 * Math.pow(1 - t, 0.6) + 0.002, 0.022 * Math.pow(1 - t, 0.6) + 0.002], { ref: new THREE.Vector3(0, 0, 1), nu: 14, nv: 6, color: (t, c) => c.copy(cTop) }), M.hair, 0, 0, 0, true);

  // 女仆发箍 + 立起来的荷叶边
  const band = new THREE.Group(); band.position.copy(HC); band.rotation.x = 0.2; head.add(band);
  const bandGeo = new THREE.TorusGeometry(0.505, 0.03, 8, 36, Math.PI * 0.94); bandGeo.rotateZ(Math.PI * 0.03); bandGeo.scale(1, 0.94, 1);
  add(band, bandGeo, M.white);
  const ruffle = frill(0.5, 0.125, 13, 0.03, { a0: -1.32, a1: 1.32 }); ruffle.rotateX(-Math.PI / 2); ruffle.scale(1, 0.94, 1);
  add(band, ruffle, M.whiteD, 0, 0, 0.012);
  const ruffle2 = frill(0.5, 0.075, 13, 0.022, { a0: -1.36, a1: 1.36 }); ruffle2.rotateX(-Math.PI / 2); ruffle2.scale(1, 0.94, 1);
  add(band, ruffle2, M.whiteD, 0, 0, 0.04);
  // 蓝色小蝴蝶结（她的左侧）
  const hbow = new THREE.Group(); hbow.position.set(0.455, 0.47, 0.17).sub(new THREE.Vector3(0, 0.36, 0.02)).add(HC); hbow.rotation.set(0, 0.6, -0.2); head.add(hbow);
  for (const s of [-1, 1]) { const l = add(hbow, ellipsoid(0.085, 0.06, 0.035, 12, 8), M.bow, s * 0.075, 0, 0, true); l.rotation.z = s * 0.3; }
  add(hbow, new THREE.SphereGeometry(0.032, 10, 8), M.bow, 0, 0, 0.012, true);

  // 鱼鳍耳朵
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0.085);
  finShape.bezierCurveTo(0.15, 0.13, 0.32, 0.07, 0.4, -0.06);
  finShape.bezierCurveTo(0.3, -0.07, 0.15, -0.105, 0, -0.085);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 10 });
  finGeo.translate(0, 0, -0.015);
  const finInner = new THREE.ShapeGeometry(finShape, 10); finInner.scale(0.6, 0.62, 1);
  for (const [n, s] of [['L', 1], ['R', -1]]) {
    const fin = joint('fin' + n, head, s * 0.4, HC.y - 0.07, HC.z - 0.06);
    const inner = new THREE.Group(); inner.scale.x = s; inner.rotation.set(0, s * 0.42, -s * 0.22); fin.add(inner);
    add(inner, finGeo, M.navy, 0, 0, 0, true);
    const pi = add(inner, finInner, M.pale, 0.02, -0.012, 0.0285); pi.castShadow = false;
  }

  // ============ 手里的小道具（平时藏起来） ============
  const props = {};
  // 手机：屏幕会亮
  {
    const g = new THREE.Group(); g.visible = false; spine.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0x1c1f2a, roughness: 0.4 }));
    body.castShadow = true; g.add(body);
    const c = document.createElement('canvas'); c.width = 128; c.height = 230;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.153, 0.27), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.z = 0.0106; g.add(scr);
    const light = new THREE.PointLight(0x9cc8ff, 0, 0.6, 0); light.position.set(0, 0.1, 0.35); g.add(light);
    const draw = (lines) => {
      const x = c.getContext('2d');
      x.fillStyle = '#1a2136'; x.fillRect(0, 0, 128, 230);
      x.fillStyle = '#27407e'; x.fillRect(0, 0, 128, 26);
      x.fillStyle = '#9db6e8'; x.fillRect(44, 9, 40, 7);
      let y = 36;
      for (const [mine, w] of lines) {
        x.fillStyle = mine ? '#3f78d6' : '#5a6480';
        const bw = 30 + w * 60, bx = mine ? 128 - bw - 8 : 8;
        x.beginPath(); x.roundRect(bx, y, bw, 18, 7); x.fill();
        y += 25;
      }
      tex.needsUpdate = true;
    };
    const lines = [[0, 0.5], [1, 0.7], [0, 0.3]];
    draw(lines);
    props.phone = {
      group: g, light,
      /** 屏幕上多一条气泡。mine=true 是她发的。 */
      push(mine) { lines.push([mine ? 1 : 0, Math.random()]); while (lines.length > 7) lines.shift(); draw(lines); },
    };
  }
  // 摊开的书（书页一面是 +Z，书顶是 +Y）。两半往书页那面合拢一点，像真摊开的书那样中间凹下去；拿在手里时书页朝着她的脸（见 brain.holdBook）
  {
    const g = new THREE.Group(); g.visible = false; spine.add(g);
    const cover = new THREE.MeshStandardMaterial({ color: 0xd9604a, roughness: 0.8 }), page = new THREE.MeshStandardMaterial({ color: 0xfbf7ec, roughness: 0.9 });
    const pages = [];
    for (const s of [-1, 1]) {
      const half = new THREE.Group(); half.rotation.y = -s * 0.32; g.add(half);
      const cv = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.27, 0.012), cover); cv.position.set(s * 0.1, 0, -0.008); cv.castShadow = true; half.add(cv);
      const pg = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.25, 0.014), page); pg.position.set(s * 0.097, 0, 0.004); half.add(pg);
      for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.008), new THREE.MeshBasicMaterial({ color: 0x9aa0b4 })); l.position.set(s * 0.097, 0.08 - i * 0.04, 0.0115); half.add(l); }
    }
    const flip = new THREE.Group(); g.add(flip);
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.245), new THREE.MeshStandardMaterial({ color: 0xfffdf6, roughness: 0.9, side: THREE.DoubleSide })); fp.position.x = 0.09; flip.add(fp);
    flip.visible = false;
    props.book = { group: g, flip, pages };
  }
  // 小水壶（挂在右手上）
  {
    const g = new THREE.Group(); g.visible = false; J.handR.add(g);
    g.scale.setScalar(1 / SCALE);
    props.can = { group: g };
  }

  return {
    root, model, J, face, props, strands, mats,
    /** 夜里给她一点自发光，免得黑成一团。dark: 0（白天）~1（深夜）。 */
    setGlow(dark) {
      const k = 0.05 + dark * 0.17;
      for (const m of mats) { m.emissive.copy(m.userData.glow); m.emissiveIntensity = k; }
      faceMat.emissive = faceMat.emissive ?? new THREE.Color();
      faceMat.emissiveMap = face.texture; faceMat.emissive.setRGB(1, 1, 1); faceMat.emissiveIntensity = k * 0.9;
    },
  };
}

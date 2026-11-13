// 被子：一整块布，平时堆在床尾。她抓住被头往床头拖，布就被拉开——被头跟着她的手走，后面的部分先被拉直、
// 再整条跟过来；躺下后盖到下巴，身体把它顶起来。掀开时被头滑回床尾，布重新堆起褶子。
// 形状是每帧按「被头在哪、被提起多高、身体在哪」现算的，没有缩放、淡入淡出这类假动作。
import * as THREE from 'three';
import { clamp, damp, smooth } from './util.js';

const NU = 46, NV = 34;
const THICK = 0.016; // 被子的厚度（米）

/**
 * @param parent 挂在哪（床）
 * @param mat 被面材质
 * @param o.top 床面高度
 * @param o.z 被子中线的 z（她睡觉的那条线）
 * @param o.len 被子拉直后的长度（沿床的方向）；o.wid 宽度
 * @param o.pileEdge / o.pileFoot 堆在床尾时，被头和被尾的 x
 */
export function buildQuilt(parent, mat, { top, z, len = 0.82, wid = 0.7, pileEdge = -0.6, pileFoot = -0.02 }) {
  // 一块有厚度的布：上、下两层网格，四周用一圈侧面封起来（被头被提起来时能看出它是厚的，不是一张纸）
  const n = (NU + 1) * (NV + 1), at = (i, j) => j * (NU + 1) + i;
  // 每个顶点在布上的位置：u 从被头(0)到被尾(1)，v 从 -1 到 1 横跨被面
  const U = new Float32Array(n), V = new Float32Array(n), uv = new Float32Array(n * 4), index = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const k = at(i, j);
    U[k] = i / NU; V[k] = (j / NV) * 2 - 1;
    uv[k * 2] = uv[(k + n) * 2] = i / NU; uv[k * 2 + 1] = uv[(k + n) * 2 + 1] = j / NV;
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    index.push(a, c, b, b, c, d, a + n, b + n, c + n, b + n, d + n, c + n); // 上层朝上，下层朝下
  }
  for (let i = 0; i < NU; i++) { // 两条长边
    let a = at(i, 0), b = at(i + 1, 0); index.push(a, b, b + n, a, b + n, a + n);
    a = at(i, NV); b = at(i + 1, NV); index.push(a, b + n, b, a, a + n, b + n);
  }
  for (let j = 0; j < NV; j++) { // 被头、被尾
    let a = at(0, j), b = at(0, j + 1); index.push(a, b + n, b, a, a + n, b + n);
    a = at(NU, j); b = at(NU, j + 1); index.push(a, b, b + n, a, b + n, a + n);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  const P = geo.attributes.position;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = top; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'bed';
  parent.add(mesh);

  const st = {
    mode: 'pile', // pile 堆在床尾 | held 被头在她手里 | cover 盖在身上
    edge: pileEdge, lift: 0, liftV: 0, gz: z, settle: 0,
    chin: -1.47, grip: null, blobs: null, dirty: true,
  };
  const _g = new THREE.Vector3();

  function rebuild() {
    const foot = Math.min(pileFoot, st.edge + len), span = foot - st.edge;
    const heapK = 1 - smooth((span / len - 0.74) / 0.23); // 布被挤得越短，褶子堆得越高
    const tentL = 0.09 + st.lift * 1.0;
    const blobs = st.settle > 0.01 ? st.blobs : null;
    for (let i = 0; i < n; i++) {
      const u = U[i], v = V[i], x = st.edge + u * span, zz = z + v * wid / 2;
      const xm = u * len, zm = v * wid / 2; // 布自己的坐标：褶子长在布上，跟着布走
      const side = Math.max(0.1, 1 - Math.pow(Math.abs(v), 5)), end = Math.min(1, (1 - u) / 0.1);
      const wr = Math.sin(xm * 14 + zm * 5) * 0.5 + Math.sin(zm * 11 - xm * 7 + 1.3) * 0.5 + Math.sin(xm * 23 + 2) * 0.25;
      const heap = Math.max(0, (0.055 + wr * 0.032) * (1 - Math.pow(Math.abs(2 * u - 1), 4)) * (1 - Math.pow(Math.abs(v), 6)));
      const fold = 0.012 + (Math.sin(xm * 19 + zm * 7) * 0.5 + Math.sin(zm * 15 - xm * 9 + 1.1) * 0.5) * 0.007 + 0.007 * Math.exp(-((u / 0.035) ** 2));
      let y = 0.012 + Math.max(heap * heapK, fold * (1 - heapK)) * side * end;
      if (blobs) { // 盖在身上：被身体顶起来
        let b = 0;
        for (const [bx, by, bz, r] of blobs) {
          const h = by + r - top;
          if (h <= 0) continue;
          const d2 = ((x - bx) ** 2 + (zz - bz) ** 2) / ((r * 1.9) ** 2);
          if (d2 < 9) b = Math.max(b, h * Math.exp(-d2));
        }
        y = Math.max(y, b * st.settle + 0.012);
      }
      if (st.lift > 0.002) { // 被头被手提着：手那儿最高，往两边、往后垂到床上
        const du = (x - st.edge) / tentL, dv = (zz - st.gz) / 0.2;
        y = Math.max(y, st.lift * Math.exp(-du * du - dv * dv));
      }
      y += THICK * 0.5;
      P.setXYZ(i, x, y, zz); P.setXYZ(i + n, x, Math.max(0.003, y - THICK), zz);
    }
    P.needsUpdate = true;
    geo.computeVertexNormals();
  }
  rebuild();

  return {
    mesh,
    get mode() { return st.mode; },
    /** 被子盖在身上的程度（0~1）。 */
    get settle() { return st.settle; },
    /** 被头现在的位置（世界坐标）：她弯腰去抓的就是这儿。 */
    edgePoint(out = new THREE.Vector3()) { return out.set(st.edge + 0.01, top + 0.05, z); },
    /** 她抓住了被头。grip(out) 每帧写出两手中点的世界坐标；blobs() 给出身体轮廓（见 Body.blobs）。 */
    hold(grip, blobs) { st.mode = 'held'; st.grip = grip; st.getBlobs = blobs; },
    /** 松手盖好：被头落到 chinX（下巴的位置），身体把被子顶起来。 */
    cover(chinX) { if (st.mode === 'pile') return; st.mode = 'cover'; st.chin = clamp(chinX, -1.62, pileEdge); },
    /** 掀开：被子滑回床尾堆着。 */
    throwOff() { if (st.mode === 'pile') return; st.mode = 'pile'; st.grip = null; st.liftV = 0.9; },
    update(dt) {
      const e0 = st.edge, l0 = st.lift, s0 = st.settle;
      if (st.mode === 'held') {
        st.grip(_g);
        st.edge = damp(st.edge, clamp(_g.x + 0.012, -1.62, pileEdge), 16, dt);
        st.lift = damp(st.lift, Math.max(0, _g.y - top - 0.012), 16, dt);
        st.gz = _g.z; st.settle = damp(st.settle, 1, 5, dt);
      } else if (st.mode === 'cover') {
        st.edge = damp(st.edge, st.chin, 4, dt); st.lift = damp(st.lift, 0, 5, dt); st.settle = damp(st.settle, 1, 5, dt);
      } else {
        // 掀开的那一下：被头先被扬起来，再落回床尾
        st.liftV += (-st.lift * 60 - st.liftV * 9) * dt; st.lift = Math.max(0, st.lift + st.liftV * dt);
        st.edge = damp(st.edge, pileEdge, 4.2, dt); st.settle = damp(st.settle, 0, 6, dt);
        if (Math.abs(st.edge - pileEdge) < 5e-4) st.edge = pileEdge;
        if (st.settle < 0.003) st.settle = 0;
      }
      const live = st.mode !== 'pile' || st.settle > 0;
      if (live && st.getBlobs) st.blobs = st.getBlobs();
      if (live || Math.abs(st.edge - e0) > 1e-5 || Math.abs(st.lift - l0) > 1e-5 || st.settle !== s0 || st.dirty) { rebuild(); st.dirty = false; }
    },
  };
}

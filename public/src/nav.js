// 寻路：地板是带障碍的网格（A*），床、窗台、椅子、书桌是几块小平台，平台之间靠「跳」连接。
// 所以她能去哪、怎么去，都是当场算出来的路线，而不是固定的动画。
import { ROOM, CUSHION, PLANT } from './room.js';
import { RICE_TABLE, RICE_BAG, SINK_BOX } from './kitchen.js';
import { SPEAKER_CIRCLE } from './speaker.js';
import { SPEAR_RACK_CIRCLE } from './spear.js';
import { clamp } from './util.js';

const CELL = 0.07;
const RADIUS = 0.14; // 她的身体半径（障碍物要外扩这么多）

export const SURFACES = {
  floor: { y: 0 },
  bed: { y: 0.462, rect: [-1.45, -0.66, -1.42, -0.8] },
  sill: { y: 0.972, rect: [-1.6, -0.1, -1.7, -1.58] },
  chair: { y: 0.472, rect: [1.08, 1.12, -0.62, -0.58] },
  desk: { y: 0.742, rect: [0.68, 1.62, -1.25, -1.13] },
};

// 平台之间可以跳的地方（双向）
const LINKS = [
  [{ s: 'floor', x: -1.3, z: -0.42 }, { s: 'bed', x: -1.3, z: -0.88 }],
  [{ s: 'floor', x: -0.85, z: -0.42 }, { s: 'bed', x: -0.85, z: -0.88 }],
  [{ s: 'bed', x: -1.2, z: -1.34 }, { s: 'sill', x: -1.2, z: -1.63 }],
  [{ s: 'bed', x: -0.8, z: -1.34 }, { s: 'sill', x: -0.8, z: -1.63 }],
  [{ s: 'floor', x: 1.1, z: -0.12 }, { s: 'chair', x: 1.1, z: -0.6 }],
  [{ s: 'chair', x: 1.1, z: -0.6 }, { s: 'desk', x: 1.12, z: -1.17 }],
];

const BOXES = [ // [x0, x1, z0, z1]
  RICE_TABLE, // 放电饭煲的木托盘
  RICE_BAG, // 米袋
  SINK_BOX, // 洗碗盆
  [-2.05, 0.0, -1.75, -0.72], // 床
  [1.56, 2.02, -1.72, -1.08], // 书桌抽屉柜
  [0.55, 0.62, -1.76, -1.04], // 书桌左边两条腿
  [1.78, 2.1, 0.3, 1.4], // 矮书架
];
const CIRCLES = [ // [x, z, r]
  [1.1, -0.6, 0.27], // 椅子
  [0.3, -1.52, 0.12], // 垃圾桶
  [CUSHION.x, CUSHION.z, CUSHION.r - 0.04], // 懒人垫
  [PLANT.x, PLANT.z, 0.2], // 盆栽
  [-1.38, 1.52, 0.08], // 水壶
  [-1.81, 0.05, 0.13], // 地上的书
  SPEAKER_CIRCLE, // 小音箱
  SPEAR_RACK_CIRCLE, // 枪架
];

export class Nav {
  constructor() {
    this.x0 = ROOM.x0; this.z0 = ROOM.z0;
    this.nx = Math.ceil((ROOM.x1 - ROOM.x0) / CELL); this.nz = Math.ceil((ROOM.z1 - ROOM.z0) / CELL);
    this.blocked = new Uint8Array(this.nx * this.nz);
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const x = this.x0 + (ix + 0.5) * CELL, z = this.z0 + (iz + 0.5) * CELL;
      this.blocked[iz * this.nx + ix] = this.#solid(x, z) ? 1 : 0;
    }
  }

  #solid(x, z) {
    if (x < ROOM.x0 + RADIUS || x > ROOM.x1 - RADIUS || z < ROOM.z0 + RADIUS || z > ROOM.z1 - RADIUS) return true;
    for (const [x0, x1, z0, z1] of BOXES) if (x > x0 - RADIUS && x < x1 + RADIUS && z > z0 - RADIUS && z < z1 + RADIUS) return true;
    for (const [cx, cz, r] of CIRCLES) if (Math.hypot(x - cx, z - cz) < r + RADIUS) return true;
    return false;
  }

  #cell(x, z) { return [clamp(Math.floor((x - this.x0) / CELL), 0, this.nx - 1), clamp(Math.floor((z - this.z0) / CELL), 0, this.nz - 1)]; }
  #center(ix, iz) { return { x: this.x0 + (ix + 0.5) * CELL, z: this.z0 + (iz + 0.5) * CELL }; }
  #free(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz && !this.blocked[iz * this.nx + ix]; }

  /** 地板上这点能不能站。 */
  isFree(x, z) { const [ix, iz] = this.#cell(x, z); return this.#free(ix, iz); }

  /** 离 (x,z) 最近的可站立点。 */
  nearestFree(x, z) {
    const [cx, cz] = this.#cell(x, z);
    if (this.#free(cx, cz)) return { x: clamp(x, ROOM.x0 + RADIUS, ROOM.x1 - RADIUS), z: clamp(z, ROOM.z0 + RADIUS, ROOM.z1 - RADIUS) };
    for (let r = 1; r < 40; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!this.#free(cx + dx, cz + dz)) continue;
        const c = this.#center(cx + dx, cz + dz), d = Math.hypot(c.x - x, c.z - z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return best;
    }
    return { x: 0, z: 0.5 };
  }

  randomFloorPoint() {
    for (let i = 0; i < 60; i++) {
      const x = ROOM.x0 + Math.random() * (ROOM.x1 - ROOM.x0), z = ROOM.z0 + Math.random() * (ROOM.z1 - ROOM.z0);
      if (this.isFree(x, z)) return { surface: 'floor', x, z };
    }
    return { surface: 'floor', x: 0, z: 0.5 };
  }

  /** 把一个点收进某个平台的范围里。 */
  clampTo(surface, x, z) {
    if (surface === 'floor') return this.nearestFree(x, z);
    const [x0, x1, z0, z1] = SURFACES[surface].rect;
    return { x: clamp(x, x0, x1), z: clamp(z, z0, z1) };
  }

  #los(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / (CELL * 0.5));
    for (let i = 1; i < n; i++) { const t = i / n; if (!this.isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
    return true;
  }

  /** 地板上的 A*，返回拉直后的路径点（不含起点）。找不到路返回 null。 */
  floorPath(from, to) {
    const s = this.nearestFree(from.x, from.z), g = this.nearestFree(to.x, to.z);
    if (this.#los(s, g)) return [g];
    const [sx, sz] = this.#cell(s.x, s.z), [gx, gz] = this.#cell(g.x, g.z);
    const N = this.nx * this.nz, nx = this.nx;
    const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = []; // 简单的数组小根堆替代：规模很小，线性找最小就够了
    const start = sz * nx + sx, goal = gz * nx + gx;
    gScore[start] = 0; open.push(start);
    const hfn = (i) => { const dx = Math.abs((i % nx) - gx), dz = Math.abs(Math.floor(i / nx) - gz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    const fScore = new Float32Array(N).fill(Infinity); fScore[start] = hfn(start);
    let found = false;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % nx, cz = Math.floor(cur / nx);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx, z = cz + dz;
        if (!this.#free(x, z)) continue;
        if (dx && dz && (!this.#free(cx + dx, cz) || !this.#free(cx, cz + dz))) continue; // 不许斜着擦过拐角
        const ni = z * nx + x;
        if (closed[ni]) continue;
        const cost = gScore[cur] + (dx && dz ? 1.4142 : 1);
        if (cost < gScore[ni]) { gScore[ni] = cost; came[ni] = cur; fScore[ni] = cost + hfn(ni); open.push(ni); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.#center(i % nx, Math.floor(i / nx)));
    pts[0] = s; pts[pts.length - 1] = g;
    // 拉直：能直接走到的就跳过中间点
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.#los(pts[a], pts[b])) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  }

  #walkCost(surface, a, b) {
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    return surface === 'floor' ? d * 1.25 : d;
  }

  /**
   * 规划从 from 到 to 的整条路线（都是 {surface, x, z}）。
   * 返回一串步骤：{type:'walk', surface, pts} 或 {type:'jump', to:{surface,x,y,z}}；去不了返回 null。
   */
  route(from, to) {
    // 小图上跑 Dijkstra：节点 = 起点、终点、每个跳点的两端
    const nodes = [{ s: from.surface, x: from.x, z: from.z }, { s: to.surface, x: to.x, z: to.z }];
    const linkEdges = [];
    for (const [a, b] of LINKS) { const ia = nodes.push({ ...a }) - 1, ib = nodes.push({ ...b }) - 1; linkEdges.push([ia, ib]); }
    const n = nodes.length;
    const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), via = new Array(n).fill(null), done = new Array(n).fill(false);
    dist[0] = 0;
    const jumpOf = (i, j) => linkEdges.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      if (u === 1) break;
      for (let v = 0; v < n; v++) {
        if (done[v] || v === u) continue;
        let c = Infinity, kind = null;
        if (jumpOf(u, v)) { c = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z) + 0.7; kind = 'jump'; }
        else if (nodes[u].s === nodes[v].s) { c = this.#walkCost(nodes[u].s, nodes[u], nodes[v]); kind = 'walk'; }
        if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; via[v] = kind; }
      }
    }
    if (dist[1] === Infinity) return null;
    const chain = [];
    for (let i = 1; i !== 0; i = prev[i]) chain.push(i);
    chain.reverse();
    const steps = [];
    let cur = nodes[0];
    for (const i of chain) {
      const nd = nodes[i];
      if (via[i] === 'jump') {
        steps.push({ type: 'jump', to: { surface: nd.s, x: nd.x, y: SURFACES[nd.s].y, z: nd.z } });
      } else {
        if (Math.hypot(cur.x - nd.x, cur.z - nd.z) > 0.02) {
          if (nd.s === 'floor') {
            const pts = this.floorPath(cur, nd);
            if (!pts) return null;
            steps.push({ type: 'walk', surface: 'floor', pts });
          } else {
            steps.push({ type: 'walk', surface: nd.s, pts: [this.clampTo(nd.s, nd.x, nd.z)] });
          }
        }
      }
      cur = nd;
    }
    return steps;
  }
}

// 调试工具：只有网址带 ?dev 时才加载。用来快进模拟、摆镜头、把一段动作连拍成一张图，检查穿模和悬空。
// 在浏览器控制台里用：
//   await dev.ff(() => __room.brain.doing.includes('睡着'), 60)   快进到条件成立（最多 60 秒模拟时间）
//   dev.cam(px, py, pz, tx, ty, tz)                               镜头位置 + 看向哪
//   dev.view(角度, 距离, 高度, 看的高度)                           绕着她摆镜头（角度 0 = 她的正前方）
//   await dev.strip(4, 3, 0.5, () => dev.view(0.6, 1))            连拍 4×3 格，每格间隔 0.5 秒
//   dev.stripOff() / dev.ui(false)                                收起连拍图 / 藏起界面
const R = window.__room;
const mc = new MessageChannel();
let wake = null;
mc.port1.onmessage = () => { const w = wake; wake = null; w?.(); };
const yieldNow = () => new Promise((r) => { wake = r; mc.port2.postMessage(0); });

const overlay = document.createElement('canvas');
overlay.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;display:none;background:#000';
document.body.appendChild(overlay);

const dev = {
  errors: [],
  /** 快进模拟，直到 cond() 成立或超过 maxSec；返回用掉的模拟时间（超时返回负数）。 */
  async ff(cond, maxSec = 60, step = 1 / 30) {
    let t = 0;
    while (t < maxSec) { if (cond()) return t; R.simulate(step); t += step; await yieldNow(); }
    return -t;
  },
  cam(px, py, pz, tx, ty, tz) { R.camera.position.set(px, py, pz); R.controls.target.set(tx, ty, tz); R.controls.update(); },
  view(ang = 0, dist = 0.9, h = 0.35, ty = 0.22) {
    const a = R.actor, y = a.yaw + ang;
    dev.cam(a.pos.x + Math.sin(y) * dist, a.pos.y + h, a.pos.z + Math.cos(y) * dist, a.pos.x, a.pos.y + ty, a.pos.z);
  },
  /** 立刻画一帧（页面在后台、渲染循环停着的时候用）。 */
  shot() { R.simulate(0.0001); R.renderer.render(R.scene, R.camera); },
  async strip(cols, rows, gap, cam) {
    const W = innerWidth || 800, H = innerHeight || 600, cw = W / cols, ch = H / rows;
    overlay.width = W; overlay.height = H; overlay.style.width = W + 'px'; overlay.style.height = H + 'px'; overlay.style.display = 'block';
    const g = overlay.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const labels = [];
    for (let i = 0; i < cols * rows; i++) {
      if (i) await dev.ff(() => false, gap);
      cam?.(i);
      dev.shot();
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      g.drawImage(R.renderer.domElement, x, y, cw, ch);
      g.fillStyle = '#ff0'; g.font = '11px sans-serif'; g.fillText(i + ' ' + R.brain.doing, x + 4, y + 12);
      labels.push(R.brain.doing);
    }
    return labels;
  },
  stripOff() { overlay.style.display = 'none'; },
  ui(show) { for (const el of document.querySelectorAll('body > *')) if (el.tagName !== 'CANVAS' && el.tagName !== 'SCRIPT') el.style.visibility = show ? '' : 'hidden'; },
};
addEventListener('error', (e) => dev.errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => dev.errors.push(String(e.reason?.stack ?? e.reason)));
window.dev = dev;
console.info('[调试] dev 工具已加载：dev.ff / dev.cam / dev.view / dev.strip');

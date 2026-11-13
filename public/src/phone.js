// 手机：房间里一件真实的东西。用完就随手搁在身边（床上、地上、书桌上、窗台上，斜着放也行），睡前才收到枕头边；
// 来 QQ 消息时它在哪儿就在哪儿亮屏、震动、冒出一圈圈光；她过去弯腰拿起来，手机就在她手里（跟着手走），
// 屏幕上是真的聊天内容。趴着刷视频时它斜靠在枕头上。它任何时候都有东西托着：台面、枕头、或者她的手。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { whale, BED_LINE, PILLOW } from './room.js';
import { HOLD } from './animator.js';
import { Carry } from './body.js';

const W = 0.066, H = 0.136, T = 0.0085; // 米
/** 手机平时放的地方：枕头边、靠床沿的床面上，顶端朝床头。被子盖不到这儿。 */
export const PHONE_HOME = { x: -1.6, y: 0.46 + T / 2 + 0.0005, z: -0.845, yaw: Math.PI / 2 + 0.1 };
/** 她拿、放手机时待的位置：床沿，面朝手机，手机就在跟前。 */
export const PHONE_SPOT = { surface: 'bed', x: -1.4, z: -0.81, yaw: -Math.PI / 2 };
/** 趴着看手机时她趴的位置（头朝枕头），以及把手机靠到枕头上 / 从枕头上拿下来时她待的位置。 */
export const PRONE_SPOT = { surface: 'bed', x: -1.06, z: BED_LINE, yaw: -Math.PI / 2 };
export const PILLOW_SPOT = { surface: 'bed', x: -1.33, z: BED_LINE, yaw: -Math.PI / 2 };
const LEAN = 0.35; // 靠在枕头上时往后仰多少（弧度）

const CW = 288, CH = 624; // 屏幕画布
const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const FEED = [['🐳', '#2b6cff', '今天的鲸鱼也很努力'], ['🍰', '#ff8fb3', '一口下去超满足'], ['🎮', '#7a5cff', '这关我过了三十次'], ['🌧️', '#4a78b8', '下雨天适合发呆'], ['🎵', '#18b8a0', '单曲循环中'], ['🐱', '#ffb04a', '猫猫教你伸懒腰'], ['⭐', '#3c4fd8', '许个愿吧']];

/** 圆角矩形平面，贴图坐标铺满 0~1。 */
function roundedPlane(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(s, 6), p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return geo;
}

/** 按宽度折行，最多 maxLines 行，放不下的用省略号。 */
function wrapText(g, text, maxW, maxLines) {
  const lines = []; let cur = '';
  for (const ch of String(text)) {
    if (ch === '\n' || g.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch === '\n' ? '' : ch; if (lines.length === maxLines) break; } else cur += ch;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  else if (lines.length === maxLines && cur) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  return lines;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

export function buildPhone(scene) {
  const group = new THREE.Group(); group.name = 'phone';
  const shake = new THREE.Group(); group.add(shake);

  // 机身（带壳）
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x9cc7ff, roughness: 0.42, metalness: 0.05 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, T, 5, T * 0.48), caseMat);
  body.castShadow = true; body.name = 'phone'; shake.add(body);
  // 正面：黑边框 + 屏幕
  const bezel = new THREE.Mesh(roundedPlane(W - 0.002, H - 0.002, 0.0085), new THREE.MeshStandardMaterial({ color: 0x06070b, roughness: 0.22 }));
  bezel.position.z = T / 2 + 0.0002; shake.add(bezel);
  const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const screenMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const screen = new THREE.Mesh(roundedPlane(W - 0.0075, H - 0.0075, 0.0066), screenMat);
  screen.position.z = T / 2 + 0.0005; screen.name = 'phone'; shake.add(screen);
  // 背面：摄像头 + 小鲸鱼贴纸
  const island = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.024, 0.0022, 3, 0.001), new THREE.MeshStandardMaterial({ color: 0x86b4f2, roughness: 0.35 }));
  island.position.set(0.016, H / 2 - 0.02, -T / 2 - 0.0008); shake.add(island);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.12, metalness: 0.4 });
  for (const [x, y] of [[0.011, 0.005], [0.021, -0.005]]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.0016, 20).rotateX(Math.PI / 2), lensMat);
    lens.position.set(x, H / 2 - 0.02 + y, -T / 2 - 0.0022); shake.add(lens);
  }
  const sticker = (() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(80, 80, 74, 0, Math.PI * 2); g.fill();
    g.translate(78, 88); g.scale(1.35, 1.35); whale(g, '#2f55d0', '#cfe0ff');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.019, 32), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    m.rotation.y = Math.PI; m.position.set(0, -0.014, -T / 2 - 0.0003);
    return m;
  })();
  shake.add(sticker);
  // 屏幕的光
  const light = new THREE.PointLight(0xa8c8ff, 0, 0.8, 0); light.position.set(0, 0, 0.11); group.add(light);
  // 来消息时的一圈圈光
  const rings = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.0345, 48), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.z = T / 2 + 0.003; m.visible = false; group.add(m); return m;
  });

  const homePos = new THREE.Vector3(PHONE_HOME.x, PHONE_HOME.y, PHONE_HOME.z);
  const homeQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), PHONE_HOME.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  // 拿在手里：屏幕朝着她的脸，上沿略微朝外。位置以左手为准（胸口朝向下的偏移，模型单位）
  const holdOff = new THREE.Vector3(HOLD.phone.at[0] - HOLD.phone.L[0], HOLD.phone.at[1] - HOLD.phone.L[1], HOLD.phone.at[2] - HOLD.phone.L[2]);
  const holdQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0.8, 0.6), new THREE.Vector3(0, 0.6, -0.8)));
  // 斜靠在枕头朝床尾的那一面上：下沿立在床面，背面顶着枕头的圆边，屏幕朝着趴在对面的她
  const propPos = new THREE.Vector3(), propQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-LEAN, Math.PI / 2, 0, 'YXZ'));
  {
    const cx = PILLOW.faceX - PILLOW.r + 0.005, cy = PILLOW.y + 0.011, r = PILLOW.r + T / 2; // 枕头那一头的圆边
    const nx = Math.cos(LEAN), ny = Math.sin(LEAN), y0 = 0.46 + T / 2;
    const xb = cx + (r - (y0 - cy) * ny) / nx; // 手机下沿的 x：让手机的背面正好和圆边相切
    propPos.set(xb - Math.sin(LEAN) * H / 2, y0 + Math.cos(LEAN) * H / 2, BED_LINE);
  }
  scene.add(group); group.position.copy(homePos); group.quaternion.copy(homeQuat);
  const carry = new Carry(group);
  const _sq = new THREE.Quaternion();
  // 举起来拍东西：横着端在胸前（下巴底下，不挡脸），屏幕朝她，背面的摄像头对着要拍的东西（胸口坐标，模型单位）
  const AIM_AT = new THREE.Vector3(0, 0.72, 0.31);
  const UP = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _am = new THREE.Matrix4();
  /** 拍照时两只手捏着的地方（手机两头，世界坐标）：每帧更新，手跟着它走。 */
  const gripL = new THREE.Vector3(), gripR = new THREE.Vector3();
  let aimBody = null;

  const st = { state: 'idle', rest: { kind: 'home', surface: 'bed', x: PHONE_HOME.x, z: PHONE_HOME.z }, mode: 'off', on: 0, target: 0, messages: [], notes: [], count: 0, typing: false, ringT: 0, feedK: 0, offAt: Infinity, minute: '', now: 0 };

  function redraw() {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    if (st.mode === 'off') {
      g.fillStyle = '#05070d'; g.fillRect(0, 0, CW, CH);
    } else if (st.mode === 'lock') {
      const bg = g.createLinearGradient(0, 0, CW, CH); bg.addColorStop(0, '#1d3a9a'); bg.addColorStop(0.55, '#4b3aa8'); bg.addColorStop(1, '#141a48');
      g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
      const d = new Date(), hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
      st.minute = hh + mm;
      g.fillStyle = '#ffffff'; g.textAlign = 'center';
      g.font = `600 22px ${FONT}`; g.fillText(`${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`, CW / 2, 96);
      g.font = `700 88px ${FONT}`; g.fillText(`${hh}:${mm}`, CW / 2, 186);
      g.textAlign = 'left';
      let y = 262;
      st.notes.slice(-3).forEach((text) => {
        g.font = `24px ${FONT}`;
        const lines = wrapText(g, text, CW - 104, 2), h = 62 + lines.length * 30;
        g.fillStyle = 'rgba(255,255,255,0.93)'; rr(g, 14, y, CW - 28, h, 20); g.fill();
        g.fillStyle = '#12b7f5'; g.beginPath(); g.arc(46, y + 34, 20, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = `700 22px ${FONT}`; g.textAlign = 'center'; g.fillText('Q', 46, y + 42); g.textAlign = 'left';
        g.fillStyle = '#6a7388'; g.font = `600 20px ${FONT}`; g.fillText('QQ · 主人', 78, y + 32);
        g.fillStyle = '#16192a'; g.font = `24px ${FONT}`; lines.forEach((l, i) => g.fillText(l, 78, y + 62 + i * 30));
        y += h + 12;
      });
      if (st.count > 3) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = `20px ${FONT}`; g.textAlign = 'center'; g.fillText(`还有 ${st.count - 3} 条消息`, CW / 2, y + 22); g.textAlign = 'left'; }
      g.fillStyle = 'rgba(255,255,255,0.75)'; rr(g, CW / 2 - 52, CH - 22, 104, 6, 3); g.fill();
    } else if (st.mode === 'camera') { // 相机取景（从她那一面看得到）
      const bg = g.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, '#2b3a5c'); bg.addColorStop(1, '#141a2c');
      g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
      for (const k of [1, 2]) { g.beginPath(); g.moveTo((CW * k) / 3, 70); g.lineTo((CW * k) / 3, CH - 120); g.stroke(); g.beginPath(); g.moveTo(0, 70 + ((CH - 190) * k) / 3); g.lineTo(CW, 70 + ((CH - 190) * k) / 3); g.stroke(); }
      g.fillStyle = '#05070d'; g.fillRect(0, CH - 120, CW, 120); g.fillRect(0, 0, CW, 70);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(CW / 2, CH - 60, 32, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#05070d'; g.lineWidth = 4; g.beginPath(); g.arc(CW / 2, CH - 60, 26, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffd257'; g.font = `600 20px ${FONT}`; g.textAlign = 'center'; g.fillText('照片', CW / 2, 44); g.textAlign = 'left';
    } else if (st.mode === 'chat') {
      g.fillStyle = '#eceef3'; g.fillRect(0, 0, CW, CH);
      // 输入栏
      g.fillStyle = '#f8f9fb'; g.fillRect(0, CH - 70, CW, 70);
      g.fillStyle = '#ffffff'; rr(g, 14, CH - 56, CW - 84, 40, 20); g.fill();
      g.fillStyle = '#12b7f5'; g.beginPath(); g.arc(CW - 36, CH - 36, 20, 0, Math.PI * 2); g.fill();
      // 气泡：从下往上排
      let y = CH - 84;
      const items = st.typing ? [...st.messages, { mine: true, text: '···', dots: true }] : st.messages;
      for (let k = items.length - 1; k >= 0 && y > 84; k--) {
        const m = items[k];
        g.font = `24px ${FONT}`;
        const lines = wrapText(g, m.text, 168, 4), bw = Math.max(...lines.map((l) => g.measureText(l).width), 26) + 28, bh = lines.length * 30 + 20;
        const x = m.mine ? CW - 58 - bw : 58;
        y -= bh;
        g.fillStyle = m.mine ? '#12b7f5' : '#ffffff'; rr(g, x, y, bw, bh, 16); g.fill();
        g.fillStyle = m.mine ? '#ffffff' : '#1a1d2b'; lines.forEach((l, i) => g.fillText(l, x + 14, y + 34 + i * 30));
        g.fillStyle = m.mine ? '#3b6fe0' : '#aab3c8'; g.beginPath(); g.arc(m.mine ? CW - 30 : 30, y + 20, 18, 0, Math.PI * 2); g.fill();
        y -= 14;
      }
      // 标题栏（最后画，盖住滚上去的气泡）
      g.fillStyle = '#f8f9fb'; g.fillRect(0, 0, CW, 72);
      g.fillStyle = '#16192a'; g.font = `700 26px ${FONT}`; g.textAlign = 'center'; g.fillText('主人', CW / 2, 48); g.textAlign = 'left';
      g.strokeStyle = '#16192a'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(28, 26); g.lineTo(18, 38); g.lineTo(28, 50); g.stroke();
    } else { // feed：刷短视频
      const [emoji, color, caption] = FEED[st.feedK % FEED.length];
      const bg = g.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, color); bg.addColorStop(1, '#10122a');
      g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
      g.font = `150px ${FONT}`; g.textAlign = 'center'; g.fillText(emoji, CW / 2, CH / 2 + 30);
      g.fillStyle = '#ffffff'; g.font = `600 24px ${FONT}`; g.textAlign = 'left'; g.fillText(caption, 18, CH - 62);
      g.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(CW - 34, CH - 250 + i * 62, 18, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, CH - 8, CW, 8); g.fillStyle = '#fff'; g.fillRect(0, CH - 8, CW * (0.2 + (st.feedK % 5) * 0.15), 8);
    }
    tex.needsUpdate = true;
  }

  const api = {
    group, home: PHONE_HOME,
    /** idle 放着 | ring 放着、正在响 | held 在她手里 */
    get state() { return st.state; },
    /** 没在手里时它放在哪：{ kind: home 枕头边 | pillow 靠在枕头上 | flat 随手平放, surface 哪个台面, x, z }。 */
    get rest() { return st.rest; },
    get screenOn() { return st.target > 0; },
    /** 手机现在的世界坐标。 */
    worldPos(out = new THREE.Vector3()) { return group.getWorldPosition(out); },
    /** 来消息了：没拿在手里就亮屏、震动、显示通知。 */
    ring(text) {
      st.notes.push(text); st.count++;
      if (st.notes.length > 3) st.notes.shift();
      if (st.state === 'held') return;
      st.state = 'ring'; st.mode = 'lock'; st.target = 1; st.ringT = 0; st.offAt = Infinity;
      redraw();
    },
    /** 聊天记录里加一条（mine=true 是她发的）。 */
    push(mine, text) {
      st.messages.push({ mine, text: text || '…' });
      while (st.messages.length > 12) st.messages.shift();
      if (st.mode === 'chat') redraw();
    },
    setTyping(v) { if (st.typing !== v) { st.typing = v; if (st.mode === 'chat') redraw(); } },
    /**
     * 举起来对着某一点准备拍照（手机横着端在胸前，摄像头朝那一点）。之后用 gripL / gripR 让两只手捏住它，
     * 用 lens() 取镜头的位置。拍完调 hold() 收回手里。
     * @param target 要拍的那一点（世界坐标；之后改它的值，手机会跟着转过去）
     */
    aim(body, target) {
      st.state = 'held'; st.mode = 'camera'; st.target = 1; st.offAt = Infinity; aimBody = body;
      redraw();
      carry.to((pos, quat) => {
        body.toWorld('spine', AIM_AT, pos);
        _az.subVectors(pos, target).normalize(); // 屏幕的朝向：从要拍的东西指回她
        _ay.crossVectors(UP, _az); if (_ay.lengthSq() < 1e-6) _ay.set(Math.cos(body.yaw), 0, -Math.sin(body.yaw)); _ay.normalize(); // 长边水平：横着拿
        _ax.crossVectors(_ay, _az).normalize();
        quat.setFromRotationMatrix(_am.makeBasis(_ax, _ay, _az));
      }, 0.4, 0.015);
    },
    gripL, gripR,
    /** 背面摄像头的位置，和它朝着的方向（世界坐标）。 */
    lens(outPos = new THREE.Vector3(), outDir = new THREE.Vector3()) {
      group.updateMatrixWorld();
      outPos.set(0, 0, -T / 2 - 0.004).applyMatrix4(group.matrixWorld);
      outDir.set(0, 0, -1).transformDirection(group.matrixWorld);
      return { pos: outPos, dir: outDir };
    },
    /** 拿到手里（之后一直跟着她的手）。mode: chat 看聊天 | feed 刷视频。 */
    hold(body, mode = 'chat') {
      aimBody = null;
      st.state = 'held'; st.mode = mode; st.target = 1; st.offAt = Infinity;
      if (mode === 'chat') { st.notes.length = 0; st.count = 0; }
      redraw();
      carry.to((pos, quat) => { body.inLeftHand(holdOff, pos); quat.copy(body.quat('spine', _sq)).multiply(holdQuat); }, 0.3, 0.025);
    },
    /** 屏幕上换成聊天 / 刷视频。 */
    show(mode) { if (st.mode !== mode) { st.mode = mode; st.target = 1; st.offAt = Infinity; if (mode === 'chat') { st.notes.length = 0; st.count = 0; } redraw(); } },
    /** 靠到枕头上（趴着刷视频时）。 */
    lean() {
      aimBody = null;
      st.state = 'idle'; st.rest = { kind: 'pillow', surface: 'bed', x: propPos.x, z: propPos.z }; st.mode = 'feed'; st.target = 1; st.offAt = Infinity; st.typing = false;
      redraw(); carry.to((pos, quat) => { pos.copy(propPos); quat.copy(propQuat); }, 0.4, 0.03);
    },
    /** 划到下一条视频。 */
    swipe() { st.feedK++; if (st.mode === 'feed') redraw(); },
    /** 放回枕头边（睡前）；过一会儿自动熄屏。 */
    putHome() {
      aimBody = null;
      st.state = 'idle'; st.rest = { kind: 'home', surface: 'bed', x: PHONE_HOME.x, z: PHONE_HOME.z }; st.typing = false; st.offAt = st.now + 2.5;
      carry.to((pos, quat) => { pos.copy(homePos); quat.copy(homeQuat); }, 0.35, 0.03);
    },
    /**
     * 随手平放在某个台面上（屏幕朝上）；过一会儿自动熄屏。
     * @param surface 台面名（floor / bed / desk / sill）
     * @param top 台面的高度
     * @param yaw 手机顶端朝哪（绕竖轴的角度）
     */
    putDown(surface, x, z, top, yaw) {
      aimBody = null;
      st.state = 'idle'; st.rest = { kind: 'flat', surface, x, z }; st.typing = false; st.offAt = st.now + 2.5;
      const p = new THREE.Vector3(x, top + T / 2 + 0.0005, z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      carry.to((pos, quat) => { pos.copy(p); quat.copy(q); }, 0.35, 0.03);
    },
    /** 熄屏（放着不看了）。 */
    sleep() { if (st.state === 'idle') st.offAt = st.now + 1.5; },
    /** 还在从一处移到另一处的半路上。 */
    get moving() { return carry.moving; },
    /** 每帧调用。dark：0 白天 ~ 1 深夜。 */
    update(dt, now, dark) {
      st.now = now;
      carry.update(dt);
      if (aimBody) { // 手机两头：靠她左手那头给左手，另一头给右手
        group.updateMatrixWorld();
        const lx = Math.cos(aimBody.yaw), lz = -Math.sin(aimBody.yaw);
        gripL.set(0, H * 0.44, 0).applyMatrix4(group.matrixWorld); gripR.set(0, -H * 0.44, 0).applyMatrix4(group.matrixWorld);
        if ((gripL.x - gripR.x) * lx + (gripL.z - gripR.z) * lz < 0) { _ax.copy(gripL); gripL.copy(gripR); gripR.copy(_ax); }
      }
      if (st.state === 'idle' && now >= st.offAt) { st.target = 0; st.offAt = Infinity; }
      st.on += (st.target - st.on) * (1 - Math.exp(-dt * 9));
      if (st.target === 0 && st.on < 0.02 && st.mode !== 'off') { st.mode = 'off'; redraw(); }
      screenMat.color.setScalar(st.mode === 'off' ? 1 : 0.05 + st.on * 1.15);
      light.intensity = st.on * (0.16 + dark * 0.8);
      const ringing = st.state === 'ring';
      if (ringing) {
        st.ringT += dt;
        const c = st.ringT % 2.2, e = c < 0.75 ? Math.sin((c / 0.75) * Math.PI) : 0;
        shake.rotation.z = Math.sin(st.ringT * 78) * 0.06 * e; shake.position.x = Math.sin(st.ringT * 63) * 0.0016 * e;
        if (st.mode === 'lock') { const d = new Date(), mm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); if (mm !== st.minute) redraw(); }
      } else { shake.rotation.z = 0; shake.position.x = 0; }
      rings.forEach((m, i) => {
        m.visible = ringing;
        if (!ringing) return;
        const ph = (st.ringT * 0.75 + i * 0.5) % 1;
        m.scale.setScalar(1 + ph * 3.2); m.material.opacity = (1 - ph) * 0.8;
      });
    },
  };
  redraw();
  return api;
}

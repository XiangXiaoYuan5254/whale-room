// 房间里的小东西：床头墙上的月亮夜灯、窗台上的鲸鱼玩偶、床边的拖鞋、桌上的杯子和点心。
// 都摆在她不会走到的地方（墙上、枕头上、床沿底下、桌角），所以不用改寻路。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const std = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
function ball(parent, rx, ry, rz, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  m.scale.set(rx, ry, rz); m.position.set(x, y, z); m.castShadow = true; parent.add(m);
  return m;
}

export function buildDecor(scene) {
  const g = new THREE.Group(); g.name = 'decor'; scene.add(g);

  // ---------- 月亮夜灯（床头那面墙上，天黑自己亮） ----------
  const moon = new THREE.Group(); moon.position.set(-2.075, 1.12, -1.1); moon.rotation.y = Math.PI / 2; g.add(moon);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.13, Math.PI * 0.32, Math.PI * 1.68, false);
  shape.absarc(0.075, 0, 0.105, Math.PI * 1.42, Math.PI * 0.58, true);
  const moonMat = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffc66e, emissiveIntensity: 0.1, roughness: 0.6 });
  const crescent = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3, curveSegments: 36 }), moonMat);
  crescent.rotation.z = -0.35; moon.add(crescent);
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.014 : 0.034; if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.012, bevelEnabled: false });
  for (const [x, y, s] of [[0.19, 0.1, 1], [0.24, -0.06, 0.7], [0.13, -0.15, 0.55]]) { const st = new THREE.Mesh(starGeo, moonMat); st.position.set(x, y, 0); st.scale.setScalar(s); moon.add(st); }
  const moonLight = new THREE.PointLight(0xffc98a, 0, 2.8, 1.5); moonLight.position.set(-1.86, 1.1, -1.1); g.add(moonLight);

  // ---------- 鲸鱼玩偶（坐在窗台靠床头的角上；放枕头上会和她睡觉时的头叠在一起） ----------
  const plush = new THREE.Group(); plush.position.set(-1.71, 1.045, -1.62); plush.rotation.set(0, 0.35, 0); g.add(plush);
  const navy = std(0x4667d6, 0.95), belly = std(0xdfe9ff, 0.95);
  ball(plush, 0.105, 0.075, 0.075, navy, 0, 0, 0);
  ball(plush, 0.095, 0.05, 0.068, belly, 0.006, -0.03, 0);
  ball(plush, 0.05, 0.03, 0.03, navy, -0.125, 0.012, 0).rotation.z = 0.5;
  for (const s of [-1, 1]) {
    ball(plush, 0.04, 0.012, 0.028, navy, -0.17, 0.045, s * 0.03).rotation.set(0, s * 0.6, 0.3);
    ball(plush, 0.03, 0.01, 0.022, navy, 0.02, -0.035, s * 0.075).rotation.set(s * 0.5, 0, -0.2);
    ball(plush, 0.009, 0.011, 0.006, std(0x14183a, 0.4), 0.07, 0.012, s * 0.058);
    ball(plush, 0.016, 0.009, 0.005, std(0xff9fb5, 0.9), 0.052, -0.012, s * 0.066);
  }

  // ---------- 拖鞋（床沿底下露出一半） ----------
  const slipperMat = std(0xf3f5fb, 0.95), toeMat = std(0x7fa8f5, 0.95);
  for (const [x, z, yaw] of [[-0.56, -0.685, 0.12], [-0.45, -0.69, -0.1]]) {
    const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = yaw; g.add(s);
    const sole = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.018, 0.15, 3, 0.008), slipperMat); sole.position.y = 0.009; sole.receiveShadow = true; s.add(sole);
    ball(s, 0.04, 0.026, 0.05, toeMat, 0, 0.03, 0.045);
  }

  // ---------- 桌角：马克杯 + 一小碟饼干 ----------
  // 桌面范围是 x 0.55~2.02、z -1.76~-1.04、高 0.74；她在桌上只在 x ≥ 0.9 那一段活动，所以放在桌子左前角
  const desk = new THREE.Group(); desk.position.set(0.79, 0.74, -1.14); g.add(desk);
  const mugMat = std(0xbcd6ff, 0.5);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.027, 0.062, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xbcd6ff, roughness: 0.5, side: THREE.DoubleSide }));
  mug.position.y = 0.031; mug.castShadow = true; desk.add(mug);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.027, 24).rotateX(-Math.PI / 2), mugMat); bottom.position.y = 0.002; desk.add(bottom);
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.028, 24).rotateX(-Math.PI / 2), std(0x9a5b34, 0.3)); tea.position.y = 0.052; desk.add(tea);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.005, 8, 20, Math.PI), mugMat); handle.rotation.z = -Math.PI / 2; handle.position.set(0.03, 0.031, 0); desk.add(handle);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.008, 28), std(0xfafbff, 0.4)); plate.position.set(-0.11, 0.004, 0.02); plate.receiveShadow = true; desk.add(plate);
  const cookieMat = std(0xd9a55c, 0.9), chip = std(0x5a3620, 0.8);
  for (const [x, z, y, r] of [[-0.122, 0.012, 0.012, 0.2], [-0.096, 0.03, 0.013, 1.1], [-0.108, 0.02, 0.021, 2.3]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.007, 16), cookieMat); c.position.set(x, y, z); c.rotation.y = r; c.castShadow = true; desk.add(c);
    for (const [dx, dz] of [[0.007, 0.004], [-0.006, 0.007], [0.001, -0.008]]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 6, 5), chip); d.position.set(x + dx, y + 0.004, z + dz); desk.add(d); }
  }
  // 茶上面飘的热气
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const steam = [0, 1, 2].map((i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), steamMat.clone()); m.userData.ph = i / 3; desk.add(m); return m; });

  // ---------- 墙上的画像（用的是三视图里的正面那张） ----------
  const frame = new THREE.Group(); frame.position.set(-2.086, 1.34, -0.42); frame.rotation.y = Math.PI / 2; g.add(frame);
  const fw = 0.34, fh = 0.42;
  const border = new THREE.Mesh(new RoundedBoxGeometry(fw + 0.05, fh + 0.05, 0.022, 3, 0.008), std(0xf4ead8, 0.6)); border.castShadow = true; frame.add(border);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  art.position.z = 0.0116; frame.add(art);
  new THREE.TextureLoader().load('/assets/portrait.png', (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.repeat.set(0.68, 0.68 * (fh / fw)); t.offset.set(0.16, 0.08); // 只取人物那一块
    art.material.map = t; art.material.needsUpdate = true;
  }, undefined, () => console.warn('[摆设] 画像 /assets/portrait.png 没加载出来，相框里是空的'));

  // ---------- 电脑桌上方墙上的「坚定」海报（横幅，深色细框，配它暗金色的画风） ----------
  // 后墙，夹在左边的软木板、上面的隔板、右边的台灯、下面的笔记本中间：x 1.06~1.6、y 1.11~1.59
  const poster = new THREE.Group(); poster.position.set(1.33, 1.35, -1.786); g.add(poster);
  const pw = 0.5, ph = pw * (911 / 1024);
  const pBorder = new THREE.Mesh(new RoundedBoxGeometry(pw + 0.036, ph + 0.036, 0.02, 3, 0.006), std(0x2b2520, 0.55)); pBorder.castShadow = true; poster.add(pBorder);
  const pArt = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.75 }));
  pArt.position.z = 0.0106; poster.add(pArt);
  new THREE.TextureLoader().load('/assets/poster-jianding.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    pArt.material.color.set(0xffffff); pArt.material.map = t; pArt.material.needsUpdate = true;
  }, undefined, () => console.warn('[摆设] 海报 /assets/poster-jianding.jpg 没加载出来，框里是空的'));

  // ---------- 窗台角落的小仙人掌 ----------
  const pot = new THREE.Group(); pot.position.set(0.02, 0.972, -1.6); g.add(pot);
  const potM = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.027, 0.05, 20), std(0xe9ded0, 0.8)); potM.position.y = 0.025; potM.castShadow = true; pot.add(potM);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.033, 20).rotateX(-Math.PI / 2), std(0x5b4636, 1)); soil.position.y = 0.049; pot.add(soil);
  const cactus = std(0x6fb98a, 0.9);
  ball(pot, 0.024, 0.042, 0.024, cactus, 0, 0.085, 0);
  ball(pot, 0.012, 0.02, 0.012, cactus, 0.026, 0.078, 0.004);
  ball(pot, 0.007, 0.007, 0.007, std(0xff9fb5, 0.8), 0.002, 0.129, 0);

  // ---------- 压在地上的软影子：墙角一圈、床和书桌底下。夜里台灯不投影，靠它们让家具「落地」 ----------
  const shadowTex = (kind) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    if (kind === 'edge') { const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(12,12,30,0.5)'); gr.addColorStop(1, 'rgba(12,12,30,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); }
    else { for (let i = 0; i < 26; i++) { x.fillStyle = 'rgba(12,12,30,0.035)'; x.beginPath(); x.roundRect(i * 1.6, i * 1.6, 128 - i * 3.2, 128 - i * 3.2, 26 - i * 0.5); x.fill(); } }
    return new THREE.CanvasTexture(c);
  };
  const flat = (w, d, x, z, tex, ry = 0, opacity = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(x, 0.003, z); m.rotation.y = ry; m.raycast = () => {}; g.add(m);
    return m;
  };
  const edge = shadowTex('edge'), blobT = shadowTex('blob');
  flat(4.2, 0.34, 0, -1.63, edge); // 后墙墙根
  flat(3.6, 0.34, -1.93, 0, edge, Math.PI / 2); // 左墙墙根
  flat(2.5, 1.5, -1.02, -1.2, blobT, 0, 0.9); // 床
  flat(1.6, 1.1, 1.18, -1.32, blobT, 0, 0.8); // 书桌

  let glow = 0;
  return {
    group: g, moonLight,
    /** dark：0 白天 ~ 1 深夜；now：模拟时间（秒）。 */
    update(dark, now, dt) {
      const want = dark > 0.35 ? 1 : 0;
      glow += (want - glow) * (1 - Math.exp(-dt * 2.5));
      moonMat.emissiveIntensity = 0.08 + glow * 0.62;
      moonLight.intensity = glow * 1.7;
      for (const m of steam) {
        const p = (now * 0.22 + m.userData.ph) % 1;
        m.position.set(Math.sin(p * 7 + m.userData.ph * 9) * 0.008, 0.06 + p * 0.09, Math.cos(p * 5) * 0.006);
        m.scale.setScalar(0.5 + p * 1.1); m.material.opacity = Math.sin(p * Math.PI) * 0.2;
      }
    },
  };
}

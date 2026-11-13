// 小音箱：放在前墙根的地上。她过去按一下，这台 Mac 的「音乐」App 就开始放歌单（声音从电脑的音响出来，不是网页合成的）；
// 放歌时音箱会一鼓一鼓，冒出音符。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 音箱的位置，以及它占的地方（寻路要绕开）：[x, z, 半径]。 */
export const SPEAKER = { x: 0.78, z: 1.72 };
export const SPEAKER_CIRCLE = [SPEAKER.x, SPEAKER.z, 0.08];

export function buildSpeaker(scene) {
  const g = new THREE.Group(); g.name = 'speaker'; g.position.set(SPEAKER.x, 0, SPEAKER.z); g.rotation.y = Math.PI; scene.add(g); // 正面朝房间里
  const std = (color, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.1, 0.075, 4, 0.018), std(0xf3ead8, 0.55)); body.position.y = 0.056; body.castShadow = true; body.receiveShadow = true; body.name = 'speaker'; g.add(body);
  for (const x of [-0.05, 0.05]) { const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.008, 10), std(0x5e3b26)); foot.position.set(x, 0.004, 0); g.add(foot); }
  const cloth = new THREE.Mesh(new THREE.CircleGeometry(0.036, 32), std(0x3d5aa8, 0.95)); cloth.position.set(-0.03, 0.056, 0.0378); g.add(cloth);
  const cone = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), std(0x24325f, 0.6)); cone.position.set(-0.03, 0.056, 0.0382); g.add(cone);
  const tweeter = new THREE.Mesh(new THREE.CircleGeometry(0.013, 20), std(0x3d5aa8, 0.95)); tweeter.position.set(0.04, 0.075, 0.0378); g.add(tweeter);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x55607a, toneMapped: false });
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), ledMat); led.position.set(0.04, 0.04, 0.0378); g.add(led);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 16), std(0x8fb6f5, 0.4)); knob.position.set(0.03, 0.11, 0); g.add(knob);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.004, 8, 20, Math.PI), std(0x8a5a3a)); handle.position.set(-0.02, 0.104, 0); g.add(handle);
  // 音符
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.font = '52px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText('♪', 32, 34);
    return new THREE.CanvasTexture(c);
  })();
  const notes = [0, 1, 2].map((i) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: [0x9fd0ff, 0xffb3c8, 0xffe08a][i], transparent: true, opacity: 0, depthWrite: false }));
    m.scale.setScalar(0.05); m.userData.ph = i / 3; m.raycast = () => {}; scene.add(m); return m;
  });
  const st = { playing: false, k: 0 };
  return {
    group: g, x: SPEAKER.x, z: SPEAKER.z,
    /** 顶上的按钮（她伸手去按的地方，世界坐标）。 */
    button: new THREE.Vector3(SPEAKER.x - 0.03, 0.114, SPEAKER.z),
    get playing() { return st.playing; },
    setPlaying(on) { st.playing = Boolean(on); },
    /** 每帧调用。now：模拟时间（秒）。 */
    update(dt, now) {
      st.k += ((st.playing ? 1 : 0) - st.k) * (1 - Math.exp(-dt * 4));
      const beat = Math.abs(Math.sin(now * 5.2)) * st.k;
      body.scale.set(1 + beat * 0.02, 1 + beat * 0.035, 1); cone.scale.setScalar(1 + beat * 0.25);
      ledMat.color.setHex(st.playing ? 0x6dff9c : 0x55607a);
      for (const m of notes) {
        const p = (now * 0.28 + m.userData.ph) % 1;
        m.position.set(SPEAKER.x + Math.sin(p * 6 + m.userData.ph * 9) * 0.05, 0.14 + p * 0.3, SPEAKER.z - 0.05 - p * 0.05);
        m.material.opacity = st.k * Math.sin(p * Math.PI) * 0.95; m.visible = st.k > 0.02;
      }
    },
  };
}

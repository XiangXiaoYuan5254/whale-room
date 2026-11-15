// 入口：把房间、环境、角色、大脑、界面、网络接到一起，跑渲染循环。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildRoom } from './room.js';
import { Environment } from './env.js';
import { buildCharacter } from './character.js';
import { attachModel } from './model.js';
import { buildPhone } from './phone.js';
import { buildDecor } from './decor.js';
import { buildKitchen } from './kitchen.js';
import { buildSpeaker } from './speaker.js';
import { buildSpear } from './spear.js';
import { Sound } from './sound.js';
import { Animator } from './animator.js';
import { Body } from './body.js';
import { Nav } from './nav.js';
import { Actor } from './actor.js';
import { Ball } from './ball.js';
import { Brain } from './brain.js';
import { UI, Picker } from './ui.js';
import { Clock, damp, lerp } from './util.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 60);
const HOME = { pos: new THREE.Vector3(2.4, 3.3, 4.7), target: new THREE.Vector3(-0.1, 0.5, -0.3) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.maxPolarAngle = 1.52;
controls.minDistance = 0.35; controls.maxDistance = 11;
// 滚轮 / 触控板往鼠标指着的地方缩放（想看哪个角落，就把鼠标放在那儿往前滚）；右键拖动或按住 Shift 拖动是平移
controls.zoomToCursor = true;
controls.update();
/** 镜头看着的那一点别跑出房间（平移、往角落缩放时），不然一转镜头房间就甩出画面了。 */
const LOOK_BOX = new THREE.Box3(new THREE.Vector3(-2.0, 0, -1.7), new THREE.Vector3(2.0, 2.2, 1.7));

// ---------- 世界 ----------
const room = buildRoom(scene);
const env = new Environment(scene, room);
const char = buildCharacter();
scene.add(char.root);

const clock = new Clock();
const nav = new Nav();
const body = new Body(char);
const anim = new Animator(char, body);
const actor = new Actor(char, anim, nav, clock);
const ball = new Ball(room.ball, nav);
const ui = new UI(clock);
const phone = buildPhone(scene);
const decor = buildDecor(scene);
const kitchen = buildKitchen(scene);
const speaker = buildSpeaker(scene);
const spear = buildSpear(scene);
const sound = new Sound();
const brain = new Brain({ char, body, anim, actor, nav, room, env, ui, clock, camera, ball, phone, kitchen, speaker, spear });
brain.sfx = (name, k) => sound.play(name, k);

// ---------- 外部模型：public/models/ 里放了 .glb 就换上；没有就用内置的几何体角色 ----------
// 调试：?model=/models/dev/xxx.glb 指定模型，?model=off 强制用内置角色，?rig 显示骨骼位置
const query = new URLSearchParams(location.search);
let skin = null;
async function loadSkin() {
  const pick = query.get('model');
  if (pick === 'off') return;
  let info;
  if (pick) {
    const r = await fetch(pick.replace(/\.glb$/i, '.rig.json'));
    info = { url: pick, rig: r.ok ? await r.json() : null };
  } else {
    info = await (await fetch('/api/model')).json();
  }
  if (info.error) console.warn('[模型] ' + info.error);
  if (!info.url) return;
  skin = await attachModel(char, info, { debug: query.has('rig'), anisotropy: renderer.capabilities.getMaxAnisotropy() });
  body.setSkin(skin);
  console.info(`[模型] 已换上 ${info.url}：${skin.stats.tris.toLocaleString()} 个三角形，绑骨用时 ${skin.stats.skinMs} ms`);
}

// ---------- 脚下的接触阴影：一小团软影子，让她「踩」在地上、「坐」在床上 ----------
const blob = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(10,12,30,0.62)'); gr.addColorStop(0.55, 'rgba(10,12,30,0.28)'); gr.addColorStop(1, 'rgba(10,12,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.renderOrder = 1; m.raycast = () => {};
  scene.add(m);
  return m;
})();
let blobY = 0, blobA = 1;

// ---------- 后期（夜里的辉光） ----------
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.7, 1.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
let useComposer = true;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------- 界面事件 ----------
let follow = false;
let resetCam = 0;
ui.on('act', (action, target) => brain.command({ action, target }));
ui.on('time', (mode) => env.setTimeMode(mode));
ui.on('weather', (mode) => env.setWeatherMode(mode));
ui.on('lamp', () => {
  const on = !room.lamp.on;
  room.lamp.set(on); ui.setLamp(on);
  brain.lampOptOutUntil = on ? 0 : clock.now + 30 * 60;
});
ui.on('follow', (on) => { follow = on; });
ui.on('sound', () => sound.enable(!sound.on).then(() => ui.setSound(sound.on)));
sound.armAutostart((on) => ui.setSound(on));
ui.on('reset', () => { follow = false; resetCam = 1; });
ui.on('test', (kind, text) => {
  fetch('/api/mock/qq', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'poke' ? { kind: 'poke' } : { dir: kind, text }) })
    .catch((err) => console.warn('测试消息没发出去', err));
});
new Picker(canvas, camera, scene, (name, point) => brain.onPick(name, point));

// ---------- 和本地服务通信：QQ 事件、身体指令、状态上报 ----------
// 这个页面自己的 id：服务靠它分清哪个页面醒着、哪个被浏览器冻住了（开着多个页面时也不会搞混）
const PAGE_ID = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
let greeted = false;
/** 接口带了 wait 的指令：做完 / 到位 / 被打断时把结果告诉本地服务，它再回给在等的那一边（她的 AI 本体）。 */
function reportAct(id, result) {
  fetch('/api/act/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, result }) })
    .catch((err) => console.warn('没能把动作的结果报给本地服务', err));
}
function connect() {
  const es = new EventSource('/events?page=' + PAGE_ID);
  es.onmessage = (m) => {
    let ev;
    try { ev = JSON.parse(m.data); } catch (err) { console.warn('收到无法解析的事件', err); return; }
    switch (ev.type) {
      case 'hello':
        ui.setName(ev.name); ui.setBridge(ev.bridge);
        if (ev.music) brain.musicCfg = ev.music;
        brain.onMood(ev.mood ?? null);
        brain.onLife(ev.life ?? null);
        if (!greeted) { greeted = true; for (const old of ev.recent ?? []) ui.addChat(old); }
        break;
      case 'bridge': ui.setBridge(ev.status); break;
      case 'qq': brain.onQQ(ev); break;
      case 'video': brain.onVideo(ev); break;
      case 'mood': brain.onMood(ev.mood ?? null); break;
      case 'life': brain.onLife(ev.life ?? null); break;
      case 'poke': brain.onPoke(); break;
      case 'typing': brain.onOwnerTyping(); break;
      case 'act': brain.command(ev, ev.wait ? (result) => reportAct(ev.id, result) : null, true); break;
      // QQ 插件拦着她写好的回复，问「她看完消息了没」：看完了才放行
      case 'readwait': brain.whenRead(() => reportAct(ev.id, { ok: true, done: true, doing: brain.doing })); break;
      default:
    }
  };
  es.onerror = () => ui.setBridge({ enabled: true, connected: false, lastError: '和本地服务断开了' });
}
connect();
// ---------- 拍照：按她摆好的镜头把这一帧画出来，交给本地服务存盘并发到 QQ ----------
/**
 * 按给定的镜头把这一帧画出来，交给本地服务存盘并发到 QQ。
 * @param pose { pos, target: 镜头位置和对准的点, fov, w, h: 照片的宽高 }
 */
brain.capture = async (pose) => {
  const cam = camera.clone();
  cam.aspect = pose.w / pose.h; cam.fov = pose.fov; cam.near = 0.01; // 拍近处的饭也不会被裁掉
  cam.position.copy(pose.pos); cam.lookAt(pose.target);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  const size = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio();
  phone.group.visible = false; // 手机就是「镜头」，不该出现在画面里
  renderer.setPixelRatio(1); renderer.setSize(pose.w, pose.h, false);
  renderer.render(scene, cam);
  const image = canvas.toDataURL('image/jpeg', 0.9);
  renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false);
  phone.group.visible = true;
  try {
    const r = await (await fetch('/api/photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }) })).json();
    return { ...r, image };
  } catch (err) { return { ok: false, error: '连不上本地服务：' + (err?.message ?? err) }; }
};
// 页面打开时「音乐」App 要是已经在放歌，音箱也跟着亮起来
brain.musicCall('state').then((r) => { if (r.ok && r.playing) { speaker.setPlaying(true); ui.setMusic(`${r.track ?? ''}${r.artist ? ' — ' + r.artist : ''}`); brain.musicUntil = clock.now + 20 * 60; } });

// ---------- 开始 ----------
ui.setDoing(brain.doing);
loadSkin().catch((err) => console.error('[模型] 没装上，继续用内置角色', err)).finally(() => ui.ready());
brain.run();
window.__room = { THREE, scene, camera, controls, room, env, char, body, anim, actor, brain, nav, ball, ui, clock, renderer, bloom, phone, kitchen, decor, speaker, spear, sound, get skin() { return skin; } };

const head = new THREE.Vector3();
let last = performance.now(), frames = 0, fpsT = 0, slow = 0, envT = 1;

/** 推进一步模拟（不画画面）。页面在后台时也靠它让她继续生活、继续响应 QQ。 */
function simulate(dt) {
  clock.tick(dt);
  env.update(dt);
  brain.update(dt);
  actor.update(dt);
  anim.update(dt, { yawRate: actor.yawRate, surfaceY: actor.pos.y });
  skin?.update(brain.drapeY ?? actor.pos.y, dt);
  // 她这一帧的姿势定了：手里的东西（手机、碗勺、书、水壶、被头、枪）跟着手走
  body.sync();
  phone.update(dt, clock.now, env.state.dark);
  kitchen.update(dt, clock.now, brain.bite, brain.pot);
  brain.bookCarry.update(dt); brain.canCarry.update(dt); spear.update(dt);
  speaker.update(dt, clock.now);
  room.update(clock.now, dt);
  room.fairy.update(clock.now, env.state.dark);
  decor.update(env.state.dark, clock.now, dt);
  char.face.update(dt);
  ball.update(dt, actor);
  sound.frame(dt, window.__room);
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(dt);
  char.setGlow(env.state.dark);
  {
    const dark = env.state.dark;
    skin?.setRim(lerp(0.2, 0.36, dark), lerp(0.2, 0.5, dark), lerp(0.2, 0.78, dark));
    // 接触阴影跟着她：躺着时拉长，跳起来时淡掉
    const lying = brain.posture === 'lie' || brain.posture === 'sleep', sitting = brain.posture === 'sit';
    const vy = Math.abs(actor.pos.y - blobY) / Math.max(dt, 1e-3); blobY = actor.pos.y;
    blobA = damp(blobA, vy > 0.25 ? 0 : 1, 10, dt);
    blob.position.set(actor.pos.x, actor.pos.y + 0.004, actor.pos.z);
    blob.rotation.y = actor.yaw;
    blob.scale.set(damp(blob.scale.x, lying ? 0.62 : sitting ? 0.56 : 0.5, 8, dt), 1, damp(blob.scale.z, lying ? 0.95 : sitting ? 0.62 : 0.46, 8, dt));
    blob.material.opacity = blobA * lerp(0.85, 0.6, dark);
  }

  envT += dt;
  if (envT > 0.5) { envT = 0; ui.setEnv(env.state, env.timeMode); room.clock.update(new Date()); }

  // 镜头
  if (follow) {
    controls.target.x = damp(controls.target.x, actor.pos.x, 3, dt);
    controls.target.y = damp(controls.target.y, actor.pos.y + 0.3, 3, dt);
    controls.target.z = damp(controls.target.z, actor.pos.z, 3, dt);
    const d = camera.position.distanceTo(controls.target);
    if (d > 3.2) camera.position.lerp(controls.target, 1 - Math.exp(-dt * 1.5 * (1 - 3.2 / d)));
  } else if (resetCam > 0) {
    const k = 1 - Math.exp(-dt * 5);
    camera.position.lerp(HOME.pos, k); controls.target.lerp(HOME.target, k);
    if (camera.position.distanceTo(HOME.pos) < 0.02) resetCam = 0;
  }
  controls.update();
  if (!LOOK_BOX.containsPoint(controls.target)) { const c = LOOK_BOX.clampPoint(controls.target, new THREE.Vector3()); camera.position.add(c.sub(controls.target)); controls.target.add(c); }
  ui.update(dt, actor.headTop(head), camera);

  // 夜里辉光强一点，白天几乎没有
  const dark = env.state.dark;
  bloom.strength = lerp(0.1, 0.42, dark); bloom.threshold = lerp(1.6, 0.92, dark);
  if (useComposer) composer.render(); else renderer.render(scene, camera);

  // 太卡就自动降画质（先降分辨率，再关辉光）。页面刚从后台回来的那一段不算。
  frames++; fpsT += dt;
  if (fpsT >= 2) {
    const fps = frames / fpsT; frames = 0; fpsT = 0;
    window.__fps = fps;
    slow = fps < 26 && !document.hidden ? slow + 1 : 0;
    if (slow >= 3) {
      slow = 0;
      if (pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); composer.setPixelRatio(1); composer.setSize(innerWidth, innerHeight); }
      else if (useComposer) useComposer = false;
    }
  }
}
renderer.setAnimationLoop(frame);
window.__room.simulate = simulate; // 调试用：手动快进模拟
if (query.has('dev')) import('./devtools.js').catch((err) => console.error('[调试] devtools.js 没加载上', err)); // 网址带 ?dev：加载调试工具

// 页面被切到后台时浏览器会停掉画面刷新，普通定时器也会被压到很慢。
// 所以用一个 Worker 当节拍器（它不受这个限制）：后台时按真实时间补算模拟，这样她不会「冻住」，
// QQ 来消息照样有反应；同时每 2 秒把身体状态上报给本地服务（她的 AI 本体读到的就是这个）。
function report() {
  fetch('/api/report?page=' + PAGE_ID, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(brain.report()) })
    .catch((err) => console.debug('状态上报失败（服务没开？）', err));
}
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250)'], { type: 'text/javascript' })));
let ticks = 0;
ticker.onmessage = () => {
  const now = performance.now();
  // 在后台，或者画面因为别的原因停了一秒以上（窗口被藏起来、被挡住……）：按真实时间补算
  if (document.hidden || now - last > 1000) {
    let rest = Math.min(3, (now - last) / 1000); last = now;
    while (rest > 0.001) { const step = Math.min(0.05, rest); simulate(step); rest -= step; }
  }
  if (++ticks % 8 === 0) report();
};
// 但标签页太久没人看，浏览器会把整页冻住（Edge 的睡眠标签页之类），节拍器也跟着停。
// 冻住之前先跟本地服务说一声，它就知道这是「睡着了」而不是「关了」；醒来马上报一次，别让服务多等 2 秒。
const lifecycle = (event) => navigator.sendBeacon?.(`/api/lifecycle?page=${PAGE_ID}&event=${event}`);
document.addEventListener('freeze', () => lifecycle('freeze'));
document.addEventListener('resume', report);
document.addEventListener('visibilitychange', () => { if (!document.hidden) report(); });
addEventListener('pagehide', (e) => lifecycle(e.persisted ? 'freeze' : 'close')); // persisted：进了往返缓存，回来还是这一页

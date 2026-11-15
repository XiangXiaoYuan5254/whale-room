// 大脑：决定她现在想干什么。平时按心情、时间、天气自己挑活动；QQ 来消息就放下手头的事掏手机；
// 她在 QQ 里说了「我去窗边看看」之类的话，身体就真的去做；外部（她的 AI 本体）也能通过接口直接指挥身体。
import * as THREE from 'three';
import { Token, Cancelled, rand, pick, chance, clamp, TAU } from './util.js';
import { PLACES, CUSHION, RUG, PLANT, ROOM, BED_LINE } from './room.js';
import { PHONE_SPOT, PRONE_SPOT, PILLOW_SPOT } from './phone.js';
import { RICE_SPOT, RICE_NEAR, EAT_SPOT, SINK_SPOT, SINK_NEAR } from './kitchen.js';
import { HOLD } from './animator.js';
import { Carry } from './body.js';
import { SCALE } from './character.js';
import { SURFACES } from './nav.js';
import { SPEAR_SPOT, SPEAR_HOME, SPEAR_LEN } from './spear.js';

const OUTSIDE = new THREE.Vector3(-0.85, 0.8, -9);
/** 她去床尾抓被子时待的位置（面朝被子）。 */
const QUILT_SPOT = { surface: 'bed', x: -0.77, z: BED_LINE, yaw: Math.PI / 2 };
/** 水壶平时放的地方。 */
const CAN_HOME = { x: -1.38, z: 1.52, yaw: 0.6 };
/** 书从书架上拿下来 / 放回去的那一点（书架第二层前沿）。 */
const SHELF_POINT = new THREE.Vector3(1.74, 0.46, 0.85);
/** 各个台面上能搁东西的平坦范围 [x0, x1, z0, z1] 和台面高度（比她能站的范围大一圈；避开枕头、笔记本、杯子这些已经占了的地方）。 */
const TOPS = { bed: [-1.5, -0.66, -1.66, -0.8], desk: [0.9, 1.95, -1.3, -1.09], sill: [-1.72, 0.0, -1.74, -1.5] };
const TOP_Y = { floor: 0.006, bed: 0.46, desk: 0.74, sill: 0.9705 };
/** 去这些地方是「待着」：手机拿着过去，到了再搁在手边。其它活动出发前就把手机随手放下。 */
const STAY = new Set(['computer', 'bedSit', 'bedLie', 'lieRug', 'sitHere', 'window', 'hide', 'hold', 'idle']);
/** 要待一阵、或者走过去就停在那儿的事：做到位了就算做完，不用再回去拿手机（手机要么带在身边，要么她正忙着）。其余的是跑一趟就完的事。 */
const STAYS = new Set([...STAY, 'phone', 'read', 'sleep', 'eat', 'goto']);
/** 正做着这些事时要回消息：放下手头的去拿手机，回完再接着做（吃到一半的饭、窗边、电脑前……）。 */
const RESUME = new Set(['computer', 'bedSit', 'bedLie', 'lieRug', 'sitHere', 'window', 'hide', 'phone', 'read', 'eat']);
const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
/** 书拿在手里时相对胸口的朝向：转半圈让书页对着她，再仰到书页朝上、往她脸那边斜 0.45 弧度。 */
const BOOK_TILT = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI).multiply(new THREE.Quaternion().setFromAxisAngle(X, -(Math.PI / 2 - 0.45)));

// 她（或你）话里提到这些，身体就会去做
const INTENTS = [
  ['photo', /(拍张|拍个|拍一张|拍一下|拍下|拍照|自拍|发张照片|来张照片|给我拍|帮我拍|拍给我|拍拍(窗|外|饭|米|盆|花|房))/],
  ['sleep', /(晚安|去睡|睡觉了|睡啦|我先睡|睡觉去|去床上睡|该睡了)/],
  ['window', /(窗边|窗外|窗台|看雨|看雪|看看外面|看星星|看月亮|看风景|看夜景)/],
  ['computer', /(玩电脑|刷视频|刷抖音|刷B站|刷b站|看视频|打游戏|开电脑|玩会儿电脑)/],
  ['read', /(看书|读书|翻翻书|看会儿书)/],
  ['dance', /(跳舞|跳个舞|跳一段|转圈圈|转个圈)/],
  ['lie', /(躺一会|躺会儿|躺着|发呆|躺床上|躺平)/],
  ['lampOn', /(开灯|把灯打开|开一下灯|开台灯)/],
  ['lampOff', /(关灯|把灯关|关一下灯|关台灯)/],
  ['water', /(浇水|浇花)/],
  ['play', /(玩球|踢球)/],
  ['spear', /(练枪|练练枪|练会儿?枪|练一会儿?枪|耍枪|耍个枪|耍一下枪|耍耍枪|舞枪|红缨枪)/],
  ['box', /(打拳|练拳|打套拳|打一套拳|打会儿?拳|打一会儿?拳|出拳|拳击|空击)/],
  ['exercise', /(锻炼|练武|练功|运动一下|运动运动|去运动|健身)/], // 没说练什么：练枪、打拳随便挑一样
  ['stretch', /(伸懒腰|伸个懒腰|活动一下|活动活动)/],
  ['greet', /(挥手|招手|过来|到我这|靠近点|走近点|来我这)/],
  ['hide', /(躲起来|藏起来|桌子底下)/],
  ['eat', /(吃饭|干饭|吃白饭|大白饭|开饭|盛饭|去吃点|吃点东西|吃早饭|吃午饭|吃晚饭)/],
  ['musicOff', /(关掉音乐|把歌关|把音乐关|别放了|关音乐|停掉音乐|音乐关了)/],
  ['music', /(放首歌|放点歌|放歌|放音乐|放点音乐|听歌|听听歌|来点音乐|听音乐)/],
];
/** 让她拍的具体东西。先认这些，再认「拍她自己」：「我看看你的窗外」拍的是窗外，不是自拍。 */
const PHOTO_WHAT = [
  ['window', /(窗外|窗户外|风景|外面|天空|夜景|月亮|星星|下雨|雨景|雪景|晚霞|日落|街景|楼)/],
  ['food', /(饭|米|碗|吃的|电饭煲|早餐|午餐|晚餐)/],
  ['plant', /(盆栽|花|植物|叶子)/],
  ['laptop', /(电脑|屏幕|笔记本)/],
  ['ball', /(球)/],
  ['bed', /(床|被子|枕头)/],
  ['room', /(房间|屋子|你家|家里|周围)/],
];
/** 没说拍什么东西，但话里是想看她本人。 */
const SELFIE_SOFT = /(你自己|你的样子|你本人|你的脸|拍拍你|看看你)/;
/** 「自拍」前面紧挨着这些字就不是要自拍：「不是自拍」「别自拍」「拍成自拍了」「拍错成自拍」。 */
const NOT_SELFIE = /(不|别|没|成|错)/;
export const PHOTO_SUBJECTS = ['selfie', 'window', 'food', 'plant', 'laptop', 'ball', 'bed', 'room', 'ahead'];
/** 让她拍的是什么（从一句话里认）：明说「自拍」→ selfie；否则先认具体的东西（window 窗外 | food 饭 | plant 盆栽 | laptop 电脑 | ball 小球 | bed 床 | room 房间），最后才看是不是想看她本人；认不出返回 null。 */
function photoWhatOf(text) {
  const t = String(text ?? '');
  for (const m of t.matchAll(/自拍/g)) if (!NOT_SELFIE.test(t.slice(Math.max(0, m.index - 3), m.index))) return 'selfie';
  return PHOTO_WHAT.find(([, re]) => re.test(t))?.[0] ?? (SELFIE_SOFT.test(t) ? 'selfie' : null);
}
/** 窗边站着看的两个位置：两扇窗格的正中（中间那根窗框不挡脸），身子朝房间这边侧过来一点。 */
const WINDOW_SPOTS = [{ surface: 'sill', x: -1.29, z: -1.66, yaw: Math.PI - 0.4 }, { surface: 'sill', x: -0.42, z: -1.66, yaw: Math.PI - 0.4 }];
/** 一句话是不是整句都是内心独白：（独白：……）。这种话不会发到 QQ，在房间里显示成心里话气泡。 */
const MONOLOGUE = /^\s*[（(]\s*(独白|心里话|碎碎念)\s*[:：]/;
const shortTitle = (t) => (t.length > 16 ? t.slice(0, 15) + '…' : t);
const NEG = /(不|别|没|勿|甭)/;
const REFUSE = /(不要|不想|不去|才不|懒得|不行|不了|等会|等一下|待会|一会儿再|晚点)/;

function intentOf(text) {
  for (const [act, re] of INTENTS) {
    const m = re.exec(text);
    if (!m) continue;
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    if (NEG.test(before)) continue;
    if (act === 'photo' && NOT_SELFIE.test(before)) continue; // 「拍成自拍了」是在说刚才那张，不是要再拍
    return act;
  }
  return null;
}

// 从文字里读情绪 → 表情、头顶符号、小动作、心情变化
const MOODS = [
  { face: 'love', re: /(爱你|喜欢你|想你|抱抱|亲亲|么么|贴贴|❤|♥|💕|🥰)/, emote: '💗', gesture: 'wiggle', dm: 0.5 },
  { face: 'happy', re: /(哈哈|嘿嘿|嘻嘻|开心|好耶|太好了|真棒|太棒|好呀|好哇|耶|高兴|可爱|😄|😊|😆|✨)/, emote: '♪', gesture: 'bounce', dm: 0.35 },
  { face: 'shy', re: /(害羞|脸红|才没有|讨厌啦|不好意思|羞)/, emote: '💦', gesture: 'shy', dm: 0.15 },
  { face: 'angry', re: /(生气|气死|可恶|不理你|哼|过分|💢)/, emote: '💢', gesture: 'shake', dm: -0.3 },
  { face: 'sad', re: /(难过|伤心|呜呜|委屈|遗憾|可惜|心疼|😢|😭)/, emote: '💧', gesture: null, dm: -0.3 },
  { face: 'surprise', re: /(诶|欸|啊？|啊\?|真的吗|居然|竟然|天哪|哇|！？|\?!)/, emote: '❗', gesture: 'surprise', dm: 0.1 },
  { face: 'sleepy', re: /(好困|困了|晚安|哈欠|打瞌睡)/, emote: '💤', gesture: 'yawn', dm: 0 },
  { face: 'think', re: /(让我想想|想一想|嗯…|嗯\.\.\.|我想想|琢磨)/, emote: '❓', gesture: 'tilt', dm: 0 },
];
const moodOf = (text) => MOODS.find((m) => m.re.test(text)) ?? { face: 'smile', emote: null, gesture: chance(0.4) ? 'nod' : null, dm: 0.05 };

const EMOTES = { happy: '♪', love: '💗', shy: '💦', angry: '💢', sad: '💧', surprise: '❗', question: '❓', sleepy: '💤', music: '♪', think: '💭', sweat: '💦' };
const GOTO = { bed: 'bedEdge', window: 'sill', desk: 'computer', computer: 'computer', bookshelf: 'bookshelf', rug: 'rug', plant: 'plant', lamp: 'lamp', door: 'door', cushion: 'cushion', front: 'front' };

export class Brain {
  constructor({ char, body, anim, actor, nav, room, env, ui, clock, camera, ball, phone, kitchen, speaker, spear }) {
    Object.assign(this, { char, body, anim, actor, nav, room, env, ui, clock, camera, ball, phone, kitchen, speaker, spear });
    this.spearMirror = false; // 练枪时左右镜像（换左手在后、枪尖朝右）
    this.posture = 'stand';
    this.perch = null; // 坐在懒人垫这种「寻路之外」的地方时，记下怎么回到地板
    this.doing = '刚醒来';
    this.current = 'boot';
    this.queue = [{ name: 'greet', fn: (tk) => this.a_greet(tk) }];
    this.recent = [];
    this.mood = 0.2;
    this.feel = null; // 她真正的心情（DSH 插件「鱼的心情」记的）：{ value 0–100, label, dims, top, reason, updatedAt }。this.mood 会慢慢往它靠
    this.hold = false;
    this.token = null;
    // commanded：她的 AI 本体这一轮已经用接口亲自指挥过身体了，她回复里的「我去……」就不再当指令（不然会做两遍）
    // readUntil：她把手上这条消息看完的时间；readWaiters：等她拿起手机、看完消息才发出去的回复（见 whenRead）
    // replyAfter：要发消息了，但手上被指挥去做的事还没到位，到位了再去拿手机；resume：为了回消息放下的事，回完接着做
    this.chat = { inbox: [], intent: null, ownerIntent: null, commanded: false, order: null, readUntil: 0, readWaiters: [], replyAfter: false, resume: null, linger: 14, replyTimeout: 90 };
    this.before = null; // 手机响之前她在干什么（「在地毯上踢球」），聊天时报给她的 AI 本体，主人问「在干嘛」才答得上来
    this.cur = null; // 正在做的那件事（{ name, fn, forced, commanded, onDone, result }）
    this.chatting = false;
    this.sleepWantedUntil = 0;
    this.lampOptOutUntil = 0;
    this.wateredOn = null;
    this.faceTimer = 0;
    this.pour = 0; this.flip = 0;
    this.cushionSat = false; // 她是不是坐在懒人垫上（垫子会被压扁）
    this.bite = 0; this.biteTarget = 0; // 勺子从碗里送到嘴边的程度
    this.pot = 0; this.potTarget = 0; // 勺子伸进锅里舀饭的程度
    this.mealPending = null; // 正在吃（或吃到一半搁下）的那一顿
    this.video = null; // 聊天里分享的 B 站视频（等着去电脑上看）
    this.browseUntil = 0; // 上网冲浪时，这一页看到什么时候
    this.musicCfg = { enabled: true, auto: true, playlist: '大肥鱼的歌单' }; // 服务端 config.json 里的 music
    this.musicUntil = 0; this.nextMusicAt = 10 * 60; // 这次放到什么时候；下次最早什么时候再自己去放
    this.capture = null; // (kind, pose) => Promise：由 main.js 提供，真的把画面拍下来并交给服务端
    this.sfx = () => {}; // (name) => void：由 main.js 提供，放一个音效
    this.reachL = new THREE.Vector3(); this.reachR = new THREE.Vector3(); // 弯腰伸手时两只手的目标点
    // 书和水壶：都是房间里实实在在的一件东西，要么放着，要么在她手里（跟着手走）
    char.root.updateWorldMatrix(true, true);
    this.book = char.props.book; room.group.attach(this.book.group); this.book.group.visible = false;
    this.bookCarry = new Carry(this.book.group); this.bookAt = 'shelf'; // shelf 在书架上 | hand 在手里 | down 搁在地上
    this.bookOff = new THREE.Vector3(HOLD.book.at[0] - HOLD.book.L[0], HOLD.book.at[1] - HOLD.book.L[1], HOLD.book.at[2] - HOLD.book.L[2]);
    this.can = room.wateringCan; this.canCarry = new Carry(this.can); this.canAt = 'floor'; // floor 放在地上 | hand 在右手里
    this.canRest = { ...CAN_HOME };
    this.ateMeal = null; // 最近吃过的那一顿（日期 + 早/午/晚饭），同一顿不吃第二次
    try { this.ateMeal = localStorage.getItem('whale.ateMeal'); } catch (err) { console.debug('读不到本地存储，刷新页面后她可能会把同一顿饭再吃一遍', err); }
    this.mealCheck = 0;
    this.drapeY = null; // 头发、裙摆垂到哪个高度为止；null = 她脚下那个面
    this.cushionMesh = room.group.getObjectByName('cushion');
    this.drops = [];
    const dm = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
    for (let i = 0; i < 7; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), dm); d.visible = false; room.group.add(d); this.drops.push(d); }
  }

  // ---------------- 小工具 ----------------
  sleep(sec, tk) { return this.clock.sleep(sec, tk); }
  async g(name, tk, scale = 1) { await this.sleep(this.anim.gesture(name, scale), tk); }
  face(name) { this.char.face.set(name); }
  setDoing(text) { if (this.doing !== text) { this.doing = text; this.ui.setDoing(text); } }
  pose(base, posture, params = {}) { this.anim.setBase(base, params); this.posture = posture; }
  camYaw() { return Math.atan2(this.camera.position.x - this.actor.pos.x, this.camera.position.z - this.actor.pos.z); }
  act(name, ...args) { return { name, args, fn: (tk) => this['a_' + name](tk, ...args) }; }

  /** 把一件指令的结果报给在等它的人（接口带了 wait 时是服务端，在等的是她的 AI 本体）。每件事只报一次。 */
  orderDone(act, result) {
    const f = act?.onDone;
    if (!f) return;
    act.onDone = null;
    f({ doing: this.doing, ...result, ...(act.result ?? {}) });
  }
  /**
   * 当前这件事「到位」了：一次性的事（拍照、浇花、跳舞……）是做完了；要待一阵的事（看窗外、玩电脑、看书、睡觉……）是已经待下了。
   * name 写的是调用它的那个活动自己的名字：被别的活动顺带调用时（比如睡前顺手关音乐）不算数。
   */
  arrived(name) {
    if (!this.cur || this.cur.name !== name) return;
    this.cur.settled = true;
    this.orderDone(this.cur, { ok: true, done: true });
    if (this.chat.replyAfter) { this.chat.replyAfter = false; this.clock.sleep(0.4).then(() => this.replyOnPhone()).catch(() => {}); }
  }

  /** 不打断当前活动的小反应：换个表情、做个小动作、冒个符号，过一会儿表情复原。 */
  react(faceName, gesture, emote, sec = 2) {
    const prev = this.char.face.expr;
    if (faceName) this.face(faceName);
    if (gesture) this.anim.gesture(gesture);
    if (emote) this.ui.emote(emote, sec);
    const mine = ++this.faceTimer;
    if (faceName) this.clock.sleep(sec).then(() => { if (this.faceTimer === mine && this.char.face.expr === faceName) this.face(prev); });
  }

  /** 从坐/躺/睡回到站立；如果在懒人垫上就先跳下来。 */
  async standUp(tk) {
    this.room.quilt.throwOff();
    if (this.posture === 'lie' || this.posture === 'sleep') { this.pose('sitFloor', 'sit'); await this.sleep(0.6, tk); }
    if (this.posture !== 'stand') { this.pose('stand', 'stand'); this.anim.bump(-1.4); await this.sleep(0.35, tk); }
    // 从懒人垫上跳下来。按她实际站在哪判断，落了地才把「在垫子上」清掉：
    // 以前是先清掉再跳，跳到一半被打断（手机响、B 站视频推过来）时人还在垫子上，却当成已经下来了，
    // 垫子又不在寻路图里，之后去哪儿都「去不了」，就一直站着不动、头上的打算换来换去
    if (this.actor.surface === 'cushion') await this.actor.jump(this.perch?.exit ?? this.cushionExit(), tk, { height: 0.1 });
    this.leftCushion();
  }
  /** 已经不在垫子上了：垫子回弹，头发裙摆垂到地板。 */
  leftCushion() { if (this.actor.surface !== 'cushion' && (this.perch || this.cushionSat)) { this.perch = null; this.cushionSat = false; this.drapeY = null; } }
  /** 没记着从哪儿上的垫子时，从垫子边上离她最近的空地跳下去。 */
  cushionExit() {
    const a = this.actor; let dx = a.pos.x - CUSHION.x, dz = a.pos.z - CUSHION.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) { dx = Math.sin(a.yaw); dz = Math.cos(a.yaw); } else { dx /= l; dz /= l; }
    const p = this.nav.nearestFree(CUSHION.x + dx * (CUSHION.r + 0.2), CUSHION.z + dz * (CUSHION.r + 0.2));
    return { x: p.x, y: 0, z: p.z, surface: 'floor' };
  }

  async go(place, tk, style) {
    const dest = typeof place === 'string' ? PLACES[place] : place;
    await this.standUp(tk);
    await this.actor.goTo(dest, tk, style ?? (this.mood > 0.55 && chance(0.4) ? 'skip' : 'walk'));
  }

  /**
   * 弯腰伸手去够一样东西：上身前倾，手伸向它，等手伸到位再返回。她的手臂很短，够低处、远处的东西都得弯腰。
   * @param right 右手的目标点（世界坐标）；left 不给就只伸右手
   */
  async bendTo(right, left, tk, { lean = 0.7, sec = 0.42 } = {}) {
    this.anim.lean = lean;
    this.anim.reach('R', right); if (left) this.anim.reach('L', left);
    this.anim.lookAt(right);
    await this.sleep(sec, tk);
  }
  /** 直起身，手收回来。 */
  unbend() { this.anim.lean = 0; this.anim.reach('L', null); this.anim.reach('R', null); }

  /** 地板上离 (x, z) 约 dist 远、她能站的一点（优先挑离她现在近的方向）。 */
  spotNear(x, z, dist = 0.24) {
    const a0 = Math.atan2(this.actor.pos.x - x, this.actor.pos.z - z);
    for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
      const px = x + Math.sin(a0 + da) * dist, pz = z + Math.cos(a0 + da) * dist;
      if (this.nav.isFree(px, pz)) return { surface: 'floor', x: px, z: pz };
    }
    const f = this.nav.nearestFree(x, z);
    return { surface: 'floor', x: f.x, z: f.z };
  }
  /** 她面前的地上、能搁东西的一点。 */
  floorAhead(dist = 0.2) {
    const a = this.actor;
    for (const da of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {
      const px = a.pos.x + Math.sin(a.yaw + da) * dist, pz = a.pos.z + Math.cos(a.yaw + da) * dist;
      if (this.nav.isFree(px, pz)) return { x: px, z: pz };
    }
    return { x: a.pos.x + Math.sin(a.yaw) * dist, z: a.pos.z + Math.cos(a.yaw) * dist };
  }

  // ---------------- 拿起、放下 ----------------
  /** 她身边能搁东西的一点（和她在同一个台面上，优先右手边）：{ surface, x, z, top }；实在没地方返回 null。 */
  sideSpot() {
    const a = this.actor;
    let s = a.surface, cx = a.pos.x, cz = a.pos.z, dist = 0.25;
    if (s === 'cushion') { s = 'floor'; cx = CUSHION.x; cz = CUSHION.z; dist = CUSHION.r + 0.12; } // 窝在垫子上：搁在垫子旁边的地上
    const ok = (x, z) => { if (s === 'floor') return this.nav.isFree(x, z); const t = TOPS[s]; return Boolean(t) && x > t[0] && x < t[1] && z > t[2] && z < t[3]; };
    for (const da of [-Math.PI / 2, Math.PI / 2, -0.9, 0.9, 0, -2.3, 2.3, Math.PI]) {
      const x = cx + Math.sin(a.yaw + da) * dist, z = cz + Math.cos(a.yaw + da) * dist;
      if (ok(x, z)) return { surface: s, x, z, top: TOP_Y[s] };
    }
    return null;
  }
  /** 手机放在某个台面上时，她去拿它该站在哪。 */
  phoneSpot(r, p) {
    if (r.surface === 'floor') return this.spotNear(p.x, p.z, 0.2);
    const [x0, x1, z0, z1] = SURFACES[r.surface].rect, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, d = Math.hypot(cx - p.x, cz - p.z) || 1;
    const q = this.nav.clampTo(r.surface, p.x + ((cx - p.x) / d) * 0.2, p.z + ((cz - p.z) / d) * 0.2);
    return { surface: r.surface, x: q.x, z: q.z };
  }

  /** 到手机跟前，弯腰把它拿起来（它在哪儿就去哪儿拿；就在身边的话挪一步就行）。mode：屏幕上显示 chat 聊天 | feed 短视频。 */
  async fetchPhone(tk, mode = 'chat', style = 'walk') {
    const ph = this.phone, a = this.actor;
    if (ph.state === 'held') { ph.show(mode); this.anim.setArms('phone'); return; }
    const r = ph.rest, p = ph.worldPos(this.reachR);
    const dist = () => Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
    const here = a.surface === r.surface && !this.perch;
    if (r.kind !== 'flat') {
      const spot = r.kind === 'pillow' ? PILLOW_SPOT : PHONE_SPOT;
      if (here && Math.hypot(a.pos.x - spot.x, a.pos.z - spot.z) < 0.03 && this.posture !== 'lie') await a.turnTo(spot.yaw, tk);
      else await this.go(spot, tk, style);
    } else if (here && dist() < 0.45) {
      await this.standUp(tk);
      if (dist() > 0.2) { const k = 0.17 / dist(); await a.walk([{ x: p.x + (a.pos.x - p.x) * k, z: p.z + (a.pos.z - p.z) * k }], tk, 'walk'); this.anim.setBase('stand'); }
    } else await this.go(this.phoneSpot(r, p), tk, style);
    await a.facePoint(p.x, p.z, tk);
    this.pose('kneel', 'sit');
    await this.bendTo(p, null, tk, { lean: 0.6 });
    ph.hold(this.body, mode); this.anim.setArms('phone');
    await this.sleep(0.22, tk);
    this.unbend();
    await this.sleep(0.3, tk);
  }
  /** 把手里的手机收到枕头边（睡前）。 */
  async stowPhone(tk) {
    if (this.phone.state !== 'held') return;
    this.setDoing('把手机放到枕头边');
    await this.go(PHONE_SPOT, tk);
    this.anim.setArms('phone');
    this.pose('kneel', 'sit');
    this.anim.lean = 0.6;
    await this.sleep(0.42, tk);
    this.phone.putHome(); this.phone.setTyping(false); this.anim.setArms('auto');
    await this.sleep(0.4, tk);
    this.unbend();
    await this.sleep(0.25, tk);
  }
  /** 把手里的手机随手搁在身边（哪儿顺手放哪儿，不用摆正）。 */
  async parkPhone(tk) {
    if (this.phone.state !== 'held') return;
    const s = this.sideSpot();
    if (!s) { await this.stowPhone(tk); return; }
    if (this.posture === 'stand') this.pose('kneel', 'sit');
    this.anim.setArms('phone');
    this.anim.lean = 0.5; this.anim.reach('R', this.reachR.set(s.x, s.top + 0.04, s.z));
    await this.sleep(0.4, tk);
    this.phone.putDown(s.surface, s.x, s.z, s.top, this.actor.yaw + Math.PI + rand(-0.7, 0.7));
    this.phone.setTyping(false); this.anim.setArms('auto');
    await this.sleep(0.4, tk);
    this.unbend();
    await this.sleep(0.2, tk);
  }
  /** 到了要待着的地方：手机还拿在手里的话，搁在手边。 */
  async settlePhone(tk) { if (this.phone.state === 'held') await this.parkPhone(tk); }
  /** 走到电饭煲跟前（最后一小步直接迈过去），面朝它。 */
  async toCooker(tk, style = 'walk') {
    await this.go(RICE_SPOT, tk, style); await this.actor.walk([RICE_NEAR], tk, 'walk'); this.anim.setBase('stand'); await this.actor.turnTo(RICE_SPOT.yaw, tk);
  }
  /** 盛饭：按开电饭煲，端起托盘上的碗，用勺子舀三勺，合上盖子。做完碗端在手里、站在电饭煲前。 */
  async serveRice(tk, style = 'walk') {
    const { anim, kitchen, actor, body } = this, { bowl, spoon, cooker } = kitchen;
    await this.toCooker(tk, style);
    await this.cookerLid(tk, true);
    this.face('joy'); await this.sleep(0.9, tk);
    // 转向旁边的碗，端起来
    this.setDoing('拿碗盛饭');
    const bp = bowl.group.position;
    await actor.facePoint(bp.x, bp.z, tk);
    bowl.gripPoints(actor.yaw, this.reachL, this.reachR);
    await this.bendTo(this.reachR, this.reachL, tk, { lean: 0.6, sec: 0.5 });
    bowl.take(body); anim.setArms('eat');
    await this.sleep(0.25, tk);
    this.unbend();
    this.pose('stand', 'stand'); await this.sleep(0.45, tk);
    // 站在锅前，右手拿勺子，从锅里往碗里舀
    const pot = cooker.potPoint;
    await actor.turnTo(RICE_SPOT.yaw, tk);
    spoon.use(body, true); anim.hand.spoon = true;
    anim.lookAt(pot);
    await this.sleep(0.3, tk);
    for (let i = 0; i < 3; i++) {
      anim.lean = 0.22; this.potTarget = 1;
      const d = Math.hypot(pot.x - actor.pos.x, pot.z - actor.pos.z);
      this.reachR.set(pot.x - ((pot.x - actor.pos.x) / d) * 0.042, pot.y + 0.05, pot.z - ((pot.z - actor.pos.z) / d) * 0.042 + 0.03); // 手在锅沿上方偏右，勺头斜着伸进锅里
      anim.reach('R', this.reachR);
      await this.sleep(0.55, tk);
      spoon.loaded = true;
      this.potTarget = 0; anim.reach('R', null); anim.lean = 0.06;
      await this.sleep(0.5, tk);
      spoon.loaded = false; bowl.setRice((i + 1) / 3);
      await this.sleep(0.15, tk);
    }
    anim.lean = 0;
    spoon.use(body, false); anim.hand.spoon = false;
    await this.sleep(0.3, tk);
    await this.cookerLid(tk, false);
    anim.lookAt(null);
    this.pose('stand', 'stand'); await this.sleep(0.4, tk);
  }

  /** 跪下，伸右手按一下电饭煲的开盖按钮（open=false 就是合上）。 */
  async cookerLid(tk, open) {
    const { cooker } = this.kitchen;
    const b = cooker.buttonPoint(this.reachR);
    await this.actor.turnTo(RICE_SPOT.yaw, tk);
    this.pose('kneel', 'sit');
    await this.bendTo(b, null, tk, { lean: 0.3, sec: 0.5 });
    cooker.press(); cooker.setOpen(open);
    await this.sleep(0.15, tk);
    this.unbend();
  }

  /** 把手里的碗搁下：就在矮几跟前就放回矮几，否则搁在面前的地上（回头接着吃）。 */
  async setDownBowl(tk) {
    const { bowl, spoon } = this.kitchen, a = this.actor;
    if (bowl.where !== 'hand') return;
    spoon.use(this.body, false); this.anim.hand.spoon = false; this.biteTarget = 0;
    this.anim.setArms('eat');
    const atTable = a.surface === 'floor' && Math.hypot(a.pos.x - RICE_NEAR.x, a.pos.z - RICE_NEAR.z) < 0.12;
    if (this.posture === 'stand') this.pose('kneel', 'sit');
    this.anim.lean = 0.6;
    await this.sleep(0.4, tk);
    if (atTable) bowl.toTable(); else { const f = this.floorAhead(0.2); bowl.toFloor(f.x, f.z); }
    this.anim.setArms('auto');
    await this.sleep(0.38, tk);
    this.unbend();
    await this.sleep(0.2, tk);
  }
  /** 把手里的书搁在旁边的地上（摊开着，回头接着看）。 */
  async setDownBook(tk) {
    if (this.bookAt !== 'hand') return;
    const a = this.actor;
    let f;
    if (a.surface === 'cushion') { const d = CUSHION.r + 0.14; f = { x: CUSHION.x + Math.sin(a.yaw) * d, z: CUSHION.z + Math.cos(a.yaw) * d }; }
    else f = this.floorAhead(0.22);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, a.yaw).multiply(_q.setFromAxisAngle(X, -Math.PI / 2));
    this.anim.lean = 0.7;
    await this.sleep(0.35, tk);
    this.bookAt = 'down';
    this.bookCarry.to((pos, quat) => { pos.set(f.x, 0.012, f.z); quat.copy(q); }, 0.4, 0.05);
    this.anim.setArms('auto');
    await this.sleep(0.42, tk);
    this.unbend();
  }
  /** 把手里的水壶放下。home：送回盆栽旁边的老地方；否则就搁在面前的地上。 */
  async setDownCan(tk, home = false) {
    if (this.canAt !== 'hand') return;
    const a = this.actor;
    if (home) {
      await this.go(this.spotNear(CAN_HOME.x, CAN_HOME.z), tk);
      await a.facePoint(CAN_HOME.x, CAN_HOME.z, tk);
      this.canRest = { ...CAN_HOME };
    } else { const f = this.floorAhead(0.22); this.canRest = { x: f.x, z: f.z, yaw: a.yaw - Math.PI / 2 }; }
    this.anim.setArms('water');
    if (this.posture === 'stand') this.pose('kneel', 'sit');
    this.anim.lean = 0.6;
    await this.sleep(0.42, tk);
    const r = this.canRest;
    this.canAt = 'floor';
    this.canCarry.to((pos, quat) => { pos.set(r.x, 0, r.z); quat.setFromAxisAngle(UP, r.yaw); }, 0.35, 0.03);
    this.anim.setArms('auto');
    await this.sleep(0.4, tk);
    this.unbend();
    this.pose('stand', 'stand'); await this.sleep(0.3, tk);
  }
  /** 把手里的枪横放在脚边的地上（练到一半被叫走时）：找一个整杆枪都落在空地上的方向。 */
  async setDownSpear(tk) {
    const sp = this.spear, a = this.actor;
    if (sp.at !== 'hand') return;
    const fits = (bx, bz, yaw) => {
      for (let k = 0; k <= 8; k++) { const d = (k / 8) * SPEAR_LEN, x = bx + Math.sin(yaw) * d, z = bz + Math.cos(yaw) * d; if (!this.nav.isFree(x, z)) return false; }
      return true;
    };
    let spot = null;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, Math.PI / 2, -Math.PI / 2, 2.2, -2.2, Math.PI]) {
      for (const side of [-1, 1]) {
        const yaw = a.yaw + da, sx = a.pos.x + Math.sin(a.yaw + side * Math.PI / 2) * 0.17, sz = a.pos.z + Math.cos(a.yaw + side * Math.PI / 2) * 0.17;
        const bx = sx - Math.sin(yaw) * 0.35, bz = sz - Math.cos(yaw) * 0.35; // 握的地方在她身边，枪尖朝前
        if (fits(bx, bz, yaw)) { spot = { x: bx, z: bz, yaw }; break; }
      }
      if (spot) break;
    }
    if (!spot) { await this.returnSpear(tk); return; } // 身边放不下：直接插回枪架
    this.pose('kneel', 'sit');
    this.anim.lean = 0.55;
    await this.sleep(0.35, tk);
    sp.toFloor(spot.x, spot.z, spot.yaw, 0.4); this.sfx('thud');
    this.anim.setArms('auto');
    await this.sleep(0.4, tk);
    this.unbend();
    this.pose('stand', 'stand'); await this.sleep(0.25, tk);
  }
  /** 开始下一件事之前，把手里用不上的东西先放好（碗、书、水壶搁下；手机随手放在身边，要睡了才收到枕头边）。 */
  async putAway(next, tk) {
    if (this.kitchen.bowl.where === 'hand' && next !== 'eat') await this.setDownBowl(tk);
    if (this.bookAt === 'hand' && next !== 'read') await this.setDownBook(tk);
    if (this.canAt === 'hand' && next !== 'water') await this.setDownCan(tk);
    if (this.spear.at === 'hand' && next !== 'spear') await this.setDownSpear(tk);
    if (this.phone.state === 'held' && next !== 'chat' && next !== 'phone' && next !== 'photo') { // 拍照要用手机：拿着直接去，别放下又拿起来
      if (next === 'sleep') await this.stowPhone(tk);
      else if (!STAY.has(next)) await this.parkPhone(tk);
      // 其余的（去某处待着）：拿着手机过去，到了再搁在手边，见 settlePhone
    }
  }

  /** 每个活动结束（或被打断）后的收尾：姿势、灯、屏幕复原；手里还拿着的东西照旧拿着（下一件事开始前再放）。 */
  cleanup(name) {
    const { anim, room, ui, kitchen } = this;
    this.unbend();
    anim.hand.typing = false; anim.hand.pour = 0; anim.hand.spoon = false;
    this.phone.setTyping(false);
    kitchen.spoon.use(this.body, false); this.biteTarget = 0; this.potTarget = 0;
    kitchen.cooker.setOpen(false);
    kitchen.sink.setTap(false); kitchen.sink.setSuds(false); kitchen.sink.useSponge(this.body, false);
    anim.setArms(this.phone.state === 'held' ? 'phone' : kitchen.bowl.where === 'hand' ? 'eat' : this.bookAt === 'hand' ? 'book' : this.canAt === 'hand' ? 'water' : this.spear.at === 'hand' ? 'spear' : 'auto');
    anim.lookAt(null);
    this.actor.spin = 0; this.pour = 0;
    for (const d of this.drops) d.visible = false;
    ui.think(false);
    if (name === 'computer') { room.laptop.set(false); room.laptop.screen.clearVideo(); room.laptop.screen.clearPage(); }
    if (this.posture !== 'sleep') room.quilt.throwOff();
    this.leftCushion();
  }

  // ---------------- 主循环 ----------------
  async run() {
    for (;;) {
      if (this.chat.replyAfter && !this.queue.some((q) => q.name === 'chat') && this.replyPending()) { this.chat.replyAfter = false; this.queue.unshift(this.act('chat', true)); }
      const act = this.queue.shift() ?? this.pickAuto();
      this.token = new Token(); this.current = act.name; this.cur = act;
      this.ui.setAuto(!act.forced && !this.hold);
      try {
        await this.putAway(act.name, this.token);
        await act.fn(this.token);
        if (act.thenReply) {
          // 事情本身做完了：记下这时候的样子（「把音乐关了」），再回去拿手机准备回你，拿到了才报「做完了」
          const did = this.doing;
          try { await this.pickUpToReply(this.token); } finally { this.orderDone(act, { ok: true, done: true, doing: did }); }
        }
        this.orderDone(act, { ok: true, done: true }); // 做完了（中途已经报过「到位」的，这里什么也不做）
        if (!['chat', 'hold', 'lamp', 'goto'].includes(act.name)) { this.recent.push(act.name); if (this.recent.length > 5) this.recent.shift(); }
      } catch (err) {
        if (err instanceof Cancelled) this.orderDone(act, { ok: true, done: false, cancelled: true, note: this.cutBy === 'chat' ? '做到一半手机来消息了，被打断了，没做完' : '做到一半被别的事打断了，没做完' });
        else {
          console.error('[大脑] 活动出错：', act.name, err);
          this.orderDone(act, { ok: false, done: false, error: '身体做这件事时出错了：' + (err?.message ?? err) });
          try { await this.clock.sleep(1.5); } catch (e) { console.error(e); }
        }
      }
      this.cleanup(act.name);
    }
  }

  /** 打断当前活动，插队做一件事。 */
  interrupt(act, forced = false) {
    act.forced = forced; this.cutBy = act.name;
    if (act.name === 'chat' && this.current !== 'chat') this.before = this.doingWithPlace(); // 记下手机响之前在哪儿、干什么
    for (const q of this.queue) if (q.name !== 'chat') this.orderDone(q, { ok: true, done: false, cancelled: true, note: '还没轮到就被别的事插队了，没做' });
    // 正在看手机、等着看完消息再去做的那件事：手机这一段被别的事打断了，它也就不做了
    if (this.chat.order && act.name !== 'chat') { this.orderDone(this.chat.order, { ok: true, done: false, cancelled: true, note: '还没开始做就被别的事打断了，没做' }); this.chat.order = null; }
    this.queue = this.queue.filter((q) => q.name === 'chat');
    this.queue.unshift(act);
    this.token?.cancel();
  }

  /** 现在是不是饭点（只在「跟随现实」时间下算）。返回这一顿的标记，比如「Wed Nov 11 2026 午饭」；不是饭点返回 null。 */
  mealNow() {
    if (this.env.timeMode !== 'auto') return null;
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    const m = h >= 7 && h < 9 ? '早饭' : h >= 11.5 && h < 13.5 ? '午饭' : h >= 18 && h < 20 ? '晚饭' : null;
    return m ? d.toDateString() + ' ' + m : null;
  }

  /** 该不该睡：装了 dsh-jingjing 就按它定的作息（服务端推过来的 life），没有就用房间自己的深夜 1:00–7:24。 */
  nightHours() {
    if (this.env.timeMode !== 'auto') return false;
    if (this.life) return this.life.asleep;
    const h = this.env.state.hour;
    return h >= 1 && h < 7.4;
  }
  onLife(l) { this.life = l && typeof l.asleep === 'boolean' ? l : null; }
  shouldSleep() { return this.clock.now < this.sleepWantedUntil || (this.nightHours() && this.clock.now > (this.awakeUntil ?? 0)); }

  pickAuto() {
    if (this.hold) return this.act('hold');
    if (this.shouldSleep()) return this.act('sleep');
    const e = this.env.state, lamp = this.room.lamp;
    if (e.dark > 0.6 && !lamp.on && this.clock.now > this.lampOptOutUntil) return this.act('lamp', true);
    if (e.dark < 0.25 && lamp.on) return this.act('lamp', false);
    if (this.kitchen.bowl.where === 'floor') return this.act('eat'); // 饭吃到一半搁在地上了：回去接着吃
    const autoMusic = this.musicCfg.enabled && this.musicCfg.auto;
    if (autoMusic && this.speaker.playing && this.clock.now > this.musicUntil) return this.act('music', 'off'); // 听够了，关掉
    const meal = this.mealNow();
    if (meal && this.ateMeal !== meal) return this.act('eat', meal); // 到饭点了，先吃饭
    const evening = e.hour >= 19 || e.hour < 1;
    const wet = e.weather === 'rain' || e.weather === 'snow';
    const today = new Date().toDateString();
    const w = {
      idle: 0.5, wander: 1.1, bedSit: 0.8, bedLie: evening ? 1.3 : 0.8, phone: 1.1,
      window: 0.9 + (wet ? 1.1 : 0) + (e.phase === 'dusk' || e.phase === 'dawn' ? 0.6 : 0),
      computer: evening ? 1.5 : 0.9, read: this.bookAt === 'down' ? 2 : 0.9, dance: 0.45 + Math.max(0, this.mood) * 0.9, play: 0.7,
      water: e.dark < 0.4 && this.wateredOn !== today ? 0.9 : 0, stretch: 0.4, greet: 0.3, hide: 0.1,
      music: autoMusic && !this.speaker.playing && this.clock.now > this.nextMusicAt && e.hour >= 9 && e.hour < 23 ? 0.4 : 0,
      // 练枪：白天偶尔练一练；上次练到一半枪还扔在地上，就回去收拾（天黑了只收不练）
      spear: this.spear.at === 'floor' ? 1.2 : e.dark < 0.6 && e.hour >= 8 && e.hour < 22 ? 0.4 + Math.max(0, this.mood) * 0.2 : 0,
      box: e.dark < 0.6 && e.hour >= 8 && e.hour < 22 ? 0.35 + Math.max(0, this.mood) * 0.2 : 0,
    };
    this.moodWeights(w);
    let total = 0;
    for (const k of Object.keys(w)) {
      const idx = this.recent.lastIndexOf(k);
      if (idx >= 0) w[k] *= idx >= this.recent.length - 2 ? 0.08 : 0.45;
      total += w[k];
    }
    let r = Math.random() * total;
    for (const k of Object.keys(w)) {
      r -= w[k];
      if (r <= 0) return k === 'spear' && this.spear.at === 'floor' && e.dark >= 0.6 ? this.act('spear', 'tidy') : this.act(k);
    }
    return this.act('idle');
  }

  // ---------------- 心情 ----------------
  /** 她真正的心情换算成 -1~0.8：基线 70 附近是 0，90 以上是开心得蹦蹦跳跳，40 以下很低落。 */
  feelBase() {
    return this.feel ? clamp((this.feel.value - 70) / 30, -1, 0.8) : 0;
  }
  /** 心情影响她自己想做什么：难过时多去窗边、多躺着，惦记主人时老去看手机，开心时爱跳舞、跑来打招呼，生气了去打拳出出气。 */
  moodWeights(w) {
    const f = this.feel;
    if (!f) return;
    const d = f.dims ?? {}, v = f.value;
    const low = v < 45 || (d.sad ?? 0) >= 25 || (d.heartache ?? 0) >= 30;
    const high = v >= 80 || (d.happy ?? 0) >= 30 || (d.sweet ?? 0) >= 30;
    if (low) { w.window += 1.2; w.bedLie += 0.8; w.hide += 0.25; w.dance *= 0.25; w.play *= 0.4; w.greet *= 0.4; w.wander *= 0.6; }
    if (!low && high) { w.dance += 0.6; w.greet += 0.5; w.play += 0.3; }
    if ((d.worry ?? 0) >= 25 || (d.jealous ?? 0) >= 25 || (d.miss ?? 0) >= 25) w.phone += 1.0;
    if ((d.angry ?? 0) >= 25 && w.box > 0) w.box += 1.2;
    if ((d.calm ?? 0) >= 30) { w.read += 0.5; w.window += 0.3; }
  }
  /** 发呆、溜达时的表情。 */
  restFace() {
    const f = this.feel;
    if (!f) return 'neutral';
    const top = f.top?.[0]?.key;
    if (f.value < 42 || top === 'sad' || top === 'heartache') return 'sad';
    if (top === 'worry') return 'think';
    if (f.value >= 80 || top === 'happy' || top === 'sweet') return 'smile';
    return 'neutral';
  }
  /** 心情变了（本地服务推过来的）。刚判出来的新变化：脸上带一下，头顶冒个符号，把心里那句话冒成云朵。 */
  onMood(m) {
    const prev = this.feel;
    this.feel = m && Number.isFinite(m.value) ? m : null;
    this.ui.setMood(this.feel);
    if (!this.feel || !prev || this.feel.updatedAt === prev.updatedAt || this.feel.kind === 'decay') return;
    if (this.posture === 'sleep' || this.current === 'sleep') return; // 睡着了（或者正要睡）：醒来自然是新的心情，不用演
    const up = this.feel.value >= prev.value;
    const LOOK = { happy: ['happy', '♪'], sweet: ['love', '💗'], calm: ['smile', null], heartache: ['sad', '💧'], worry: ['think', '💦'], sad: ['sad', '💧'], jealous: ['angry', '💢'], angry: ['angry', '💢'] };
    const [faceName, emote] = LOOK[this.feel.top?.[0]?.key] ?? (up ? ['happy', '♪'] : ['sad', '💧']);
    this.react(faceName, up && chance(0.5) ? 'bounce' : null, emote, 3);
    if (this.feel.reason && this.feel.confidence >= 60) this.clock.sleep(1.5).then(() => this.think(this.feel?.reason ?? ''));
  }

  // ---------------- 活动 ----------------
  async a_hold(tk) {
    this.setDoing('乖乖站着等你发话');
    await this.standUp(tk);
    this.arrived('hold');
    this.anim.lookAt(this.camera.position);
    await this.sleep(2, tk);
  }

  async a_idle(tk) {
    this.setDoing('站着发呆');
    await this.standUp(tk);
    for (let i = 0; i < 1 + Math.floor(rand(2.5)); i++) {
      const r = Math.random();
      if (r < 0.3) await this.g('lookAround', tk);
      else if (r < 0.5) { this.anim.lookAt(this.camera.position); this.face(this.restFace() === 'sad' ? 'sad' : 'smile'); await this.sleep(rand(1.5, 3), tk); this.anim.lookAt(null); this.face(this.restFace()); }
      else if (r < 0.65) await this.g('tilt', tk);
      else if (r < 0.8) { this.face('sleepy'); await this.g('yawn', tk); this.face(this.restFace()); }
      else await this.sleep(rand(1.5, 4), tk);
    }
  }

  async a_wander(tk) {
    this.setDoing('在房间里溜达');
    this.face(this.restFace());
    for (let i = 0; i < 1 + Math.floor(rand(3)); i++) {
      await this.go(this.nav.randomFloorPoint(), tk, chance(0.2) ? 'skip' : 'walk');
      if (chance(0.5)) await this.g('lookAround', tk); else await this.sleep(rand(0.8, 2.5), tk);
    }
  }

  async a_goto(tk, dest) {
    this.setDoing('走过去看看');
    await this.go(dest, tk);
    if (dest.yaw === undefined) await this.actor.turnTo(this.camYaw(), tk);
    await this.sleep(1.2, tk);
  }

  async a_greet(tk) {
    this.setDoing('跑到跟前打招呼');
    await this.go(PLACES.front, tk, 'skip');
    await this.actor.turnTo(this.camYaw(), tk);
    this.anim.lookAt(this.camera.position);
    this.face('happy'); this.ui.emote('♪', 2);
    await this.g('wave', tk);
    this.face('smile');
    await this.sleep(1.2, tk);
  }

  async a_stretch(tk) {
    this.setDoing('伸懒腰');
    await this.standUp(tk);
    this.face('happy'); await this.g('stretch', tk); this.face('neutral');
    if (chance(0.4)) { this.face('sleepy'); await this.g('yawn', tk); this.face('neutral'); }
  }

  async a_bedSit(tk) {
    this.setDoing('往床边走');
    await this.go(PLACES.bedEdge, tk);
    await this.settlePhone(tk);
    this.pose('sit', 'sit', { kick: 1 });
    this.setDoing('坐在床沿晃腿');
    this.arrived('bedSit');
    const end = this.clock.now + rand(15, 40);
    while (this.clock.now < end) {
      const r = Math.random();
      if (r < 0.3) { this.anim.lookAt(this.camera.position); this.face('smile'); }
      else if (r < 0.5) { this.anim.lookAt(OUTSIDE); this.face('neutral'); }
      else if (r < 0.65) { this.ui.emote('♪', 2); this.face('happy'); }
      else { this.anim.lookAt(null); this.face('neutral'); }
      await this.sleep(rand(3, 7), tk);
    }
  }

  async a_bedLie(tk) {
    this.setDoing('往床上爬');
    await this.go({ ...PLACES.bedLie, yaw: Math.PI / 2 + rand(-0.25, 0.25) }, tk);
    await this.settlePhone(tk);
    this.pose('sitFloor', 'sit'); await this.sleep(0.5, tk);
    this.pose('lieBack', 'lie');
    this.setDoing('躺在床上发呆');
    this.arrived('bedLie');
    this.face('neutral');
    const end = this.clock.now + rand(25, 70);
    while (this.clock.now < end) {
      const r = Math.random();
      if (r < 0.25) { this.anim.setArms('pillow'); this.face('smug'); }
      else if (r < 0.45) { this.anim.setArms('auto'); this.face('sleepy'); }
      else if (r < 0.6) { this.ui.emote('💭', 2.5); this.face('think'); }
      else { this.anim.setArms('auto'); this.face('neutral'); }
      await this.sleep(rand(5, 11), tk);
    }
  }

  async a_lieRug(tk) {
    this.setDoing('往地毯上走');
    await this.go({ surface: 'floor', x: RUG.x + rand(-0.2, 0.2), z: RUG.z + rand(-0.1, 0.2), yaw: rand(TAU) }, tk);
    await this.settlePhone(tk);
    this.pose('sitFloor', 'sit'); await this.sleep(0.5, tk);
    this.pose('lieBack', 'lie');
    this.setDoing('躺在地毯上发呆');
    this.arrived('lieRug');
    await this.sleep(rand(20, 45), tk);
  }

  async a_sitHere(tk) {
    this.setDoing('原地坐下');
    await this.standUp(tk);
    if (this.actor.surface === 'floor') await this.actor.turnTo(this.camYaw(), tk);
    await this.settlePhone(tk);
    this.pose('sitFloor', 'sit');
    this.arrived('sitHere');
    this.face('smile'); this.anim.lookAt(this.camera.position);
    await this.sleep(rand(15, 30), tk);
  }

  /** 刷手机：先去把手机拿过来，靠在枕头上，再趴到它对面托着腮看。 */
  async a_phone(tk) {
    const { anim, phone, actor } = this;
    this.setDoing('去拿手机');
    await this.fetchPhone(tk, 'feed');
    this.setDoing('把手机靠在枕头上');
    await this.go(PILLOW_SPOT, tk);
    anim.setArms('phone');
    this.pose('kneel', 'sit');
    anim.lean = 0.55;
    await this.sleep(0.4, tk);
    phone.lean(); anim.setArms('auto');
    await this.sleep(0.45, tk);
    this.unbend();
    // 往后挪一点，趴下
    this.pose('stand', 'stand'); await this.sleep(0.3, tk);
    await actor.walk([PRONE_SPOT], tk, 'sneak', { back: true });
    anim.setBase('stand'); await actor.turnTo(PRONE_SPOT.yaw, tk);
    this.pose('kneel', 'sit'); await this.sleep(0.35, tk);
    this.pose('lieProne', 'lie');
    anim.lookAt(null); // 趴着时脸本来就朝着手机，头的角度由姿势定
    this.setDoing('趴在床上刷手机');
    this.arrived('phone');
    const end = this.clock.now + rand(30, 80);
    while (this.clock.now < end) {
      await this.sleep(rand(3, 7), tk);
      // 伸手划一下屏幕
      anim.reach('R', phone.worldPos(this.reachR));
      await this.sleep(0.32, tk);
      phone.swipe();
      await this.sleep(0.16, tk);
      anim.reach('R', null);
      const r = Math.random();
      if (r < 0.3) this.react('happy', 'bounce', '♪', 2.2);
      else if (r < 0.45) this.react('surprise', null, '❗', 1.6);
      else if (r < 0.6) this.react('smug', 'flap', null, 2);
      else this.face('neutral');
    }
    // 看够了：手机就留在枕头上靠着（过一会儿自己熄屏），起来干别的
    this.face('neutral'); anim.lookAt(null);
    phone.sleep();
  }

  /**
   * 看窗外。三种待法，待久了会自己换：stand 站着扒着玻璃 | sit 抱着膝盖坐在窗台上 | side 斜坐在窗台上托着腮。
   * @param variant 指定一种；不给就随机挑
   */
  async a_window(tk, variant) {
    const { anim, actor } = this, e = this.env.state;
    const KINDS = ['stand', 'sit', 'side'];
    let kind = KINDS.includes(variant) ? variant : pick(KINDS);
    this.setDoing('想去窗边看看');
    const what = e.weather === 'rain' ? '看雨' : e.weather === 'snow' ? '看雪' : e.dark > 0.7 ? '看夜景' : '看风景';
    const settle = async () => {
      if (kind === 'stand') {
        const spot = pick(WINDOW_SPOTS); // 站在一扇窗格的正中，不站中间那根窗框后面（从外面看会挡住脸）
        await this.go(spot, tk);
        await this.settlePhone(tk);
        this.pose('watch', 'stand'); anim.setArms('auto'); anim.lookAt(new THREE.Vector3(spot.x + 3.2, 1.0, -9));
        this.setDoing(`趴在窗边${what}`);
      } else if (kind === 'sit') {
        await this.go(PLACES.sillSit, tk);
        await this.settlePhone(tk);
        this.pose('hugKnees', 'sit'); anim.setArms('auto'); anim.lookAt(new THREE.Vector3(-0.4, 1.2, -6));
        this.setDoing(`抱着膝盖坐在窗台上${what}`);
      } else {
        await this.go({ ...PLACES.sillSit, yaw: Math.PI / 2 + 0.45 }, tk);
        await this.settlePhone(tk);
        this.pose('sitFloor', 'sit', { turn: 0.5 }); anim.setArms('chin'); anim.lookAt(new THREE.Vector3(0.6, 1.25, -6));
        this.setDoing(`斜坐在窗台上托着腮${what}`);
      }
    };
    await settle();
    this.arrived('window');
    this.face(e.weather === 'snow' ? 'joy' : 'smile');
    const end = this.clock.now + rand(30, 90);
    while (this.clock.now < end) {
      await this.sleep(rand(5, 10), tk);
      const r = Math.random();
      if (r < 0.3) this.ui.emote(e.weather === 'rain' ? '🌧️' : e.weather === 'snow' ? '❄️' : e.dark > 0.7 ? '⭐' : '☀️', 2.5);
      else if (r < 0.5) this.react('happy', 'flap', null, 2);
      else if (r < 0.62 && kind === 'stand') await this.g('bounce', tk);
      else if (r < 0.84 && !variant) { kind = pick(KINDS.filter((k) => k !== kind)); await settle(); } // 换个姿势接着看
    }
    anim.setArms('auto');
  }

  /**
   * 玩电脑。给了 video（聊天里分享的 B 站视频，或者她自己要看的）就专心看它：屏幕上是它的封面、标题和进度；
   * 给了 page（她的 AI 本体在上网冲浪，看到哪一页就报过来）就看那一页，后面报来的新一页直接换上；
   * 都没给就随便刷刷、偶尔敲敲键盘。
   */
  async a_computer(tk, video = null, page = null) {
    const scr = this.room.laptop.screen;
    if (page) return this.browse(tk, page);
    this.setDoing(video ? `去电脑上看《${shortTitle(video.title)}》` : '想去玩电脑');
    await this.go(PLACES.computer, tk);
    await this.settlePhone(tk); // 手机搁在笔记本旁边的桌面上，回消息时伸手就能拿
    this.pose('kneel', 'sit');
    this.room.laptop.set(true);
    this.face('smile');
    this.anim.lookAt(new THREE.Vector3(1.12, 0.9, -1.6));
    if (video) {
      scr.showVideo(video);
      if (this.video === video) this.video = null;
      this.setDoing(`在电脑上看《${shortTitle(video.title)}》`);
      this.arrived('computer');
      const end = this.clock.now + clamp(video.duration || 90, 30, 240); // 长视频不看完，最多看四分钟
      while (this.clock.now < end) {
        await this.sleep(rand(4, 8), tk);
        const r = Math.random();
        if (r < 0.4) this.react(pick(['happy', 'joy', 'surprise', 'smug', 'think']), chance(0.4) ? 'bounce' : null, chance(0.35) ? pick(['♪', '❗', '💭']) : null, 2.2);
        else if (r < 0.55) this.anim.gesture('tilt');
      }
      scr.clearVideo();
      this.setDoing('看完了');
      this.face('happy'); await this.sleep(1.2, tk);
      return;
    }
    this.setDoing('坐在笔记本前刷视频');
    this.arrived('computer');
    const end = this.clock.now + rand(40, 120);
    while (this.clock.now < end) {
      const r = Math.random();
      if (r < 0.35) { this.anim.setArms('auto'); await this.sleep(rand(3, 7), tk); if (chance(0.5)) this.react(pick(['happy', 'joy', 'surprise', 'smug']), chance(0.5) ? 'bounce' : null, chance(0.4) ? '♪' : null, 2); }
      else if (r < 0.65) { this.anim.setArms('auto'); this.anim.gesture('swipe'); scr.swipeNow(); await this.sleep(rand(1.5, 3.5), tk); }
      else { this.anim.setArms('type'); this.face('focus'); await this.sleep(rand(2, 5), tk); this.face('smile'); }
    }
  }

  /** 上网冲浪：坐到电脑前看这一页。看的时候又报来新的一页（order 里的 browse），就地换上、再多待一会儿。 */
  async browse(tk, page) {
    const scr = this.room.laptop.screen;
    const act = this.cur;
    this.setDoing(`去电脑上看${page.site}`);
    await this.go(PLACES.computer, tk);
    await this.settlePhone(tk);
    this.pose('kneel', 'sit');
    this.room.laptop.set(true);
    this.face('focus');
    this.anim.lookAt(new THREE.Vector3(1.12, 0.9, -1.6));
    if (act) act.browsing = true;
    this.showPage(page);
    this.arrived('computer');
    while (this.clock.now < this.browseUntil) {
      await this.sleep(rand(4, 9), tk);
      const r = Math.random();
      if (r < 0.25) this.react(pick(['think', 'surprise', 'smile', 'happy']), chance(0.3) ? 'tilt' : null, chance(0.3) ? pick(['💭', '❗', '❓']) : null, 2.2);
      else if (r < 0.45) { this.anim.setArms('type'); this.face('focus'); await this.sleep(rand(1.5, 3.5), tk); this.anim.setArms('auto'); this.face('smile'); }
    }
    if (act) act.browsing = false;
    scr.clearPage();
    this.setDoing('上完网了');
    this.face('smile'); await this.sleep(1, tk);
  }
  /** 屏幕换成这一页，再多看两分半。 */
  showPage(page) {
    this.room.laptop.screen.showPage(page);
    this.browseUntil = this.clock.now + 150;
    this.setDoing(`在电脑上看${page.site}：《${shortTitle(page.title || '网页')}》`);
  }

  /**
   * 拍照的对象：去哪儿站着、镜头对着哪一点。
   * @returns { label: 拍的是什么, go(tk): 走到能拍的地方, aim(): 镜头对准的世界坐标, low: 东西在地上（跪下拍）, after(tk): 拍完收尾 }
   */
  photoSubject(what) {
    const { kitchen, actor } = this, bowl = kitchen.bowl, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const near = (x, z, d) => (tk) => this.go(this.spotNear(x, z, d), tk);
    switch (what) {
      case 'window': {
        const spot = pick(WINDOW_SPOTS);
        return { label: '窗外', go: (tk) => this.go(spot, tk), aim: () => V(spot.x + 0.25, 1.5, -6) };
      }
      case 'food': {
        const p = bowl.group.position, aim = () => V(p.x, p.y + 0.03, p.z);
        if (bowl.rice > 0.03 && bowl.where === 'floor') return { label: '碗里的饭', go: near(p.x, p.z, 0.25), aim }; // 吃到一半搁在地上的那碗
        // 碗是空的：先盛一碗搁在托盘上（手里要端碗，所以这一步在拿手机之前），再拿手机来拍，拍完端起来吃掉
        return {
          label: '刚盛的一碗饭', aim,
          prep: async (tk) => {
            if (bowl.rice <= 0.03) {
              this.setDoing('先盛一碗饭');
              await this.serveRice(tk);
              await actor.turnTo(RICE_SPOT.yaw - 0.74, tk);
              this.pose('kneel', 'sit'); this.anim.setArms('eat'); this.anim.lean = 0.6;
              await this.sleep(0.5, tk);
              bowl.toTable(); this.anim.setArms('auto');
              await this.sleep(0.4, tk);
              this.unbend(); this.pose('stand', 'stand'); await this.sleep(0.3, tk);
            }
          },
          go: async (tk) => { await this.toCooker(tk); await this.actor.walk([{ x: p.x - 0.25, z: p.z }], tk, 'walk'); this.anim.setBase('stand'); },
          after: async () => { if (bowl.rice > 0.03) this.queue.unshift(this.act('eat')); }, // 拍完就吃
        };
      }
      case 'plant': return { label: '盆栽', go: near(PLANT.x, PLANT.z, 0.7), aim: () => V(PLANT.x, 0.5, PLANT.z) };
      case 'laptop': return { label: '电脑', go: (tk) => this.go(PLACES.computer, tk), aim: () => V(1.12, 0.86, -1.52) };
      case 'ball': { const b = this.ball.pos; return { label: '小球', go: near(b.x, b.z, 0.4), aim: () => V(b.x, 0.07, b.z), low: true }; }
      case 'bed': return { label: '床', go: (tk) => this.go({ surface: 'floor', x: -0.75, z: -0.3 }, tk), aim: () => V(-1.15, 0.5, -1.25) };
      case 'room': return { label: '房间', go: (tk) => this.go({ surface: 'floor', x: 0.85, z: 1.3 }, tk), aim: () => V(-0.6, 0.6, -0.8) };
      default: { // ahead：就拍她面前的东西
        const a = actor;
        return { label: '面前的东西', go: async () => {}, aim: () => V(a.pos.x + Math.sin(a.yaw) * 1.5, a.pos.y + 0.22, a.pos.z + Math.cos(a.yaw) * 1.5) };
      }
    }
  }

  /**
   * 拍照，照片发到主人的 QQ。
   * @param what selfie 自拍 | window 窗外 | food 饭 | plant 盆栽 | laptop 电脑 | ball 小球 | bed 床 | room 房间 | ahead 面前的东西
   */
  async a_photo(tk, what = 'selfie') {
    const { anim, actor, phone, body } = this;
    let shot, label = '自拍';
    if (what === 'selfie') {
      this.setDoing('拿手机自拍');
      await this.fetchPhone(tk, 'chat');
      this.pose('stand', 'stand'); await this.sleep(0.3, tk);
      await actor.turnTo(this.camYaw(), tk);
      // 自拍的镜头：在她脸前面大半米、比眼睛高一点的地方，对着脸和上半身
      const head = actor.headTop(new THREE.Vector3()); head.y -= 0.18; // 脸的中心
      const pose = { pos: new THREE.Vector3(head.x + Math.sin(actor.yaw) * 0.8, head.y + 0.12, head.z + Math.cos(actor.yaw) * 0.8), target: new THREE.Vector3(head.x, head.y - 0.07, head.z), fov: 40, w: 960, h: 1280 };
      anim.setArms('selfie'); this.face('happy'); anim.lookAt(pose.pos);
      await this.sleep(1.0, tk);
      this.ui.flash(); this.sfx('shutter');
      shot = this.capture ? await this.capture(pose) : { ok: false, error: '这个页面拍不了照' };
      await this.sleep(0.5, tk);
      anim.setArms('phone'); anim.lookAt(null);
    } else {
      // 拍东西：拿上手机，走到能拍的地方，转过去，把手机横着举在胸前对准它
      const subj = this.photoSubject(what);
      label = subj.label;
      if (subj.prep) await subj.prep(tk);
      this.setDoing(`拿手机去拍${label}`);
      await this.fetchPhone(tk, 'chat');
      this.pose('stand', 'stand'); await this.sleep(0.25, tk);
      await subj.go(tk);
      const target = subj.aim();
      await actor.facePoint(target.x, target.z, tk);
      if (subj.low) this.pose('kneel', 'sit'); else this.pose('stand', 'stand');
      // 拍脚边低处的东西（碗）：身子往前探，把手机伸出去，不然她自己的裙摆会挡在画面下面
      const down = actor.pos.y + 0.24 - target.y, flat = Math.hypot(target.x - actor.pos.x, target.z - actor.pos.z);
      anim.lean = !subj.low && down > flat * 0.6 ? 0.45 : 0;
      this.setDoing(`在拍${label}`);
      anim.setArms('auto');
      phone.aim(body, target);
      anim.reach('L', phone.gripL); anim.reach('R', phone.gripR);
      anim.lookAt(target); this.face('focus');
      await this.sleep(1.1, tk); // 等手机端稳、对准
      const lens = phone.lens();
      this.ui.flash(); this.sfx('shutter');
      shot = this.capture ? await this.capture({ pos: lens.pos.clone(), target: lens.pos.clone().add(lens.dir), fov: 56, w: 1280, h: 960 }) : { ok: false, error: '这个页面拍不了照' };
      await this.sleep(0.4, tk);
      anim.reach('L', null); anim.reach('R', null); anim.lookAt(null); anim.lean = 0;
      phone.hold(body, 'chat'); anim.setArms('phone');
      await this.sleep(0.35, tk);
      if (subj.after) { this.pose('stand', 'stand'); await this.sleep(0.2, tk); await subj.after(tk); }
      this.pose('stand', 'stand');
    }
    if (shot.ok) {
      const note = what === 'selfie' ? '' : `拍了${label}，`;
      this.ui.showPhoto(shot.image, shot.sent ? `${note}已经发到你的 QQ 了` : `${note}存在了 ${shot.file}（${shot.note ?? '没发到 QQ'}）`);
      this.ui.emote('📸', 2); this.setDoing(shot.sent ? `把${label}的照片发给你了` : '拍好了，但没发到 QQ');
    } else { this.ui.emote('❓', 2); this.setDoing('没拍成'); console.warn('[拍照] ' + shot.error); }
    // 照片已经拍好、发出去了（或者没成）：在等结果的那边这就可以回主人了，不用等她把手机收好
    if (this.cur?.name === 'photo') {
      this.cur.result = { photo: { subject: label, taken: Boolean(shot.ok), sentToQQ: Boolean(shot.sent), file: shot.file ?? null, note: shot.ok ? (shot.note ?? null) : (shot.error ?? '没拍成') } };
      // 她要接着回你的话，等她拿着手机准备打字时再报（见 pickUpToReply）；不然她那句回复会赶在这之前到
      if (!this.cur.thenReply) this.arrived('photo');
    }
    this.face('smile');
    await this.sleep(1.6, tk);
  }

  /** 去按一下小音箱：让这台 Mac 的「音乐」App 放歌单 / 停下 / 下一首。mode: on | off | toggle | next。 */
  async a_music(tk, mode = 'toggle') {
    const sp = this.speaker, { anim, actor } = this;
    const on = mode === 'on' || mode === 'next' ? true : mode === 'off' ? false : !sp.playing;
    const mine = this.cur?.name === 'music'; // 睡前顺手关音乐时，结果不算在「睡觉」头上
    if (mode !== 'next' && on === sp.playing) { if (mine) this.cur.result = { music: { playing: sp.playing, note: sp.playing ? '本来就在放' : '本来就没在放' } }; return; }
    this.setDoing(mode === 'next' ? '去换一首歌' : on ? '想听歌，去开小音箱' : '去把音乐关掉');
    await this.go(this.spotNear(sp.x, sp.z, 0.25), tk);
    await actor.facePoint(sp.x, sp.z, tk);
    this.pose('kneel', 'sit');
    await this.bendTo(sp.button, null, tk, { lean: 0.3, sec: 0.45 });
    this.sfx('click');
    const r = await this.musicCall(mode === 'next' ? 'next' : on ? 'play' : 'pause');
    if (mine) this.cur.result = { music: r.ok ? { playing: r.playing, track: r.track ?? null, artist: r.artist ?? null } : { playing: sp.playing, error: r.error } };
    this.unbend();
    if (r.ok) {
      sp.setPlaying(r.playing);
      this.ui.setMusic(r.playing ? `${r.track ?? ''}${r.artist ? ' — ' + r.artist : ''}` : null);
      if (r.playing) { this.musicUntil = this.clock.now + rand(15, 25) * 60; this.face('happy'); this.ui.emote('♪', 2.5); anim.gesture('bounce'); this.setDoing('放上歌了'); }
      else this.setDoing('把音乐关了');
    } else {
      // 没放出来（没有这个歌单、不是 Mac、没给权限……）：原因写在控制台和她的心里话里
      console.warn('[音乐] ' + r.error);
      this.face('think'); this.ui.emote('❓', 2); this.think('咦，音箱没反应…'); this.setDoing('音箱没放出歌来');
    }
    this.nextMusicAt = this.clock.now + rand(40, 70) * 60;
    await this.sleep(0.8, tk);
    this.pose('stand', 'stand'); await this.sleep(0.35, tk);
  }
  /** 让服务端去控制「音乐」App。action: play | pause | next | state。 */
  async musicCall(action) {
    try { return await (await fetch('/api/music', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })).json(); }
    catch (err) { return { ok: false, error: '连不上本地服务：' + (err?.message ?? err) }; }
  }

  /** 心里话 / 碎碎念：头顶冒一个云朵气泡，不打断手头的事。 */
  think(text) {
    const t = String(text ?? '').replace(MONOLOGUE, '').replace(/[）)]\s*$/, '').trim().slice(0, 200);
    if (!t) return;
    const dur = clamp(2.4 + t.length * 0.17, 3, 13);
    this.ui.thought(t, dur);
    if (!this.chatting && this.posture !== 'sleep' && !['happy', 'joy', 'love'].includes(this.char.face.expr)) this.react('think', null, null, Math.min(dur, 3));
  }

  /** 看书：从书架上拿一本（或者捡起上次搁下的那本），窝到懒人垫上看；看完放回书架。 */
  async a_read(tk) {
    const { anim, actor, book } = this;
    if (this.bookAt === 'shelf') {
      this.setDoing('去书架挑本书');
      await this.go(PLACES.bookshelf, tk);
      anim.gesture('reach'); await this.sleep(0.6, tk);
      // 书从书架上抽出来，到她手里
      book.group.position.copy(SHELF_POINT); book.group.quaternion.setFromAxisAngle(UP, -Math.PI / 2);
      book.group.visible = true;
      this.holdBook();
      await this.sleep(0.6, tk);
    } else if (this.bookAt === 'down') {
      this.setDoing('去捡刚才那本书');
      const b = book.group.position;
      await this.go(this.spotNear(b.x, b.z, 0.22), tk);
      await actor.facePoint(b.x, b.z, tk);
      this.pose('kneel', 'sit');
      await this.bendTo(this.reachR.set(b.x, 0.03, b.z), this.reachL.set(b.x, 0.03, b.z), tk, { lean: 0.6 });
      this.holdBook();
      await this.sleep(0.3, tk);
      this.unbend();
      this.pose('stand', 'stand'); await this.sleep(0.3, tk);
    }
    await this.go(PLACES.cushion, tk, 'walk');
    anim.setArms('book');
    const exit = { x: actor.pos.x, y: 0, z: actor.pos.z, surface: 'floor' };
    await actor.turnTo(Math.atan2(CUSHION.x - actor.pos.x, CUSHION.z - actor.pos.z), tk);
    this.perch = { exit }; // 先记下从哪儿上去的：跳上去的半路被打断、人已经落在垫子上时，也知道该从哪儿下来
    await actor.jump({ x: CUSHION.x, y: CUSHION.top, z: CUSHION.z, surface: 'cushion' }, tk, { height: 0.14 });
    this.cushionSat = true; this.drapeY = 0; // 垫子被压扁；垂下来的头发落到地板上，而不是摊在垫子那么高的半空
    await actor.turnTo(0.5, tk);
    this.pose('sitFloor', 'sit');
    this.setDoing('窝在懒人垫上看书');
    this.arrived('read');
    this.face('focus');
    const end = this.clock.now + rand(40, 100);
    while (this.clock.now < end) {
      await this.sleep(rand(5, 9), tk);
      anim.gesture('flipPage'); this.flip = 0.0001;
      if (chance(0.3)) this.react(pick(['smile', 'surprise', 'happy', 'think']), null, null, 2.5);
      else if (chance(0.12)) { this.face('sleepy'); await this.g('yawn', tk); this.face('focus'); }
    }
    // 看完了：把书放回书架
    this.face('smile');
    this.setDoing('把书放回书架');
    await this.go(PLACES.bookshelf, tk);
    anim.gesture('reach'); await this.sleep(0.5, tk);
    this.bookAt = 'shelf'; anim.setArms('auto');
    this.bookCarry.to((pos, quat) => { pos.copy(SHELF_POINT); quat.setFromAxisAngle(UP, -Math.PI / 2); }, 0.4, 0.02);
    await this.sleep(0.45, tk);
    book.group.visible = false;
    await this.sleep(0.4, tk);
  }
  /**
   * 书到手里：之后跟着手走。书页朝上、往她脸那边斜一点，书顶朝外（她是读的人，不是举给别人看）：
   * 先绕竖轴转半圈让书页对着她，再往后仰到书页朝上。
   */
  holdBook() {
    this.bookAt = 'hand'; this.anim.setArms('book');
    this.bookCarry.to((pos, quat) => { this.body.inLeftHand(this.bookOff, pos); quat.copy(this.body.quat('spine', _q)).multiply(BOOK_TILT); }, 0.35, 0.02);
  }

  /**
   * 吃饭：到矮几前按开电饭煲，端起碗，用勺子从锅里舀三勺饭，合上盖子；端到地毯上坐下，一勺一勺吃完；最后把碗送回矮几。
   * 吃到一半被叫走时碗会先搁在地上，回头再来就是接着吃。meal 是饭点标记（到点自己去吃时才有）。
   */
  async a_eat(tk, meal = null) {
    const { anim, ui, kitchen, actor, body } = this, { bowl, spoon, cooker } = kitchen;
    if (meal) this.mealPending = meal;
    const name = this.mealPending ? this.mealPending.slice(-2) : '饭';
    const toCooker = (style) => this.toCooker(tk, style);
    const pressButton = (open) => this.cookerLid(tk, open);
    this.face('happy');
    if (bowl.where === 'table' && bowl.rice <= 0.03) {
      this.setDoing(this.mealPending ? `到点了，去盛${name}` : '肚子饿了，去盛饭');
      ui.emote('🍚', 2);
      await this.serveRice(tk, 'skip');
    } else if (bowl.where === 'table') {
      // 托盘上已经盛好一碗（拍照时盛的）：端起来
      this.setDoing('去端那碗饭');
      await toCooker('walk');
      const bp = bowl.group.position;
      await actor.facePoint(bp.x, bp.z, tk);
      bowl.gripPoints(actor.yaw, this.reachL, this.reachR);
      await this.bendTo(this.reachR, this.reachL, tk, { lean: 0.6, sec: 0.5 });
      bowl.take(body); anim.setArms('eat');
      await this.sleep(0.25, tk);
      this.unbend();
      this.pose('stand', 'stand'); await this.sleep(0.4, tk);
    } else if (bowl.where === 'floor') {
      // 上次搁在地上的碗：走过去端起来
      this.setDoing(bowl.rice > 0.03 ? '回去接着吃' : '去把碗收了');
      const bp = bowl.group.position;
      await this.go(this.spotNear(bp.x, bp.z, 0.21), tk);
      await actor.facePoint(bp.x, bp.z, tk);
      this.pose('kneel', 'sit');
      bowl.gripPoints(actor.yaw, this.reachL, this.reachR);
      await this.bendTo(this.reachR, this.reachL, tk, { lean: 0.6 });
      bowl.take(body); anim.setArms('eat');
      await this.sleep(0.25, tk);
      this.unbend();
      this.pose('stand', 'stand'); await this.sleep(0.35, tk);
    }
    anim.setArms('eat');
    if (bowl.rice > 0.03) {
      // 端到地毯上坐下吃
      const far = Math.hypot(actor.pos.x - EAT_SPOT.x, actor.pos.z - EAT_SPOT.z) > 0.5;
      if (far) await this.go(EAT_SPOT, tk, 'walk'); else await this.standUp(tk);
      anim.setArms('eat');
      await actor.turnTo(this.camYaw(), tk);
      this.pose('sitFloor', 'sit');
      await this.sleep(0.5, tk);
      spoon.use(body, true); anim.hand.spoon = true;
      this.setDoing(this.mealPending ? `在吃${name}：一大碗白饭` : '在吃大白饭');
      this.arrived('eat'); // 坐下开吃就算到位（吃完、洗完碗还要一两分钟）
      this.face('happy');
      await this.sleep(0.4, tk);
      const step = 1 / 9;
      while (bowl.rice > 0.03) {
        spoon.loaded = true; // 舀起一勺
        bowl.dirty = true;
        bowl.setRice(Math.max(0, bowl.rice - step));
        this.biteTarget = 1; await this.sleep(0.62, tk); // 送到嘴边
        spoon.loaded = false;
        this.char.face.speak(1.6); // 嚼
        await this.sleep(0.35, tk);
        this.biteTarget = 0;
        const r = Math.random();
        if (r < 0.3) this.react('happy', null, '♪', 1.6); else if (r < 0.45) this.react('joy', 'bounce', '🍚', 1.6);
        await this.sleep(rand(1.2, 2.1), tk);
      }
      spoon.use(body, false); anim.hand.spoon = false;
      this.face('love'); ui.emote('✨', 2); anim.gesture('wiggle');
      this.setDoing('吃饱了');
      this.mood = clamp(this.mood + 0.25, -1, 1); anim.finMood = this.mood;
      this.ateMeal = this.mealPending ?? this.mealNow() ?? this.ateMeal;
      this.mealPending = null;
      try { if (this.ateMeal) localStorage.setItem('whale.ateMeal', this.ateMeal); } catch (err) { console.debug('记不住这顿饭吃过了（本地存储不可用）', err); }
      await this.sleep(1.4, tk);
    }
    // 吃完洗碗：端到洗碗架前站好，拧开水龙头，用海绵擦一擦，冲干净。
    // 盆架和电饭煲差不多高，站着微微弯腰（跟舀饭时一样）就够得着；以前盆放得很低，她跪下去弯腰，头都埋进盆里了
    if (bowl.dirty) {
      const { sink } = kitchen;
      this.setDoing('去洗碗');
      this.face('smile');
      await this.go(SINK_SPOT, tk, 'walk'); await actor.walk([SINK_NEAR], tk, 'walk'); anim.setBase('stand'); await actor.turnTo(SINK_SPOT.yaw, tk);
      anim.setArms('eat');
      this.pose('stand', 'stand');
      await this.bendTo(sink.knob, null, tk, { lean: 0.15, sec: 0.5 });
      sink.setTap(true);
      await this.sleep(0.2, tk);
      anim.reach('R', null);
      this.setDoing('在洗碗');
      // 两只手把碗按进盆里（碗跟着左手），右手拿海绵在碗里画圈
      anim.lean = 0.22;
      const b = sink.basin;
      anim.reach('L', this.reachL.set(b.x - 0.02, b.y + 0.035, b.z - 0.05));
      anim.lookAt(b);
      await this.sleep(0.5, tk);
      sink.useSponge(body, true); sink.setSuds(true);
      const t0 = this.clock.now;
      while (this.clock.now - t0 < 3.6) {
        const a = (this.clock.now - t0) * 7;
        anim.reach('R', this.reachR.set(b.x - 0.035 + Math.cos(a) * 0.018, b.y + 0.07, b.z + 0.012 + Math.sin(a) * 0.018));
        await this.sleep(0.05, tk);
      }
      sink.setSuds(false);
      this.react('happy', null, '✨', 1.6);
      await this.sleep(0.9, tk); // 冲一冲
      sink.useSponge(body, false);
      bowl.dirty = false;
      await this.bendTo(sink.knob, null, tk, { lean: 0.15, sec: 0.45 });
      sink.setTap(false);
      this.unbend(); anim.lookAt(null);
      this.pose('stand', 'stand'); await this.sleep(0.45, tk);
    }
    // 把洗好的碗放回托盘
    this.setDoing('把碗放回去');
    this.face('smile');
    await toCooker('walk');
    anim.setArms('eat');
    await actor.turnTo(RICE_SPOT.yaw - 0.74, tk); // 转向碗原来放的地方（电饭煲右前方）
    this.pose('kneel', 'sit'); anim.setArms('eat');
    anim.lean = 0.6;
    await this.sleep(0.5, tk);
    bowl.toTable(); anim.setArms('auto');
    await this.sleep(0.4, tk);
    this.unbend();
    this.pose('stand', 'stand'); await this.sleep(0.4, tk);
  }

  /**
   * 跳舞。两套随机挑一套：classic 原来那套（左右摇摆举手、张开手转圈、蹦蹦跳跳，随便串几段）；
   * sway 照着主人给的视频编的那段（右手一指起势 → 叉腰扭胯 → 边扭边转一圈 → 张开手臂左右晃 → 叉腰歪着扭 → 再转一圈）。
   */
  async a_dance(tk, kind) {
    this.setDoing('想跳舞');
    await this.go({ surface: 'floor', x: RUG.x + rand(-0.3, 0.3), z: RUG.z + rand(-0.2, 0.3) }, tk, 'skip');
    await this.actor.turnTo(this.camYaw(), tk);
    this.setDoing('在地毯上跳舞');
    this.face('happy');
    if ((kind ?? (chance(0.5) ? 'classic' : 'sway')) === 'sway') await this.danceSway(tk);
    else {
      const n = 2 + Math.floor(rand(2));
      for (let i = 0; i < n; i++) {
        const style = Math.floor(rand(3));
        this.pose('dance', 'stand', { style });
        this.actor.spin = style === 1 ? 3.4 : 0;
        this.ui.emote('♪', 2);
        await this.sleep(rand(4.5, 8), tk);
        if (style === 1) { this.actor.spin = 0; await this.actor.turnTo(this.camYaw(), tk); }
      }
    }
    this.actor.spin = 0;
    this.pose('stand', 'stand');
    this.face('joy'); await this.g('cheer', tk);
    this.mood = clamp(this.mood + 0.2, -1, 1);
    this.face('smile');
  }
  /** 第二支舞（一拍约 0.62 秒，每段都是整拍数）。 */
  async danceSway(tk) {
    const { actor, ui } = this, beat = 0.62, front = actor.yaw;
    const spin = async (beats) => { actor.spin = TAU / (beats * beat); await this.sleep(beats * beat, tk); actor.spin = 0; await actor.turnTo(front, tk); };
    this.face('smug'); this.pose('dance', 'stand', { style: 5 }); ui.emote('♪', 2);
    await this.sleep(beat * 3, tk);
    this.face('happy'); this.pose('dance', 'stand', { style: 3 });
    await this.sleep(beat * 8, tk);
    await spin(4); // 叉着腰边扭边转一圈
    this.face('joy'); this.pose('dance', 'stand', { style: 4 }); ui.emote('♪', 2);
    await this.sleep(beat * 8, tk);
    this.face(pick(['cat', 'smug', 'happy'])); this.pose('dance', 'stand', { style: 3, lean: chance(0.5) ? 0.7 : -0.7 });
    await this.sleep(beat * 6, tk);
    if (chance(0.6)) { this.pose('dance', 'stand', { style: 3 }); await spin(4); }
  }

  // ---------------- 打拳 ----------------
  /** 摆一个打拳的招式，持续 dur 秒（见 animator.js 的 BASE.box）。 */
  boxPose(move, dur) { this.pose('box', 'stand', { move, t0: this.anim.t, dur }); }
  /**
   * 打拳（空击）：在地毯上面朝你，先侧身一拳亮个相，然后护着脸蹦跶着打几组组合拳——刺拳、直拳、左摆拳、右上勾拳、
   * 下潜躲闪，打一会儿喘口气，再来几组。
   */
  async a_box(tk) {
    const { ui } = this;
    this.setDoing('想打会儿拳');
    const p = this.nav.nearestFree(0.1 + rand(-0.15, 0.15), 0.4 + rand(-0.1, 0.15));
    await this.go({ surface: 'floor', x: p.x, z: p.z }, tk);
    await this.actor.turnTo(this.camYaw(), tk);
    this.setDoing('在地毯上打拳');
    this.face('focus');
    this.boxPose('side', 1); this.sfx('swish', 0.5); await this.sleep(1.3, tk);
    this.boxPose('guard', 1); await this.sleep(0.8, tk);
    const COMBOS = [['jab'], ['jab', 'jab'], ['jab', 'cross'], ['jab', 'jab', 'cross'], ['jab', 'cross', 'hook'], ['weave', 'hook'], ['cross', 'hook', 'upper'], ['weave', 'upper'], ['jab', 'weave', 'cross'], ['hook', 'cross']];
    const DUR = { jab: 0.42, cross: 0.5, hook: 0.6, upper: 0.65, weave: 0.8 };
    const round = async (n) => {
      for (let i = 0; i < n; i++) {
        for (const mv of pick(COMBOS)) {
          this.boxPose(mv, DUR[mv]);
          if (mv !== 'weave') { await this.sleep(DUR[mv] * (mv === 'jab' || mv === 'cross' ? 0.18 : 0.3), tk); this.sfx('swish', 0.4); await this.sleep(DUR[mv] * (mv === 'jab' || mv === 'cross' ? 0.82 : 0.7), tk); }
          else await this.sleep(DUR[mv], tk);
        }
        if (chance(0.25)) this.react(pick(['focus', 'angry', 'smug']), null, chance(0.4) ? '💢' : null, 1.2);
        this.boxPose('guard', 1); await this.sleep(rand(0.5, 1.1), tk);
      }
    };
    await round(4 + Math.floor(rand(3)));
    // 喘口气
    this.boxPose('rest', 1); this.face('happy'); ui.emote('💦', 2);
    await this.sleep(rand(1.8, 2.6), tk);
    if (chance(0.6)) { this.face('focus'); this.boxPose('guard', 1); await this.sleep(0.6, tk); await round(2 + Math.floor(rand(2))); this.boxPose('rest', 1); this.face('happy'); await this.sleep(1.2, tk); }
    this.pose('stand', 'stand');
    this.mood = clamp(this.mood + 0.15, -1, 1);
    this.face('joy'); ui.emote('✨', 2); await this.g('bounce', tk);
    this.face('smile');
  }

  // ---------------- 练枪 ----------------
  /** 摆一个练枪的招式，持续 dur 秒（招式的进度按动画时间算，见 animator.js 的 BASE.spear）。 */
  spearPose(move, dur) { this.pose('spear', 'stand', { move, t0: this.anim.t, dur, mirror: this.spearMirror }); }
  /** 枪尖朝哪边（世界坐标的单位向量）：不镜像时是她的左手边。 */
  spearSide() { const y = this.actor.yaw, k = this.spearMirror ? -1 : 1; return { x: Math.cos(y) * k, z: -Math.sin(y) * k }; }
  /** 弓步往枪尖那边送 d 米（地方不够就不挪）。 */
  async lunge(d, dur, tk) {
    const s = this.spearSide(), a = this.actor, x = a.pos.x + s.x * d, z = a.pos.z + s.z * d;
    if (!this.nav.isFree(x, z)) { await this.sleep(dur, tk); return; }
    await a.slide({ x, z }, dur, tk);
  }

  /** 去枪架上把枪拔下来（或者把扔在地上的那杆捡起来）。拿到以后右手握着、枪竖在身边。 */
  async takeSpear(tk) {
    const sp = this.spear, { anim, actor } = this;
    if (sp.at === 'hand') { anim.setArms('spear'); return; }
    if (sp.at === 'home') {
      this.setDoing('去枪架上拿红缨枪');
      await this.go(SPEAR_SPOT, tk);
      await actor.facePoint(SPEAR_HOME.x, SPEAR_HOME.z, tk);
      await this.bendTo(sp.pointAt(0.26, this.reachR), null, tk, { lean: 0.25, sec: 0.45 });
    } else {
      this.setDoing('去把地上的枪捡起来');
      const g = sp.pointAt(0.3, new THREE.Vector3());
      await this.go(this.spotNear(g.x, g.z, 0.2), tk);
      await actor.facePoint(g.x, g.z, tk);
      this.pose('kneel', 'sit');
      await this.bendTo(this.reachR.copy(g), null, tk, { lean: 0.6 });
    }
    this.spearMirror = false;
    anim.setArms('spear'); sp.toHand(this.body, anim, actor, 0.35);
    await this.sleep(0.3, tk);
    this.unbend();
    this.pose('stand', 'stand'); await this.sleep(0.4, tk);
  }
  /** 把手里的枪插回枪架上。 */
  async returnSpear(tk) {
    const sp = this.spear;
    if (sp.at !== 'hand') return;
    this.setDoing('把枪插回枪架上');
    this.spearMirror = false;
    await this.go(SPEAR_SPOT, tk);
    await this.actor.facePoint(SPEAR_HOME.x, SPEAR_HOME.z, tk);
    this.anim.lean = 0.2;
    await this.sleep(0.35, tk);
    sp.toHome(0.45); this.anim.setArms('auto'); this.sfx('thud');
    await this.sleep(0.5, tk);
    this.anim.lean = 0;
    await this.sleep(0.3, tk);
  }

  /**
   * 练枪：去枪架上拿红缨枪，到地毯上面朝你练一段——中平枪、弓步扎、拦拿扎、下势低扎、劈枪、挑枪、转身横扫、跳步扎，
   * 随机串起来，中间会换手换边；练完收势，把枪插回枪架。mode = 'tidy'：只是把扔在地上的枪捡起来放回去，不练。
   */
  async a_spear(tk, mode) {
    const { actor, ui } = this;
    await this.takeSpear(tk);
    if (mode === 'tidy') { this.face('neutral'); await this.returnSpear(tk); return; }
    this.setDoing('拿着枪去地毯上');
    const p = this.nav.nearestFree(0.1 + rand(-0.12, 0.12), 0.35 + rand(-0.08, 0.12));
    await this.go({ surface: 'floor', x: p.x, z: p.z }, tk);
    const front = this.camYaw();
    await actor.turnTo(front, tk);
    this.setDoing('在地毯上练枪');
    // 起势：持枪立正，点一下头
    this.face('focus'); this.spearMirror = false;
    this.spearPose('ready', 1); await this.sleep(0.6, tk);
    await this.g('nod', tk, 0.8);
    this.spearPose('guard', 1); this.sfx('swish', 0.5); await this.sleep(0.9, tk);
    const MOVES = ['thrust', 'thrust', 'circle', 'low', 'chop', 'flick', 'sweep', 'jump'];
    let last = null;
    for (let i = 0, n = 6 + Math.floor(rand(3)); i < n; i++) {
      // 换手换边：枪竖起来交到另一只手，转过去朝另一边
      if (i > 1 && chance(0.28)) {
        this.spearPose('ready', 0.5); await this.sleep(0.45, tk);
        this.spearMirror = !this.spearMirror; this.spear.regrip(this.body, this.anim, actor, 0.3);
        this.spearPose('ready', 0.5); await this.sleep(0.45, tk);
        this.spearPose('guard', 1); this.sfx('swish', 0.5); await this.sleep(0.7, tk);
      }
      let mv = pick(MOVES);
      if (mv === last) mv = pick(MOVES.filter((m) => m !== last));
      last = mv;
      await this.spearMove(mv, tk);
      if (chance(0.25)) this.react('focus', null, pick(['💢', '✨', null]), 1.2);
      this.spearPose('guard', 1); await this.sleep(rand(0.35, 0.8), tk);
    }
    // 收势
    this.spearPose('ready', 1); await this.sleep(0.7, tk);
    await actor.turnTo(front, tk);
    this.spearMirror = false; this.spear.regrip(this.body, this.anim, actor, 0.3);
    this.spearPose('ready', 1); this.sfx('thud', 0.7);
    this.face('smug'); ui.emote('✨', 2);
    await this.sleep(0.5, tk); await this.g('nod', tk, 0.8);
    await this.sleep(0.6, tk);
    this.mood = clamp(this.mood + 0.15, -1, 1);
    this.face('happy');
    this.pose('stand', 'stand');
    await this.returnSpear(tk);
    this.face('smile');
  }
  /** 练枪的一招。 */
  async spearMove(mv, tk) {
    const { actor } = this;
    const strike = async (move, dur, d = 0.07) => { // 扎一下（时间点和 animator.js 的 thrust 对上）：蓄力 → 扎出去时弓步往前送 → 停一下 → 收回来
      this.spearPose(move, dur);
      await this.sleep(dur * 0.28, tk);
      this.sfx('swish');
      await this.lunge(d, dur * 0.14, tk);
      await this.sleep(dur * 0.26, tk);
      await this.lunge(-d, dur * 0.3, tk);
      await this.sleep(dur * 0.02, tk);
    };
    switch (mv) {
      case 'thrust': for (let i = 0, n = 1 + Math.floor(rand(3)); i < n; i++) await strike('thrust', rand(0.9, 1.15)); break;
      case 'low': await strike('low', 1.3, 0.05); break;
      case 'circle': { // 拦拿扎：先画两个圈，再扎（扎的那一下在 0.62 之后，见 animator.js）
        const dur = 2.3;
        this.spearPose('circle', dur);
        await this.sleep(dur * (0.62 + 0.38 * 0.28), tk);
        this.sfx('swish');
        await this.lunge(0.07, dur * 0.38 * 0.14, tk);
        await this.sleep(dur * 0.38 * 0.26, tk);
        await this.lunge(-0.07, dur * 0.38 * 0.3, tk);
        break;
      }
      case 'chop': {
        const dur = 1.5;
        this.spearPose('chop', dur);
        await this.sleep(dur * 0.34, tk); this.sfx('swish');
        await this.lunge(0.05, dur * 0.12, tk); this.sfx('thud', 0.4);
        await this.sleep(dur * 0.28, tk);
        await this.lunge(-0.05, dur * 0.26, tk);
        break;
      }
      case 'flick': this.spearPose('flick', 0.95); await this.sleep(0.12, tk); this.sfx('swish', 0.7); await this.sleep(0.83, tk); break;
      case 'sweep': { // 转身横扫：蹲低，原地转一整圈，枪尖领着扫一圈
        this.spearPose('sweep', 1); await this.sleep(0.35, tk);
        const front = actor.yaw, k = this.spearMirror ? 1 : -1; // 枪尖在左边时往右转，枪尖朝前领着扫
        actor.spin = (k * TAU) / 0.95; this.sfx('swish');
        await this.sleep(0.48, tk); this.sfx('swish', 0.8);
        await this.sleep(0.47, tk);
        actor.spin = 0; await actor.turnTo(front, tk);
        break;
      }
      case 'jump': { // 跳步扎：端着枪原地一蹦，落地接一下扎
        this.spearPose('air', 0.6);
        const a = actor.pos;
        await actor.jump({ x: a.x, y: a.y, z: a.z, surface: actor.surface }, tk, { height: 0.13, keep: true });
        await strike('thrust', 0.9, 0.08);
        break;
      }
      default: this.spearPose('guard', 1); await this.sleep(1, tk);
    }
  }

  async a_play(tk) {
    this.setDoing('去玩球');
    this.face('smile');
    const b = this.ball;
    for (let i = 0; i < 3 + Math.floor(rand(4)); i++) {
      let dir = null, ap = null;
      for (let k = 0; k < 10 && !ap; k++) {
        const a = rand(TAU), dx = Math.sin(a), dz = Math.cos(a);
        const far = { x: b.pos.x + dx * 0.9, z: b.pos.z + dz * 0.9 }, near = { x: b.pos.x - dx * 0.16, z: b.pos.z - dz * 0.16 };
        if (this.nav.isFree(far.x, far.z) && this.nav.isFree(near.x, near.z)) { dir = [dx, dz]; ap = near; }
      }
      if (!ap) { ap = this.nav.nearestFree(b.pos.x, b.pos.z + 0.16); dir = [0, -1]; }
      await this.go({ surface: 'floor', x: ap.x, z: ap.z }, tk, chance(0.6) ? 'run' : 'skip');
      await this.actor.facePoint(b.pos.x, b.pos.z, tk);
      this.setDoing('踢球玩');
      this.anim.gesture('kick');
      await this.sleep(0.3, tk);
      if (Math.hypot(b.pos.x - this.actor.pos.x, b.pos.z - this.actor.pos.z) < 0.4) b.kick(dir[0], dir[1], rand(1.5, 2.4));
      this.anim.lookAt(b.mesh.position);
      this.face('happy');
      await this.clock.until(() => b.speed < 0.25, tk, 2.5);
      if (chance(0.3)) { this.ui.emote('♪', 1.5); await this.g('bounce', tk); }
    }
    this.anim.lookAt(null);
  }

  /** 浇花：先去拿水壶，提到盆栽前倒水，浇完把水壶放回原处。 */
  async a_water(tk) {
    const { anim, actor } = this;
    if (this.canAt !== 'hand') {
      this.setDoing('去拿水壶');
      const r = this.canRest;
      await this.go(this.spotNear(r.x, r.z), tk);
      await actor.facePoint(r.x, r.z, tk);
      this.pose('kneel', 'sit');
      await this.bendTo(this.reachR.set(r.x, 0.085, r.z), null, tk, { lean: 0.6 });
      this.canAt = 'hand'; anim.setArms('water');
      // 提在右手里：壶嘴朝前，倒水时往前倾
      const grip = new THREE.Vector3(-0.07, 0.085, 0);
      this.canCarry.to((pos, quat) => {
        quat.setFromAxisAngle(UP, this.body.yaw - Math.PI / 2).multiply(_q.setFromAxisAngle(Z, -0.6 * this.canTilt));
        this.body.hand('R', pos).sub(_v.copy(grip).applyQuaternion(quat));
      }, 0.3, 0.02);
      await this.sleep(0.3, tk);
      this.unbend();
      this.pose('stand', 'stand'); await this.sleep(0.35, tk);
    }
    this.setDoing('去给盆栽浇水');
    await this.go(PLACES.plant, tk);
    anim.setArms('water');
    await actor.facePoint(PLANT.x, PLANT.z, tk);
    this.setDoing('给盆栽浇水');
    this.face('smile');
    anim.hand.pour = 1;
    await this.sleep(0.6, tk);
    this.pour = 1; this.room.plant.happy = 1;
    for (let i = 0; i < 4; i++) { await this.sleep(1.1, tk); this.room.plant.happy = 1; }
    this.pour = 0; anim.hand.pour = 0;
    this.wateredOn = new Date().toDateString();
    this.face('happy'); this.ui.emote('✨', 2);
    await this.sleep(0.8, tk);
    this.setDoing('把水壶放回去');
    await this.setDownCan(tk, true);
  }

  async a_lamp(tk, on) {
    if (this.room.lamp.on === on) return;
    this.setDoing(on ? '天黑了，去开台灯' : '去关台灯');
    await this.go(PLACES.lamp, tk);
    this.anim.gesture('reach');
    await this.sleep(0.6, tk);
    this.room.lamp.set(on); this.ui.setLamp(on);
    await this.sleep(0.7, tk);
  }

  async a_hide(tk) {
    this.setDoing('想躲起来');
    await this.go(PLACES.underDesk, tk, 'sneak');
    await this.actor.turnTo(this.camYaw(), tk);
    await this.settlePhone(tk);
    this.pose('hugKnees', 'sit');
    this.setDoing('躲在书桌底下');
    this.arrived('hide');
    this.face('shy');
    const end = this.clock.now + rand(15, 30);
    while (this.clock.now < end) {
      this.anim.lookAt(chance(0.6) ? this.camera.position : null);
      await this.sleep(rand(3, 6), tk);
      if (chance(0.3)) this.ui.emote('…', 2);
    }
  }

  /** 睡觉：关灯，把手机放回枕边，去床尾抓住被头，倒退着把被子拖到床头，躺下拉到下巴。 */
  async a_sleep(tk) {
    const { anim, actor, body } = this, q = this.room.quilt;
    if (this.posture !== 'sleep') {
      this.setDoing('困了，准备睡觉');
      if (this.room.lamp.on) { await this.a_lamp(tk, false); this.setDoing('困了，准备睡觉'); }
      await this.standUp(tk);
      this.face('sleepy'); await this.g('yawn', tk);
      if (this.speaker.playing) { await this.a_music(tk, 'off'); this.setDoing('困了，准备睡觉'); } // 睡前把音乐关掉
      if (this.phone.rest.kind !== 'home' && this.phone.state !== 'held') { await this.fetchPhone(tk); await this.stowPhone(tk); } // 睡前把手机拿到枕头边（不管它搁在哪儿）
      this.setDoing('去床尾拿被子');
      await this.go(QUILT_SPOT, tk, 'sneak');
      this.pose('kneel', 'sit');
      const e = q.edgePoint();
      await this.bendTo(this.reachR.set(e.x, e.y, e.z - 0.03), this.reachL.set(e.x, e.y, e.z + 0.03), tk, { lean: 0.6 });
      q.hold((out) => body.hands(out), () => body.blobs());
      anim.setArms('quilt');
      this.unbend();
      this.pose('stand', 'stand'); await this.sleep(0.5, tk);
      this.setDoing('把被子拖到床头');
      await actor.walk([PLACES.bedSleep], tk, 'sneak', { back: true });
      anim.setBase('stand'); await actor.turnTo(PLACES.bedSleep.yaw, tk);
      this.pose('sitFloor', 'sit'); await this.sleep(0.7, tk);
      this.setDoing('钻进被窝');
    }
    this.pose('lieBack', 'sleep', { asleep: true });
    this.face('sleep');
    if (q.mode === 'held') {
      await this.sleep(0.9, tk); // 躺下的同时把被头拉到胸口
      q.cover(body.toWorld('head', body.bind.head).x + 0.03); // 松手：被头落在下巴底下
      anim.setArms('auto');
    }
    this.setDoing('睡着了');
    this.arrived('sleep');
    while (this.shouldSleep()) { this.ui.emote('💤', 2.6); await this.sleep(rand(4, 7), tk); }
    // 自然醒：掀开被子坐起来
    q.throwOff();
    this.pose('sitFloor', 'sit'); this.face('sleepy');
    this.setDoing('睡醒了');
    await this.g('rubEyes', tk); await this.g('stretch', tk);
    this.face('smile');
  }

  // ---------------- QQ 聊天 ----------------
  /**
   * 看手机、聊天。
   * 她的 AI 本体在这期间下的指令（c.order）不会把这一步打断：先把手机拿到手、把你发来的消息看完，再放下手机去做。
   * @param replying 是做完指令后回来拿起手机准备回你：一拿到就开始打字，等她那句回复冒出来。
   */
  async a_chat(tk, replying = false) {
    const { anim, ui, clock, char } = this;
    const c = this.chat;
    this.chatting = true;
    try {
      const ph = this.phone;
      if (this.posture === 'sleep') {
        this.room.quilt.throwOff();
        this.pose('sitFloor', 'sit'); this.face('sleepy'); ui.emote('❓', 1.6);
        this.setDoing('被手机消息吵醒了');
        await this.g('rubEyes', tk);
      } else if (ph.state !== 'held' && !replying) {
        ui.emote('❗', 1.2); this.face('surprise');
        anim.lookAt(ph.worldPos());
        if (this.posture === 'stand') { anim.setBase('stand'); await this.g('surprise', tk); } else await this.sleep(0.5, tk);
      }
      if (ph.state !== 'held') {
        this.setDoing(replying ? '去拿手机回你消息' : '手机响了，过去拿');
        await this.fetchPhone(tk, 'chat', 'run');
        // 拿到了：转过来坐好（在床沿就把腿垂下去）
        this.pose('stand', 'stand'); await this.sleep(0.3, tk);
        await this.actor.turnTo(0, tk);
        if (Math.abs(this.actor.pos.z - PLACES.bedEdge.z) < 0.03) this.pose('sit', 'sit', { kick: 0.3 }); else this.pose('sitFloor', 'sit');
        await this.sleep(0.4, tk);
      } else { ph.show('chat'); anim.setArms('phone'); }
      anim.lookAt(null); this.face('neutral');
      this.setDoing(replying ? '拿起手机回你消息' : '在看手机上的 QQ 消息');
      let last = clock.now, waiting = replying, speakUntil = 0, thinkAt = replying ? clock.now + 0.3 : Infinity;
      c.readUntil = 0; // 读完手上这条消息的时间（消息越长看得越久）
      const patience = replying ? 20 : c.replyTimeout; // 回来拿手机是为了回你：她那句回复一般几秒就到，等太久就算了
      for (;;) {
        tk.check();
        const ev = c.inbox[0];
        if (ev && (ev.dir === 'in' || clock.now >= speakUntil)) {
          c.inbox.shift(); last = clock.now;
          if (ev.dir === 'in') {
            ui.phoneNote(ev.hidden ? '（有别人发来消息）' : ev.text || (ev.sticker ? '[动画表情]' : '[消息]'), 7);
            ph.push(false, ev.hidden ? '（别人发来的消息）' : ev.text || (ev.sticker ? '[动画表情]' : '[消息]'));
            const m = moodOf(ev.text);
            this.face(m.face === 'smile' ? pick(['smile', 'cat', 'neutral']) : m.face === 'love' ? 'shy' : m.face === 'angry' ? 'sad' : m.face);
            anim.gesture(chance(0.5) ? 'tilt' : 'flap');
            c.readUntil = clock.now + clamp(1.2 + (ev.text?.length ?? 0) * 0.1, 1.8, 5);
            if (!ev.hidden) {
              // stale：这句话还没读到，她的 AI 本体就已经亲自指挥身体去办了，不用再从话里猜
              if (!ev.stale) {
                const oi = intentOf(ev.text);
                if (oi === 'photo') c.photoWhat = photoWhatOf(ev.text) ?? c.photoWhat;
                c.ownerIntent = oi ?? c.ownerIntent;
              }
              waiting = true; thinkAt = Math.max(clock.now + 1.5, c.readUntil); // 看完了才开始打字
            }
            this.setDoing('在看你发来的 QQ 消息');
          } else {
            waiting = false; thinkAt = Infinity; ui.think(false); anim.hand.typing = false; ph.setTyping(false);
            const text = ev.text || (ev.sticker ? '[动画表情]' : '…');
            const dur = clamp(1.8 + text.length * 0.13, 2.4, 11);
            ui.speech(text, dur); char.face.speak(clamp(text.length * 0.11 + 0.4, 0.8, dur * 0.8));
            ph.push(true, text);
            const m = moodOf(text);
            this.face(m.face); if (m.emote) ui.emote(m.emote, 2.2); if (m.gesture) anim.gesture(m.gesture);
            if (ev.sticker) { ui.emote('✨', 2); anim.gesture('bounce'); }
            this.mood = clamp(this.mood + m.dm, -1, 1); anim.finMood = this.mood;
            // 她这一轮已经用接口亲自指挥过身体：回复里的「拍了」「我去窗边」只是在说那件事，不再当成新指令
            if (!c.commanded) {
              const it = intentOf(text);
              if (it === 'photo') c.photoWhat = photoWhatOf(text) ?? c.photoWhat;
              if (it) c.intent = it; else if (c.ownerIntent && !REFUSE.test(text)) c.intent = c.ownerIntent;
            }
            c.ownerIntent = null;
            speakUntil = clock.now + dur * 0.8;
            this.setDoing('在 QQ 上和你聊天');
          }
        }
        if (waiting && !c.order && clock.now >= thinkAt) { ui.think(true); anim.hand.typing = true; ph.setTyping(true); this.face('focus'); thinkAt = Infinity; this.setDoing('在手机上打字回你'); }
        // 你发来的都看完了：在等这一刻的回复（QQ 插件那边拦着没发的那句）可以发了
        if (c.readWaiters.length && !c.inbox.some((e) => e.dir === 'in') && clock.now >= c.readUntil) this.flushRead();
        // 她的 AI 本体已经决定要去做什么了：消息都看完了，点点头，放下手机去做（不等她这句回复，回复等做完了再发）
        if (c.order && !c.inbox.length && clock.now >= c.readUntil) {
          ui.think(false); anim.hand.typing = false; ph.setTyping(false);
          this.face('smile'); await this.g('nod', tk);
          break;
        }
        const quiet = clock.now - Math.max(last, speakUntil);
        if (!c.inbox.length && quiet > (waiting ? patience : c.linger)) break;
        await clock.sleep(0.15, tk);
      }
    } finally {
      this.chatting = false; ui.think(false); anim.hand.typing = false; this.phone.setTyping(false);
      this.flushRead(); // 不看手机了（看完了、或者被打断了）：别让在等的回复一直卡着
    }
    this.awakeUntil = this.clock.now + 40; // 聊完别立刻倒头就睡
    const order = c.order; c.order = null;
    const resume = c.resume; c.resume = null;
    if (order) { c.intent = null; c.ownerIntent = null; this.queue.unshift(order); return; } // 照她亲自下的指令去做，不再从话里猜
    const it = c.intent; c.intent = null; c.ownerIntent = null;
    this.face('smile');
    const next = it ? this.intentAct(it) : null;
    if (next) { next.forced = true; this.queue.unshift(next); }
    else if (resume) { // 回完消息，接着做刚才放下的事（饭接着吃、回窗边……）
      const a = this.act(resume.name, ...resume.args);
      a.commanded = resume.commanded; a.forced = resume.commanded;
      this.queue.unshift(a);
    }
  }
  /**
   * 做完一件她亲自下的、跑一趟就完的事（关音响、开灯、浇花……）以后，回去把手机拿起来，拿到了才算做完：
   * 这时候她的 AI 本体收到「做完了」才发回复，房间里她正好拿着手机在打字。
   */
  async pickUpToReply(tk) {
    this.before = this.doingWithPlace(); // 「把音乐关了」：她拿起手机时，刚刚做完的就是这件
    if (this.phone.state !== 'held') {
      this.setDoing('回去拿手机');
      await this.fetchPhone(tk, 'chat');
      this.pose('stand', 'stand'); await this.sleep(0.25, tk);
    } else { this.phone.show('chat'); this.anim.setArms('phone'); }
    this.setDoing('拿起手机回你消息');
    this.queue.unshift(this.act('chat', true)); // 接着拿着手机，等她那句回复冒出来
  }

  intentAct(it) {
    switch (it) {
      case 'sleep': this.sleepWantedUntil = this.clock.now + 45 * 60; return this.act('sleep');
      case 'window': return this.act('window');
      case 'computer': return this.act('computer');
      case 'read': return this.act('read');
      case 'dance': return this.act('dance');
      case 'lie': return this.act('bedLie');
      case 'lampOn': this.lampOptOutUntil = 0; return this.act('lamp', true);
      case 'lampOff': this.lampOptOutUntil = this.clock.now + 30 * 60; return this.act('lamp', false);
      case 'water': return this.act('water');
      case 'play': return this.act('play');
      case 'spear': return this.act('spear');
      case 'box': return this.act('box');
      case 'exercise': return this.act(chance(0.5) ? 'spear' : 'box');
      case 'stretch': return this.act('stretch');
      case 'greet': return this.act('greet');
      case 'hide': return this.act('hide');
      case 'eat': return this.act('eat');
      case 'watch': return this.video ? this.act('computer', this.video) : this.act('computer');
      case 'photo': { const what = this.chat.photoWhat ?? 'selfie'; this.chat.photoWhat = null; return this.act('photo', what); }
      case 'music': return this.act('music', 'on');
      case 'musicOff': return this.act('music', 'off');
      default: return null;
    }
  }

  /** 来自 QQ 的事件（真实的，或测试面板模拟的）。 */
  onQQ(ev) {
    if (ev.history) { this.ui.addChat(ev); return; }
    if (ev.dir === 'out' && MONOLOGUE.test(ev.text ?? '')) { this.think(ev.text); return; } // 她的内心独白：只冒个心里话气泡，不当成聊天
    if (!ev.hidden) this.ui.addChat(ev);
    if (ev.dir === 'in' && !ev.hidden) this.chat.commanded = false; // 主人说了新的话：她回这一句时说的「我去……」又算数了
    // 她发出去的话一律在手机上打出来。一般 QQ 插件会先等她拿起手机才发（见 whenRead），
    // 走到这里的是没等到的（等太久超时了，或者别的路子直接发的）：先进收件箱，拿起手机再「打」出来。
    // 手上被指挥去做的事还没到位（正拍着照、正往窗边走）就等到位了再拿，不把它半路取消掉。
    if (ev.dir === 'out' && !this.chatting && !this.queue.some((q) => q.name === 'chat')) { this.chat.inbox.push(ev); this.replyOnPhone(); return; }
    this.chat.inbox.push(ev);
    if (ev.dir === 'in') this.phone.ring(ev.hidden ? '你有一条新消息' : ev.text || (ev.sticker ? '[动画表情]' : '[消息]'));
    if (!this.chatting && !this.queue.some((q) => q.name === 'chat')) this.interrupt(this.act('chat'));
  }
  /**
   * 她的 AI 本体写好了要发的话（回你，或者自己找你说），QQ 插件拦着，问房间：现在能发了吗？
   * 能发 = 手机拿在她手里、你发来的都看完了。没拿着手机就先去拿：在吃饭就把碗搁下去拿，回完接着吃；
   * 手上被指挥去做的事还没到位，就等到位了再拿。拿到了才调用 cb，QQ 那边这时才发出去，房间里她正好在手机上打字。
   */
  whenRead(cb) {
    const c = this.chat;
    if (this.chatting || this.queue.some((q) => q.name === 'chat')) {
      const ready = this.chatting && this.phone.state === 'held' && !c.inbox.some((e) => e.dir === 'in') && this.clock.now >= c.readUntil;
      if (ready) cb(); else c.readWaiters.push(cb); // 正在拿手机 / 正在看：看完了聊天那边会放行
      return;
    }
    c.readWaiters.push(cb);
    this.replyOnPhone();
  }
  flushRead() { for (const f of this.chat.readWaiters.splice(0)) f(); }
  /** 有等着发的话（插件拦着的回复，或者已经发出去、房间还没「打」出来的）。 */
  replyPending() { return this.chat.readWaiters.length > 0 || this.chat.inbox.some((e) => e.dir === 'out'); }
  /**
   * 要发消息了：拿起手机。被指挥去做的事还没到位的先不动（到位了 arrived 会叫这里；跑一趟就完的事做完会自己回去拿手机）。
   * 正在做、回完值得接着做的事（吃饭、窗边、电脑……）记下来，聊完接着做。
   */
  replyOnPhone() {
    const c = this.chat, cur = this.cur;
    if (!this.replyPending() || this.chatting || this.queue.some((q) => q.name === 'chat')) return;
    if (cur?.commanded && !cur.settled && cur.name !== 'chat') { c.replyAfter = true; return; }
    c.resume = cur && RESUME.has(cur.name) ? { name: cur.name, args: cur.args ?? [], commanded: Boolean(cur.commanded) } : null;
    this.interrupt(this.act('chat', true));
  }
  /** 聊天里分享了一个 B 站视频（服务端查到标题和封面后发来）：聊完就去电脑上看它。 */
  onVideo(ev) {
    this.video = ev.video;
    const c = this.chat;
    if (ev.dir === 'out') c.intent = 'watch'; else c.ownerIntent = 'watch';
    if (!this.chatting && !this.queue.some((q) => q.name === 'chat')) this.interrupt(this.act('computer', ev.video), true);
  }
  onPoke() {
    if (this.posture === 'sleep') { this.ui.emote('💤', 1.5); return; }
    this.react(chance(0.5) ? 'surprise' : 'angry', 'surprise', '❗', 2);
  }
  onOwnerTyping() { if (this.chatting) this.anim.gesture('flap'); }
  /** 被点了一下（摸头）。 */
  pet() {
    if (this.posture === 'sleep') { this.ui.emote('♪', 1.5); return; }
    this.mood = clamp(this.mood + 0.15, -1, 1); this.anim.finMood = this.mood;
    this.react('love', 'wiggle', '💗', 2.2);
  }

  // ---------------- 外部指令（接口 / 按钮 / 点击） ----------------
  /**
   * 外部指令。
   * @param onDone (result) => void：这件事到位 / 做完 / 被打断时调用一次。接口带了 wait 时由 main.js 传进来，把结果报回服务端。
   * @param fromAi 是她的 AI 本体通过接口下的（不是你在页面上点的）：这一轮聊天里从话里猜出来的「要做什么」全部作废，以她亲自下的指令为准。
   */
  command(cmd, onDone = null, fromAi = false) {
    let started = null;
    const ok = this.order(cmd, (a) => {
      a.commanded = true; a.onDone = onDone; started = a;
      // 她的 AI 本体在等结果、等着回你：跑一趟就完的事做完以后，回去拿起手机再算做完（她是拿着手机回你的）
      a.thenReply = fromAi && Boolean(onDone) && !STAYS.has(a.name);
      if (fromAi) this.tookOrders();
      return a;
    });
    // 不用走过去做的（说句话、换表情、冒心里话……）当场就生效了；参数不对的直接告诉对方
    if (onDone && !started) onDone(ok ? { ok: true, done: true, doing: this.doing } : { ok: false, done: false, error: `「${cmd.action}」的 target 不对，没做`, doing: this.doing });
    return ok;
  }
  /** 她的 AI 本体亲自指挥了身体：之前从聊天里听出来的意图都不算了，她接下来回复里的话也不再当指令。 */
  tookOrders() {
    const c = this.chat;
    c.intent = null; c.ownerIntent = null; c.photoWhat = null; c.commanded = true;
    for (const ev of c.inbox) ev.stale = true; // 还没来得及读的主人来信：照常显示，但不再从里面猜要做什么
  }
  /**
   * 指令来了，什么时候去做：正在看手机（手机响了正跑过去拿、或者正在看你的消息）就先看完再去——真人也是先看清你说了什么才动；
   * 否则马上放下手头的事去做。
   */
  dispatch(act) {
    if (this.chatting || this.queue.some((q) => q.name === 'chat')) {
      if (this.chat.order) this.orderDone(this.chat.order, { ok: true, done: false, cancelled: true, note: '还没开始做就被后来的指令换掉了' });
      act.forced = true;
      this.chat.order = act;
      return;
    }
    this.interrupt(act, true);
  }
  /** 执行一条指令。mark(act)：给要去做的那件事打上「是被指挥的」记号（见 command）。 */
  order({ action, target = null, text = null, video = null, page = null }, mark) {
    const force = (a) => { this.hold = false; this.sleepWantedUntil = 0; this.awakeUntil = this.clock.now + 60; this.dispatch(mark(a)); };
    switch (action) {
      case 'auto': this.hold = false; this.sleepWantedUntil = 0; this.ui.setAuto(true); if (this.current === 'hold') this.token?.cancel(); return true;
      case 'stop': this.hold = true; this.sleepWantedUntil = 0; this.dispatch(mark(this.act('hold'))); return true;
      case 'goto': {
        let dest = null;
        if (target && typeof target === 'object' && Number.isFinite(+target.x) && Number.isFinite(+target.z)) {
          const p = this.nav.nearestFree(clamp(+target.x, ROOM.x0, ROOM.x1), clamp(+target.z, ROOM.z0, ROOM.z1));
          dest = { surface: 'floor', x: p.x, z: p.z };
        } else if (typeof target === 'string' && GOTO[target]) dest = PLACES[GOTO[target]];
        if (!dest) return false;
        force(this.act('goto', dest)); return true;
      }
      case 'sit': force(target === 'bed' ? this.act('bedSit') : target === 'sill' ? this.act('window', 'sit') : target === 'desk' ? this.act('computer') : this.act('sitHere')); return true;
      case 'lie': force(target === 'rug' ? this.act('lieRug') : this.act('bedLie')); return true;
      case 'sleep': this.hold = false; this.sleepWantedUntil = this.clock.now + 60 * 60; this.dispatch(mark(this.act('sleep'))); return true;
      case 'wake': this.sleepWantedUntil = 0; this.awakeUntil = this.clock.now + 30 * 60; if (this.current === 'sleep') this.token?.cancel(); return true;
      case 'window': force(this.act('window', ['sit', 'stand', 'side'].includes(target) ? target : undefined)); return true;
      case 'computer': force(this.act('computer')); return true;
      case 'read': force(this.act('read')); return true;
      case 'dance': force(this.act('dance', ['classic', 'sway'].includes(target) ? target : undefined)); return true;
      case 'spear': force(this.act('spear')); return true;
      case 'box': force(this.act('box')); return true;
      case 'exercise': force(this.act(chance(0.5) ? 'spear' : 'box')); return true;
      case 'stretch': force(this.act('stretch')); return true;
      case 'play': force(this.act('play')); return true;
      case 'water': force(this.act('water')); return true;
      case 'phone': force(this.act('phone')); return true;
      case 'eat': force(this.act('eat')); return true;
      case 'watch': force(this.act('computer', video)); return true;
      case 'browse': {
        const p = page && typeof page === 'object' ? page : { site: target ? String(target) : '网页', title: text ? String(text) : '' };
        if (!p.title && !p.site) return false;
        // 已经坐在电脑前上网了：直接换一页，不用重新走过去
        if (this.current === 'computer' && this.cur?.browsing) { this.showPage(p); return true; }
        force(this.act('computer', null, p)); return true;
      }
      case 'photo': force(this.act('photo', PHOTO_SUBJECTS.includes(target) ? target : (target && photoWhatOf(String(target))) || 'selfie')); return true;
      case 'music': force(this.act('music', ['on', 'off', 'next'].includes(target) ? target : 'toggle')); return true;
      case 'think': if (text) this.think(text); return true;
      case 'wave': force(this.act('greet')); return true;
      case 'lamp': {
        const on = target === 'on' ? true : target === 'off' ? false : !this.room.lamp.on;
        if (!on) this.lampOptOutUntil = this.clock.now + 30 * 60; else this.lampOptOutUntil = 0;
        force(this.act('lamp', on)); return true;
      }
      case 'jump': if (this.posture === 'stand' && !this.actor.moving) { this.actor.jump({ x: this.actor.pos.x, y: this.actor.pos.y, z: this.actor.pos.z, surface: this.actor.surface }, null, { height: 0.2 }).catch(() => {}); } return true;
      case 'emote': this.ui.emote(EMOTES[target] ?? '♪', 2.5); return true;
      case 'face': this.face(String(target ?? 'smile')); return true;
      case 'say': if (text) { const t = String(text).slice(0, 300); const dur = clamp(1.8 + t.length * 0.13, 2.4, 11); this.ui.speech(t, dur); this.char.face.speak(clamp(t.length * 0.11 + 0.4, 0.8, dur * 0.8)); } return true;
      default: return false;
    }
  }

  /** 场景里被点到的东西 → 让她去用。 */
  onPick(name, point) {
    switch (name) {
      case 'her': this.pet(); break;
      case 'floor': case 'rug': this.command({ action: 'goto', target: { x: point.x, z: point.z } }); break;
      case 'bed': this.command({ action: chance(0.5) ? 'lie' : 'sit', target: 'bed' }); break;
      case 'window': case 'sill': this.command({ action: 'window' }); break;
      case 'laptop': case 'desk': case 'chair': this.command({ action: 'computer' }); break;
      case 'lamp': this.command({ action: 'lamp', target: 'toggle' }); break;
      case 'bookshelf': case 'cushion': this.command({ action: 'read' }); break;
      case 'plant': this.command({ action: 'water' }); break;
      case 'ball': this.command({ action: 'play' }); break;
      case 'phone': this.command({ action: 'phone' }); break;
      case 'ricecooker': case 'sink': this.command({ action: 'eat' }); break;
      case 'speaker': this.command({ action: 'music' }); break;
      case 'spear': this.command({ action: 'spear' }); break;
      default:
    }
  }

  // ---------------- 每帧 ----------------
  update(dt) {
    // 摸摸头、聊开心了带来的那点高兴会慢慢散掉，回到她真正的心情（没有心情插件时回到 0）
    const base = this.feelBase();
    this.mood = base + (this.mood - base) * Math.exp(-dt / 600);
    this.anim.finMood += (this.mood - this.anim.finMood) * (1 - Math.exp(-dt / 20)); // 鱼鳍耳跟着心情慢慢立起来 / 耷拉下去
    // 勺子：碗里 ↔ 嘴边、碗里 ↔ 锅里
    this.bite += (this.biteTarget - this.bite) * (1 - Math.exp(-dt * 7));
    this.pot += (this.potTarget - this.pot) * (1 - Math.exp(-dt * 8));
    this.anim.hand.bite = this.bite;
    this.canTilt = (this.canTilt ?? 0) + (this.anim.hand.pour - (this.canTilt ?? 0)) * (1 - Math.exp(-dt * 5));
    // 快到饭点还没吃：电饭煲亮红灯、冒热气
    if ((this.mealCheck -= dt) <= 0) { this.mealCheck = 5; const m = this.mealNow(); this.kitchen.cooker.setCooking(Boolean(m && this.ateMeal !== m)); }
    if (this.cushionMesh) { const k = 1 - Math.exp(-dt * 9), sy = this.cushionSat ? 0.093 : 0.11, sr = this.cushionSat ? 0.315 : 0.3; const c = this.cushionMesh.scale; c.y += (sy - c.y) * k; c.x += (sr - c.x) * k; c.z = c.x; }
    // 浇水的水滴
    if (this.pour > 0) {
      const from = new THREE.Vector3(0.125, 0.105, 0); this.can.localToWorld(from);
      const t = this.clock.now;
      this.drops.forEach((d, i) => {
        const u = (t * 1.6 + i / this.drops.length) % 1;
        d.visible = true;
        d.position.set(from.x + (PLANT.x - from.x) * u * 0.7, from.y - 0.5 * u * u * (from.y - 0.26) * 2 - 0.02 * u, from.z + (PLANT.z - from.z) * u * 0.7);
      });
    }
    // 翻书
    const fl = this.book.flip;
    if (this.flip > 0) {
      this.flip += dt * 2.2;
      fl.visible = true; fl.rotation.y = -0.32 - Math.min(1, this.flip) * 2.5; fl.position.z = 0.02;
      if (this.flip >= 1) { this.flip = 0; fl.visible = false; }
    }
  }

  /** 一个位置叫什么（默认是她自己现在的位置）。 */
  placeName(surface = this.actor.surface, p = this.actor.pos) {
    switch (surface) {
      case 'bed': return '床上';
      case 'sill': return '窗台上';
      case 'desk': return '书桌上';
      case 'chair': return '椅子上';
      case 'cushion': return '懒人垫上';
      default:
    }
    if (p.x > 0.6 && p.x < 1.56 && p.z < -1.04) return '书桌底下';
    if (Math.hypot(p.x - RUG.x, p.z - RUG.z) < RUG.r) return '地毯上';
    if (Math.hypot(p.x - PLANT.x, p.z - PLANT.z) < 0.6) return '盆栽旁边';
    if (p.x > 1.3 && p.z > 0.2) return '书架前';
    return '地板上';
  }
  /** 「踢球玩」→「踢球玩（在地毯上）」：手机响之前在干什么、在哪儿干的，一起记下来（话里已经带着地方的就不重复）。 */
  doingWithPlace() {
    const place = this.placeName(), key = place.replace(/(上|前|旁边|底下)$/, '');
    return this.doing.includes(key) ? this.doing : `${this.doing}（在${place}）`;
  }

  /** 给外部看的「身体状态」（她的 AI 本体可以读到自己正在干什么）。 */
  report() {
    const e = this.env.state, h = Math.floor(e.hour), m = Math.floor((e.hour - h) * 60);
    return {
      doing: this.doing, activity: this.current, posture: this.posture, place: this.placeName(),
      before: this.current === 'chat' ? this.before : null, // 在看手机、聊天时：手机响之前她在哪儿、干什么
      ballAt: this.placeName('floor', this.ball.pos), // 小球只在地板上滚（上不了床和桌子）
      position: { x: +this.actor.pos.x.toFixed(2), z: +this.actor.pos.z.toFixed(2) },
      mood: +this.mood.toFixed(2), feeling: this.feel ? `${this.feel.label}（${this.feel.value}）${this.feel.top?.length ? '，' + this.feel.top.map((t) => t.label).join('、') : ''}` : null, expression: this.char.face.expr, chatting: this.chatting, freeRoam: !this.hold,
      roomTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, dayPhase: e.phase, weather: e.weather,
      spearAt: { home: '插在枪架上', hand: '手里', floor: '横放在地上' }[this.spear.at],
      lampOn: this.room.lamp.on, laptopOn: this.room.laptop.on, watching: this.room.laptop.screen.video?.title ?? null, browsing: this.room.laptop.screen.page ? `${this.room.laptop.screen.page.site}《${this.room.laptop.screen.page.title}》` : null, musicOn: this.speaker.playing,
      phoneAt: this.phone.state === 'held' ? '手里' : { home: '枕头边', pillow: '靠在枕头上', flat: { floor: '地上', bed: '床上', desk: '书桌上', sill: '窗台上' }[this.phone.rest.surface] ?? '身边' }[this.phone.rest.kind],
    };
  }
}

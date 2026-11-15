#!/usr/bin/env node
// 大肥鱼的家 —— 本地服务：静态页面 + 浏览器推送（SSE）+ QQ（OneBot）桥 + 身体控制接口。
// 启动：node server.mjs   然后打开 http://127.0.0.1:5177
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { OneBotBridge, findBiliLink } from './bridge/onebot.mjs';
import { readMood, readLife } from './bridge/mood.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

function loadConfig() {
  // 自己的配置放在 config.json（不进 git）；还没有的话先用 config.example.json 跑起来
  let file = process.env.WHALE_ROOM_CONFIG || path.join(ROOT, 'config.json');
  if (!process.env.WHALE_ROOM_CONFIG && !fs.existsSync(file)) {
    file = path.join(ROOT, 'config.example.json');
    console.log('还没有 config.json，先用 config.example.json 的默认设置（QQ 没连）。要连 QQ：把它复制成 config.json，填上 NapCat 的地址、token 和 QQ 号。');
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.ONEBOT_URL) cfg.onebot.url = process.env.ONEBOT_URL;
  if (process.env.ONEBOT_DISABLED === '1') cfg.onebot.enabled = false;
  return cfg;
}

const config = loadConfig();
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);

// ---------- 房间页面：开着、睡着了，还是关了 ----------
// 每个打开着的房间页面有自己的 id（网址参数 page=）。浏览器会把很久没人看的标签页冻住
// （Edge 的睡眠标签页、Chrome 的节能冻结之类）：冻住的页面连接可能还挂着，但身体不动、也不上报了。
// 所以光看「有没有连着」不够，要看它最近有没有上报。
const FRESH = 20000; // 页面这么久没上报，就当它不在动了
const ASLEEP_KEEP = 24 * 3600 * 1000; // 睡着后连接也断了的页面，最多记这么久
const pages = new Map(); // 页面 id → { id, conns: Set<res>, connectedAt, reportAt, state, asleepAt }
function pageOf(id) {
  const key = String(id || 'legacy').slice(0, 64); // 老版本的页面不带 id，都算作 legacy
  let p = pages.get(key);
  if (!p) { p = { id: key, conns: new Set(), connectedAt: 0, reportAt: 0, state: null, asleepAt: 0 }; pages.set(key, p); }
  return p;
}
/** 这个页面现在醒着吗：刚上报过，或者刚连上、还在加载没来得及报。说过「要睡了」的不算。 */
const isAwake = (p, now) => !p.asleepAt && (now - p.reportAt < FRESH || (p.conns.size > 0 && now - p.connectedAt < FRESH));
/** 房间现在的样子。kind: open 有醒着的页面 | asleep 页面还在，但被浏览器冻住了 | closed 没有页面。 */
function roomStatus() {
  const now = Date.now();
  let open = null, asleep = null;
  for (const p of pages.values()) {
    if (isAwake(p, now)) { if (!open || p.reportAt > open.reportAt) open = p; }
    else if (p.conns.size || (p.asleepAt && now - p.asleepAt < ASLEEP_KEEP)) { if (!asleep || p.reportAt > asleep.reportAt) asleep = p; }
    else pages.delete(p.id); // 没连着、也没在睡：页面已经关了
  }
  return open ? { kind: 'open', page: open } : asleep ? { kind: 'asleep', page: asleep } : { kind: 'closed', page: null };
}
const CLOSED_NOTE = () => '房间页面没有打开，她现在没有身体可用（打开 http://127.0.0.1:' + config.port + ' 即可）';
const ASLEEP_NOTE = '房间页面还开着，但浏览器让它睡着了（标签页太久没人看，比如 Edge 的睡眠标签页）：身体这会儿停着不动，指令也没人执行。这不是主人关了房间，主人点回那个标签页它就醒了。';
const NOBODY = (st) => (st.kind === 'asleep' ? { roomAsleep: true, note: '房间页面睡着了（浏览器冻住了那个标签页），动作没人执行。主人点回房间标签页它才会醒。' } : { note: '没有打开着的房间页面，动作没人执行' });

// ---------- 浏览器推送（SSE） ----------
const recent = []; // 最近的聊天记录，新开页面时回放到聊天面板
/** 推给所有连着的页面（QQ 消息、桥的状态……睡着的页面醒来后也会收到）。 */
function broadcast(ev) {
  if (ev.type === 'qq' && !ev.hidden) {
    recent.push({ ...ev, history: true });
    if (recent.length > 40) recent.shift();
  }
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  let n = 0;
  for (const p of pages.values()) for (const res of p.conns) { res.write(line); n++; }
  return n;
}
/** 只推给醒着的页面（身体指令）。睡着的页面要是攒着，醒来会把几个小时前的指令一股脑做掉。返回推给了几个连接。 */
function sendAwake(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  const now = Date.now();
  let n = 0;
  for (const p of pages.values()) if (isAwake(p, now)) for (const res of p.conns) { res.write(line); n++; }
  return n;
}

// ---------- QQ 桥 ----------
let bridge = null;
if (config.onebot?.enabled) {
  bridge = new OneBotBridge(config.onebot, log);
  bridge.on('event', (ev) => {
    if (ev.type === 'qq' && !ev.history) log(`[qq] ${ev.dir === 'in' ? '主人 →' : '她 →'} ${ev.hidden ? '(其他人的消息，不上屏)' : ev.text}`);
    broadcast(ev);
    // 消息里分享了 B 站视频：查到标题和封面后再补发一个事件，房间里的电脑上就能显示这个视频
    if (ev.type === 'qq' && ev.link && !ev.history && !ev.hidden) {
      biliInfo(ev.link).then((video) => broadcast({ type: 'video', dir: ev.dir, video, at: Date.now() }))
        .catch((err) => log('[bili] 查不到视频信息: ' + err.message));
    }
  });
  bridge.on('status', (st) => broadcast({ type: 'bridge', status: st }));
  bridge.start();
}
const bridgeStatus = () => (bridge ? bridge.status() : { enabled: false, connected: false });

// ---------- 她的心情（DSH 插件「鱼的心情」记的）：变了就推给页面，她的表情和想做的事跟着变 ----------
let mood = null, moodSig = '';
function refreshMood() {
  if (config.mood?.enabled === false) return;
  const m = readMood(config.mood ?? {});
  const sig = m ? `${m.value}|${m.top.map((t) => t.key + t.value).join(',')}|${m.updatedAt}` : '';
  if (sig === moodSig) return;
  if (m && !mood) log(`[心情] ${m.emoji} ${m.label}（${m.value}）`);
  else if (m && m.updatedAt !== mood?.updatedAt) log(`[心情] ${m.emoji} ${m.label}（${m.value}）${m.reason ? '：' + m.reason : ''}`);
  moodSig = sig; mood = m;
  broadcast({ type: 'mood', mood });
}
refreshMood();
setInterval(refreshMood, 15000).unref();

// ---------- 她的作息（装了 dsh-jingjing 的话）：她几点睡、几点起由那边定，房间跟着 ----------
let life = null, lifeSig = '';
function refreshLife() {
  const l = readLife(config.mood ?? {});
  const sig = l ? String(l.asleep) : '';
  if (sig === lifeSig) return;
  if (l) log(l.asleep ? '[作息] 她该睡觉了（dsh-jingjing 定的）' : '[作息] 她醒着（dsh-jingjing 定的）');
  lifeSig = sig; life = l;
  broadcast({ type: 'life', life });
}
refreshLife();
setInterval(refreshLife, 15000).unref();

// 房间醒了 / 睡着了 / 关了，在终端里说一声，方便看出是浏览器把它冻住了
let lastKind = 'closed';
setInterval(() => {
  const { kind } = roomStatus();
  if (kind === lastKind) return;
  lastKind = kind;
  log(kind === 'open' ? '[房间] 页面醒着，她能动了'
    : kind === 'asleep' ? `[房间] 页面睡着了：浏览器冻住了这个标签页（比如 Edge 的睡眠标签页），她停着不动。想让她一直醒着，把 127.0.0.1:${config.port} 加进浏览器「从不让这些站点进入睡眠状态」的名单`
      : '[房间] 没有打开着的房间页面了');
}, 5000).unref();

// ---------- 天气 ----------
let weatherCache = { at: 0, data: null };
async function getWeather() {
  const w = config.weather ?? {};
  if (w.mode !== 'real' || w.latitude == null || w.longitude == null) return { mode: 'simulated' };
  if (Date.now() - weatherCache.at < 10 * 60 * 1000 && weatherCache.data) return weatherCache.data;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.latitude}&longitude=${w.longitude}&current=temperature_2m,weather_code,is_day,precipitation,cloud_cover`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const c = j.current ?? {};
    const code = Number(c.weather_code ?? 0);
    let kind = 'clear';
    if (code >= 71 && code <= 77 || code === 85 || code === 86) kind = 'snow';
    else if (code >= 51 && code <= 67 || code >= 80 && code <= 82 || code >= 95) kind = 'rain';
    else if (code >= 2 && code <= 48) kind = 'cloudy';
    weatherCache = { at: Date.now(), data: { mode: 'real', kind, temperature: c.temperature_2m, code } };
  } catch (err) {
    log('[weather] 获取失败: ' + err.message);
    weatherCache = { at: Date.now(), data: { mode: 'simulated', error: err.message } };
  }
  return weatherCache.data;
}

// ---------- B 站视频：只查公开的标题、UP 主、封面、时长（不登录、不用任何账号，也不经过她的 AI，不花 token） ----------
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const biliCache = new Map();
/** 取一个外网地址；失败时把真正的原因（DNS、超时、代理……）带出来，而不是一句笼统的 fetch failed。 */
async function outFetch(url, opts = {}) {
  try { return await fetch(url, { signal: AbortSignal.timeout(8000), ...opts }); }
  catch (err) { throw new Error(`连不上 ${new URL(url).host}：${err.cause?.code ?? err.cause?.message ?? err.message}`); }
}
/** 查一个视频。ref 可以是 BV 号、视频网址或 b23.tv 短链接。 */
async function biliInfo(ref) {
  let bvid = /BV[0-9A-Za-z]{10}/.exec(String(ref))?.[0];
  if (!bvid) {
    const short = /https?:\/\/b23\.tv\/[0-9A-Za-z]+/.exec(String(ref))?.[0];
    if (!short) throw new Error('这不是 B 站视频的 BV 号或链接');
    const r = await outFetch(short, { redirect: 'manual', headers: { 'user-agent': UA } });
    bvid = /BV[0-9A-Za-z]{10}/.exec(r.headers.get('location') ?? '')?.[0];
    if (!bvid) throw new Error('短链接没有指向一个视频');
  }
  if (biliCache.has(bvid)) return biliCache.get(bvid);
  const r = await outFetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' } });
  const j = await r.json();
  if (j.code !== 0 || !j.data) throw new Error(j.message || 'B 站接口返回 ' + j.code);
  const d = j.data;
  const video = { bvid, title: String(d.title ?? ''), owner: String(d.owner?.name ?? ''), duration: Number(d.duration) || 0, cover: d.pic ? '/api/bili/cover?u=' + encodeURIComponent(d.pic) : null, url: 'https://www.bilibili.com/video/' + bvid };
  biliCache.set(bvid, video);
  if (biliCache.size > 200) biliCache.delete(biliCache.keys().next().value);
  return video;
}

// ---------- 音乐：让这台 Mac 自带的「音乐」App 放指定的歌单（房间页面自己不出音乐） ----------
const osa = (script) => new Promise((resolve, reject) => {
  execFile('/usr/bin/osascript', ['-e', script], { timeout: 15000 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));
});
const quoteAS = (v) => '"' + String(v).replace(/[\\"]/g, '') + '"';
async function music(action) {
  const cfg = config.music ?? {};
  if (cfg.enabled === false) return { ok: false, error: 'config.json 里关掉了音乐（music.enabled）' };
  if (process.platform !== 'darwin') return { ok: false, error: '放歌需要在 Mac 上运行（用的是系统自带的「音乐」App）' };
  const list = cfg.playlist || '大肥鱼的歌单';
  try {
    if (action === 'state') {
      const out = await osa('if application "Music" is running then\ntell application "Music"\nif player state is playing then\nreturn "playing|" & (name of current track) & "|" & (artist of current track)\nend if\nend tell\nend if\nreturn "stopped"');
      const [st, track, artist] = out.split('|');
      return { ok: true, playing: st === 'playing', track: track ?? null, artist: artist ?? null, playlist: list };
    }
    if (action === 'play') {
      const out = await osa(`tell application "Music"\nif not (exists playlist ${quoteAS(list)}) then return "NO_PLAYLIST"\nset shuffle enabled to true\nplay playlist ${quoteAS(list)}\ndelay 0.6\nreturn (name of current track) & "|" & (artist of current track)\nend tell`);
      if (out === 'NO_PLAYLIST') return { ok: false, error: `「音乐」App 里没有叫「${list}」的歌单（建一个，或者在 config.json 的 music.playlist 里改成你的歌单名）`, playlist: list };
      const [track, artist] = out.split('|');
      return { ok: true, playing: true, track, artist: artist ?? null, playlist: list };
    }
    if (action === 'pause') { await osa('if application "Music" is running then tell application "Music" to pause'); return { ok: true, playing: false, playlist: list }; }
    if (action === 'next') {
      const out = await osa('tell application "Music"\nnext track\ndelay 0.4\nreturn (name of current track) & "|" & (artist of current track)\nend tell');
      const [track, artist] = out.split('|');
      return { ok: true, playing: true, track, artist: artist ?? null, playlist: list };
    }
    return { ok: false, error: '不认识的音乐指令：' + action };
  } catch (err) {
    return { ok: false, error: '控制「音乐」App 失败：' + err.message, playlist: list };
  }
}

// ---------- 照片：她在房间里拍的照片，存到 photos/，并发到主人的 QQ ----------
const PHOTOS = path.join(ROOT, 'photos');
async function savePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new Error('照片数据不对');
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const name = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}.${m[1] === 'png' ? 'png' : 'jpg'}`;
  fs.mkdirSync(PHOTOS, { recursive: true });
  fs.writeFileSync(path.join(PHOTOS, name), Buffer.from(m[2], 'base64'));
  const out = { ok: true, file: 'photos/' + name, sent: false, note: null };
  if ((config.photo?.sendToQQ ?? true) === false) out.note = 'config.json 里关掉了发 QQ（photo.sendToQQ）';
  else if (!bridge) out.note = 'QQ 桥没启用，照片只存在了本地';
  else {
    try { const to = await bridge.sendImage(m[2]); out.sent = true; out.to = to; } catch (err) { out.note = '没发到 QQ：' + err.message; }
  }
  log(`[photo] ${out.file} ${out.sent ? '已发到 QQ ' + out.to.join(',') : '（' + out.note + '）'}`);
  return out;
}

// ---------- 角色模型：public/models/ 里放了 .glb 就用它，没有就用代码搭的那个 ----------
const MODELS = path.join(PUBLIC, 'models');
function findModel() {
  const want = config.character?.model ?? 'auto';
  if (want === false || want === 'off') return { url: null, note: 'config.json 里关掉了外部模型' };
  let file = null;
  if (want === 'auto') {
    let names = [];
    try { names = fs.readdirSync(MODELS); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const glbs = names.filter((n) => n.toLowerCase().endsWith('.glb') && !n.startsWith('.'))
      .map((n) => ({ n, t: fs.statSync(path.join(MODELS, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    if (!glbs.length) return { url: null, note: 'public/models/ 里没有 .glb，用内置的角色' };
    file = glbs[0].n;
  } else {
    file = String(want);
    if (!fs.existsSync(path.join(MODELS, file))) return { url: null, error: `config.json 指定的模型 public/models/${file} 不存在` };
  }
  // 同名的 .rig.json 是这个模型的骨骼对位参数（可选）
  const out = { url: '/models/' + encodeURIComponent(file), name: file, bytes: fs.statSync(path.join(MODELS, file)).size, rig: null };
  const rigFile = path.join(MODELS, file.replace(/\.glb$/i, '.rig.json'));
  if (fs.existsSync(rigFile)) {
    try { out.rig = JSON.parse(fs.readFileSync(rigFile, 'utf8')); } catch (err) { out.error = `${path.basename(rigFile)} 不是合法 JSON：${err.message}`; }
  }
  return out;
}

// ---------- 身体控制：她（或你）可以让身体去做的事 ----------
const ACTIONS = {
  goto: '走到某处。target: bed 床 | window 窗台 | desk 书桌 | computer 电脑 | bookshelf 书架 | rug 地毯 | plant 盆栽 | lamp 台灯 | door 门口 | cushion 懒人垫 | front 屏幕跟前，或 {x,z} 坐标',
  sit: '坐下。target 可选: bed 床沿 | sill 窗台 | desk 电脑前（不填就原地坐）',
  lie: '躺下发呆。target 可选: bed | rug',
  sleep: '上床睡觉',
  wake: '醒来 / 起身',
  window: '去窗台看外面。target 可选: stand 扒着窗看 | sit 抱膝坐着看 | side 斜坐着托腮看（不填就随机，待久了会自己换姿势）',
  computer: '去玩电脑',
  read: '去书架拿本书，窝在懒人垫上看',
  dance: '跳舞（两套随机挑一套）。target 可选: classic 原来那套（摇摆举手、张开手转圈、蹦蹦跳）| sway 叉腰扭胯、转个身、张开手臂左右晃那段',
  spear: '练枪：去前墙根的枪架上拿红缨枪，到地毯上练一段（中平枪、弓步扎、拦拿扎、劈、挑、转身横扫、跳步扎），练完把枪插回枪架',
  box: '打拳：在地毯上面朝主人打一套空击（侧身亮相、刺拳、直拳、摆拳、上勾拳、下潜躲闪），打累了喘口气再来几组',
  exercise: '锻炼一会儿：练枪、打拳随便挑一样',
  stretch: '伸懒腰',
  play: '玩球',
  water: '给盆栽浇水',
  lamp: '开/关台灯。target: on | off | toggle',
  phone: '趴在床上刷手机',
  eat: '去电饭煲盛一大碗白饭，坐下用勺子吃完，然后洗碗、把碗放回去',
  watch: '去电脑前看一个 B 站视频（电脑屏幕上会显示它的封面和标题）。target: BV 号或视频链接',
  browse: '去电脑前上网：屏幕上显示正在看的那一页（网站名、标题、正文开头）。已经坐在电脑前上网的话，直接换成这一页。target: 网站名（牛客、小红书、IT之家……），text: 标题；也可以给 page: { site, title, excerpt }',
  think: '心里话 / 碎碎念：头顶冒一个云朵气泡（只在房间里显示，不会发到 QQ）。text: 内容',
  photo: '用手机拍一张照片发到主人的 QQ。target 可选: selfie 自拍（默认）| window 窗外 | food 饭（碗是空的就先盛一碗，拍完吃掉）| plant 盆栽 | laptop 电脑 | ball 小球 | bed 床 | room 房间 | ahead 面前的东西',
  music: '去按一下小音箱，让这台 Mac 的「音乐」App 放歌单 / 停下。target: on | off | toggle（默认）| next 下一首',
  wave: '跑到屏幕跟前朝你挥手',
  jump: '原地蹦一下',
  emote: '表情气泡。target: happy | love | shy | angry | sad | surprise | question | sleepy | music | think | sweat',
  say: '头顶气泡说一句话。text: 内容',
  face: '只换表情。target: smile | happy | joy | love | shy | sad | angry | surprise | sleepy | think | cat | smug | neutral',
  stop: '停下手头的事，站着发呆',
  auto: '恢复自由活动',
};

// 一说就生效、不用走过去做的动作（其余的都要花时间：走过去、跳上去、拿手机……）
const INSTANT = new Set(['think', 'say', 'emote', 'face', 'jump', 'auto']);
const NOT_DONE_YET = '指令送到了，但身体才刚开始做，还没做完（要走过去、拿手机……）。想等它做完再回主人，就在请求里加 "wait":true，等返回 done:true 再说做好了。';

// ---------- 等身体做完：/api/act 带了 wait 就先不回，等页面报「做完了 / 到位了 / 被打断了」再回 ----------
const waiting = new Map(); // 指令 id → finish(result)
let actSeq = 0;
/** 发一条指令给醒着的页面，等它做完。返回要回给调用方的结果（带上 delivered：推给了几个页面）。 */
function actAndWait(ev, sec) {
  return new Promise((resolve) => {
    const id = `${Date.now().toString(36)}-${++actSeq}`;
    let delivered = 0;
    const timer = setTimeout(() => finish({
      ok: true, done: false, timeout: true,
      note: `等了 ${sec} 秒还没做完，身体还在做。别说已经做好了。`,
      doing: roomStatus().page?.state?.doing ?? null,
    }), sec * 1000);
    const finish = (result) => {
      if (!waiting.has(id)) return;
      waiting.delete(id); clearTimeout(timer);
      resolve({ delivered, ...result });
    };
    waiting.set(id, finish);
    delivered = sendAwake({ ...ev, id, wait: true });
    if (!delivered) finish({ ok: true, done: false, ...NOBODY(roomStatus()) });
  });
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch (err) { reject(new Error('请求体不是合法 JSON: ' + err.message)); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': rel.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', name: config.character?.name ?? '大肥鱼', bridge: bridgeStatus(), recent, music: { enabled: config.music?.enabled !== false, auto: config.music?.auto !== false, playlist: config.music?.playlist || '大肥鱼的歌单' }, mood, life })}\n\n`);
      const pg = pageOf(url.searchParams.get('page'));
      pg.conns.add(res); pg.connectedAt = Date.now(); pg.asleepAt = 0; // 能连上来，说明它醒着
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); pg.conns.delete(res); });
      return;
    }
    if (p === '/api/state' && req.method === 'GET') {
      const st = roomStatus();
      const now = Date.now();
      if (st.kind === 'open' && st.page.state) json(res, 200, { roomOpen: true, state: st.page.state, mood, qq: bridgeStatus() });
      else if (st.kind === 'asleep') {
        json(res, 200, {
          roomOpen: false, roomAsleep: true, note: ASLEEP_NOTE,
          asleepMin: st.page.reportAt ? Math.round((now - st.page.reportAt) / 60000) : null, // 睡了大约几分钟
          lastDoing: st.page.state?.doing ?? null, // 睡着之前身体在干什么
          state: null, qq: bridgeStatus(),
        });
      } else json(res, 200, { roomOpen: false, note: st.kind === 'open' ? '房间页面刚打开，还在加载，过几秒再看' : CLOSED_NOTE(), state: null, qq: bridgeStatus() });
      return;
    }
    if (p === '/api/actions' && req.method === 'GET') { json(res, 200, { actions: ACTIONS }); return; }
    if (p === '/api/weather' && req.method === 'GET') { json(res, 200, await getWeather()); return; }
    if (p === '/api/model' && req.method === 'GET') { json(res, 200, findModel()); return; }
    if (p === '/api/bili/info' && req.method === 'GET') {
      try { json(res, 200, { ok: true, video: await biliInfo(url.searchParams.get('v') ?? '') }); } catch (err) { json(res, 200, { ok: false, error: err.message }); }
      return;
    }
    if (p === '/api/bili/cover' && req.method === 'GET') {
      // 封面图走一下本机转手（浏览器直接跨站取图会被拦，也没法画到 3D 贴图上）。只转 B 站图床的图
      let u;
      try { u = new URL(url.searchParams.get('u') ?? ''); } catch (err) { json(res, 400, { ok: false, error: '图片地址不对: ' + err.message }); return; }
      if (!/(^|\.)hdslb\.com$/.test(u.hostname)) { json(res, 400, { ok: false, error: '只转 B 站图床（hdslb.com）的图片' }); return; }
      u.protocol = 'https:';
      const r = await outFetch(u.href + '@640w_400h_1c.jpg', { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' } });
      if (!r.ok) { json(res, 502, { ok: false, error: '封面没取到: ' + r.status }); return; }
      res.writeHead(200, { 'content-type': r.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (p === '/api/music' && (req.method === 'POST' || req.method === 'GET')) {
      const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      json(res, 200, await music(String(body.action ?? 'state')));
      return;
    }
    if (p === '/api/photo' && req.method === 'POST') {
      try { json(res, 200, await savePhoto((await readBody(req, 12 * 1024 * 1024)).image)); } catch (err) { json(res, 200, { ok: false, error: err.message }); }
      return;
    }
    if (p === '/api/sfx' && req.method === 'GET') {
      // 你自己放进 public/assets/sfx/ 的音效文件（文件名见 sound.js），有就用它替换合成的声音
      let names = [];
      try { names = fs.readdirSync(path.join(PUBLIC, 'assets', 'sfx')).filter((n) => /\.(mp3|ogg|wav|m4a)$/i.test(n)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      json(res, 200, { files: names });
      return;
    }
    if (p === '/api/report' && req.method === 'POST') {
      const pg = pageOf(url.searchParams.get('page'));
      pg.state = await readBody(req);
      pg.reportAt = Date.now();
      pg.asleepAt = 0; // 还能上报，说明醒着（刚从睡眠里回来的也是）
      json(res, 200, { ok: true });
      return;
    }
    if (p === '/api/lifecycle' && req.method === 'POST') {
      // 页面在被浏览器冻住（freeze）或关掉（close）之前，用 sendBeacon 打个招呼
      const ev = url.searchParams.get('event');
      const id = url.searchParams.get('page');
      if (ev === 'freeze') pageOf(id).asleepAt = Date.now();
      else if (ev === 'close' && id) pages.delete(String(id).slice(0, 64));
      json(res, 200, { ok: true });
      return;
    }
    if (p === '/api/act' && (req.method === 'POST' || req.method === 'GET')) {
      const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      const action = String(body.action ?? '').trim();
      if (!Object.hasOwn(ACTIONS, action)) {
        json(res, 400, { ok: false, error: `不认识的动作「${action}」`, actions: Object.keys(ACTIONS) });
        return;
      }
      const st = roomStatus();
      if (st.kind !== 'open') { // 页面睡着了或者没开：别把指令攒给它，直接告诉调用方
        log(`[act] ${action} → 没人执行（房间${st.kind === 'asleep' ? '睡着了' : '没开'}）`);
        json(res, 200, { ok: true, delivered: 0, done: false, ...NOBODY(st) });
        return;
      }
      let video = null;
      if (action === 'watch') { // 先查到这个视频，页面上才有封面和标题可以显示
        const ref = findBiliLink(body.target ?? body.text ?? '');
        if (ref) { try { video = await biliInfo(ref); } catch (err) { log('[bili] 查不到视频信息: ' + err.message); } }
      }
      let page = null;
      if (action === 'browse') { // 冲浪工具报过来的这一页：只留几个字段、截短，免得把什么都塞给页面
        const p = body.page && typeof body.page === 'object' ? body.page : {};
        const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
        page = { site: str(p.site ?? body.target, 20) || '网页', title: str(p.title ?? body.text, 120), excerpt: str(p.excerpt, 240) };
      }
      const ev = { type: 'act', action, target: body.target ?? null, text: body.text ?? null, video, page, at: Date.now() };
      const wait = [true, 1, 'true', '1', 'yes'].includes(body.wait);
      const what = `${action} ${typeof ev.target === 'object' && ev.target ? JSON.stringify(ev.target) : ev.target ?? ''} ${ev.text ?? ''}`.trim();
      if (wait) {
        const sec = Math.min(Math.max(Number(body.timeout) || 100, 5), 300);
        let gone = false;
        res.on('close', () => { gone = !res.writableEnded; });
        const t0 = Date.now();
        log(`[act] ${what}（等做完，最多 ${sec} 秒）`);
        const result = await actAndWait(ev, sec);
        log(`[act] ${what} → ${result.done ? '做完了' : result.timeout ? '超时' : result.cancelled ? '被打断' : '没做成'}，用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒${gone ? '（调用方已经不等了）' : ''}`);
        if (!gone) json(res, 200, result);
        return;
      }
      const delivered = sendAwake(ev);
      log(`[act] ${what} → ${delivered} 个页面`);
      json(res, 200, delivered
        ? { ok: true, delivered, ...(INSTANT.has(action) ? {} : { done: false, note: NOT_DONE_YET }) }
        : { ok: true, delivered, done: false, ...NOBODY(roomStatus()) });
      return;
    }
    if (p === '/api/read-wait' && req.method === 'GET') {
      // QQ 插件在发她写好的话之前来问：手机在她手里、你的消息也看完了没？是了才发，最多等 timeout 秒。
      // 手机不在手里，她会先去拿（在吃饭就把碗搁下）。这样每句话都是她拿着手机打出来的。
      // 房间没开、或者页面睡着了（身体不会动，等也白等），就立刻放行。
      const st = roomStatus();
      if (st.kind !== 'open') { json(res, 200, { ready: true, roomOpen: false, ...(st.kind === 'asleep' ? { roomAsleep: true } : {}) }); return; }
      const sec = Math.min(Math.max(Number(url.searchParams.get('timeout')) || 25, 1), 60);
      const t0 = Date.now();
      const r = await actAndWait({ type: 'readwait', at: t0 }, sec);
      const waited = ((Date.now() - t0) / 1000).toFixed(1);
      if (Number(waited) >= 0.5) log(`[reply] ${r.done ? `等她看完消息用了 ${waited} 秒，回复放行` : `等了 ${waited} 秒她还没看完，先放行`}`);
      if (!res.writableEnded) json(res, 200, { ready: Boolean(r.done), waited: Number(waited), doing: r.doing ?? null });
      return;
    }
    if (p === '/api/act/done' && req.method === 'POST') {
      // 页面报告：一条带 wait 的指令做完 / 到位 / 被打断了。开着多个页面时谁先报算谁的
      const body = await readBody(req);
      const finish = waiting.get(String(body.id ?? ''));
      const r = body.result && typeof body.result === 'object' ? body.result : {};
      if (finish) finish({
        ok: r.ok !== false, done: Boolean(r.done),
        ...(r.cancelled ? { cancelled: true } : {}),
        ...(r.note ? { note: String(r.note) } : {}),
        ...(r.error ? { error: String(r.error) } : {}),
        ...(r.photo ? { photo: r.photo } : {}),
        ...(r.music ? { music: r.music } : {}),
        doing: r.doing ?? null,
      });
      json(res, 200, { ok: true, matched: Boolean(finish) });
      return;
    }
    if (p === '/api/mock/qq' && req.method === 'POST') {
      // 调试用：不经过 QQ，直接往房间里塞一条「主人来信」或「她的回复」
      const body = await readBody(req);
      const ev = { type: body.kind === 'poke' ? 'poke' : body.kind === 'typing' ? 'typing' : 'qq', dir: body.dir === 'out' ? 'out' : 'in', text: String(body.text ?? ''), sticker: Boolean(body.sticker), mock: true, at: Date.now(), id: 'mock-' + Date.now() };
      json(res, 200, { ok: true, delivered: broadcast(ev) });
      const link = ev.type === 'qq' ? findBiliLink(ev.text) : null;
      if (link) biliInfo(link).then((video) => broadcast({ type: 'video', dir: ev.dir, video, at: Date.now() })).catch((err) => log('[bili] 查不到视频信息: ' + err.message));
      return;
    }
    if (p.startsWith('/api/')) { json(res, 404, { ok: false, error: '没有这个接口' }); return; }
    serveStatic(req, res, p);
  } catch (err) {
    log('[http] ' + p + ' 出错: ' + (err?.stack ?? err));
    if (!res.headersSent) json(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`端口 ${config.port} 已被占用。换一个：PORT=5188 node server.mjs`);
  else console.error(err);
  process.exit(1);
});

server.listen(config.port, config.host ?? '127.0.0.1', () => {
  log(`大肥鱼的家已开门： http://${config.host ?? '127.0.0.1'}:${config.port}`);
  if (!config.onebot?.enabled) log('QQ 桥未启用（config.json → onebot.enabled）');
});

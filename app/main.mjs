// 大肥鱼的家 · 桌面 app（Electron 主进程）
// 一个专门开房间的窗口，自带房间服务。和开在浏览器标签页里比：
//   - 不会被浏览器的睡眠标签页、节能模式冻住，也不会被 macOS 的 App Nap 拖慢；
//   - 关掉窗口只是把它藏起来，她照样在里面生活；退出 app 才算关了房间；
//   - 页面崩了、卡死了、服务断了会自己重新打开。
// 启动：npm run app（开发时），或者用 npm run app:mac 做成的「大肥鱼的家.app」。
import { app, BrowserWindow, Menu, dialog, powerSaveBlocker, shell, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = '大肥鱼的家';
app.setName(NAME);

// ---------- 日志：服务和窗口的输出都记到 ~/Library/Logs/大肥鱼的家/room.log ----------
const LOG_DIR = app.getPath('logs');
const LOG_FILE = path.join(LOG_DIR, 'room.log');
fs.mkdirSync(LOG_DIR, { recursive: true });
try { if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'room.old.log')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
const logOut = fs.createWriteStream(LOG_FILE, { flags: 'a' });
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => { orig(...args); logOut.write(util.format(...args) + '\n'); };
}
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), '[app]', ...a);

// ---------- 配置：和 server.mjs 找的是同一份 ----------
function loadConfig() {
  let file = process.env.WHALE_ROOM_CONFIG || path.join(ROOT, 'config.json');
  if (!process.env.WHALE_ROOM_CONFIG && !fs.existsSync(file)) file = path.join(ROOT, 'config.example.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const config = loadConfig();
const PORT = Number(process.env.PORT || config.port || 5177);
const ROOM_URL = `http://127.0.0.1:${PORT}/`;

// ---------- 房间服务：已经有人在跑（比如终端里的 node server.mjs）就直接用，没有就在 app 里跑一个 ----------
let hosting = false;
/** 看看端口上是什么：room 是房间服务 | free 没人 | other 被别的程序占着 */
async function probe() {
  try {
    const r = await fetch(ROOM_URL + 'api/actions', { signal: AbortSignal.timeout(2000) });
    const j = await r.json().catch(() => null);
    return j?.actions ? 'room' : 'other';
  } catch (err) {
    return err.cause?.code === 'ECONNREFUSED' ? 'free' : 'other';
  }
}
async function ensureServer() {
  const what = await probe();
  if (what === 'room') { if (!hosting) log(`用的是已经在跑的房间服务（${ROOM_URL}）`); return true; }
  if (what === 'other') return false;
  if (hosting) return false; // 自己跑的服务没了？不会发生，保险起见不重复启动
  hosting = true;
  log('在 app 里启动房间服务');
  await import(pathToFileURL(path.join(ROOT, 'server.mjs')).href);
  for (let i = 0; i < 50; i++) { // 最多等 5 秒，等它开始监听
    if (await probe() === 'room') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// ---------- 窗口 ----------
let win = null;
let quitting = false;
const BOUNDS_FILE = path.join(app.getPath('userData'), 'window.json');
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'));
    // 上次的位置还在某块屏幕上才用（外接屏拔掉了就回到默认位置）
    const onScreen = screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y >= w.y - 10 && b.y < w.y + w.height - 80);
    return onScreen ? b : { width: b.width, height: b.height };
  } catch { return {}; }
}
let saveTimer = null;
function saveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    fs.writeFile(BOUNDS_FILE, JSON.stringify(win.getNormalBounds()), (err) => { if (err) log('窗口位置没存上：' + err.message); });
  }, 500);
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 640, minHeight: 420, ...savedBounds(),
    title: NAME, backgroundColor: '#10131f', show: false,
    // 窗口藏起来时让浏览器照常省电（停掉画面刷新），她的生活靠页面里的 Worker 节拍器接着算。
    // Electron 不会像 Edge / Chrome 那样把页面整个冻住或丢掉，这是做成 app 的关键。
    webPreferences: { spellcheck: false },
  });
  win.loadURL(ROOM_URL);
  win.once('ready-to-show', () => win.show());
  for (const ev of ['resize', 'move']) win.on(ev, saveBounds);
  // 关窗口 = 藏起来（她还在房间里）。macOS 点 Dock 图标再叫出来；别的系统就最小化到任务栏。
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (process.platform === 'darwin') win.hide(); else win.minimize();
  });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // 服务还没起来 / 刚重启：过几秒再试
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 是被新的加载打断，不用管
    log(`房间页面没打开（${desc}），3 秒后再试`);
    setTimeout(async () => { if (win && !win.isDestroyed()) { await ensureServer(); win.loadURL(ROOM_URL); } }, 3000);
  });
  // 页面进程崩了：重新打开
  wc.on('render-process-gone', (_e, d) => {
    if (quitting) return;
    log(`房间页面进程没了（${d.reason}），2 秒后重新打开`);
    setTimeout(() => { if (win && !win.isDestroyed()) win.loadURL(ROOM_URL); }, 2000);
  });
  // 页面卡死超过 30 秒：强制重开
  let hang = null;
  wc.on('unresponsive', () => {
    log('房间页面没响应了，再等 30 秒');
    clearTimeout(hang);
    hang = setTimeout(() => { if (win && !win.isDestroyed()) { log('房间页面卡死，重新打开'); wc.forcefullyCrashRenderer(); } }, 30000);
  });
  wc.on('responsive', () => { clearTimeout(hang); });
  // 页面里的报错也记进日志，方便查
  wc.on('console-message', (e) => { if (e.level === 'error') log('[页面报错] ' + e.message); });
  // 外面的链接（B 站视频之类）用系统浏览器打开，不在房间窗口里跳走
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(ROOM_URL)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

// ---------- 菜单 ----------
function buildMenu() {
  const canLogin = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
  const loginItem = canLogin ? [{
    label: '开机时自动打开', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
    click: (item) => {
      try { app.setLoginItemSettings({ openAtLogin: item.checked }); } catch (err) { log('设置开机自动打开失败：' + err.message); }
      const st = app.getLoginItemSettings();
      item.checked = st.openAtLogin;
      if (st.status === 'requires-approval') dialog.showMessageBox({ message: '还差一步：到「系统设置 → 通用 → 登录项」里允许「大肥鱼的家」。' });
    },
  }, { type: 'separator' }] : [];
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: NAME,
      submenu: [{ role: 'about', label: '关于' + NAME }, { type: 'separator' }, ...loginItem, { role: 'hide', label: '隐藏' }, { role: 'hideOthers', label: '隐藏其他' }, { type: 'separator' }, { role: 'quit', label: '退出（关掉房间）' }],
    }] : [{ label: '文件', submenu: [...loginItem, { role: 'quit', label: '退出（关掉房间）' }] }]),
    { role: 'editMenu', label: '编辑' },
    {
      label: '查看',
      submenu: [
        { label: '显示房间', accelerator: 'CmdOrCtrl+1', click: showWindow },
        { role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
    {
      label: '帮助',
      submenu: [
        { label: '打开日志', click: () => shell.openPath(LOG_FILE) },
        { label: '打开项目文件夹', click: () => shell.openPath(ROOT) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 启动 ----------
// 注意：入口文件顶层不能 await app.whenReady()——Electron 要等入口的顶层 await 都结束才发 ready，会互相等死。
if (!app.requestSingleInstanceLock()) {
  app.quit(); // 已经开着一个了：那边会把窗口叫出来
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow); // 点 Dock 图标
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {}); // 窗口只会藏起来，不会因为没窗口就退出
  app.whenReady().then(start).catch((err) => {
    console.error(err);
    dialog.showErrorBox('大肥鱼的家没能打开', String(err?.stack ?? err));
    app.exit(1);
  });
}

async function start() {
  log(`启动（Electron ${process.versions.electron}，项目在 ${ROOT}）`);
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(path.join(ROOT, 'app', 'icon.png'));
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* 没有也行 */ }
  app.setAboutPanelOptions({ applicationName: NAME, applicationVersion: version, credits: '她在房间里自由活动，和 QQ 聊天同步。' });
  buildMenu();

  // 别让系统把 app 挂起（App Nap）。这也会让 Mac 不进入闲置睡眠（屏幕照样可以关）——她的 QQ 本来就要电脑醒着。
  // 不想这样：config.json 里写 "app": { "keepAwake": false }
  if (config.app?.keepAwake !== false) powerSaveBlocker.start('prevent-app-suspension');

  if (!await ensureServer()) {
    await dialog.showMessageBox({ type: 'error', message: `端口 ${PORT} 被别的程序占着，房间服务开不起来。`, detail: '关掉占用它的程序，或者在 config.json 里换一个 port，再打开大肥鱼的家。' });
    app.exit(1);
  } else {
    createWindow();
    // 每 30 秒看一眼服务还在不在：用的是外面的服务、它又被关了，就在 app 里接着跑一个
    setInterval(async () => {
      if (hosting) return;
      if (await probe() === 'free' && await ensureServer() && win && !win.isDestroyed()) win.loadURL(ROOM_URL);
    }, 30000);
  }
}

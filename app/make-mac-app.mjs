#!/usr/bin/env node
// npm run app:mac：在 dist/ 里做一个「大肥鱼的家.app」（只支持 macOS）。
// 做法：复制一份 Electron.app，改名字、换图标，里面只放一个小入口，指回这个项目的 app/main.mjs。
// 所以项目里的代码改了不用重新做 app，重开一下就行；但项目文件夹挪了位置，要重新做一次。
//   node app/make-mac-app.mjs [--out 输出目录]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findElectron, HOW_TO_GET_ELECTRON } from './electron-path.mjs';

if (process.platform !== 'darwin') { console.error('这个脚本只能在 macOS 上用。别的系统用 npm run app 打开。'); process.exit(1); }
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(APP_DIR, '..');
const NAME = '大肥鱼的家';
const EXE = 'WhaleRoom'; // 可执行文件名用英文，免得有的工具不认中文
const outIdx = process.argv.indexOf('--out');
const OUT_DIR = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : path.join(ROOT, 'dist'));
const OUT = path.join(OUT_DIR, NAME + '.app');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

const electron = findElectron();
if (!electron?.bundle) { console.error(HOW_TO_GET_ELECTRON); process.exit(1); }
console.log(`用${electron.from}：${electron.bundle}`);

// 1. 复制 Electron.app。框架里的符号链接（Versions/Current 之类）必须原样保留，不然签名会失败。
// 先用 rsync：有的共享文件夹、网络盘上 ditto 复制符号链接会出错；没有 rsync 再用 ditto。
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
if (fs.existsSync('/usr/bin/rsync')) run('/usr/bin/rsync', ['-a', electron.bundle + '/', OUT + '/']);
else run('/usr/bin/ditto', [electron.bundle, OUT]);
if (!fs.lstatSync(path.join(OUT, 'Contents/Frameworks/Electron Framework.framework/Versions/Current')).isSymbolicLink()) {
  console.error('复制出来的 Electron.app 丢了符号链接，做不成。试试把 Electron 放到本机磁盘上，再用 ELECTRON_PATH 指过去。');
  process.exit(1);
}
const C = path.join(OUT, 'Contents');
const RES = path.join(C, 'Resources');

// 2. 入口：Resources/app 里放一个小包，转去加载项目里的 app/main.mjs
fs.rmSync(path.join(RES, 'default_app.asar'), { force: true });
fs.rmSync(path.join(RES, 'app'), { recursive: true, force: true });
fs.rmSync(path.join(RES, 'app.asar'), { force: true });
fs.mkdirSync(path.join(RES, 'app'));
const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
let version = pkg.version;
try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? version; } catch { /* 用 app/package.json 的 */ }
fs.writeFileSync(path.join(RES, 'app/package.json'), JSON.stringify({ name: pkg.name, productName: NAME, version, private: true, type: 'module', main: 'main.mjs' }, null, 2) + '\n');
fs.writeFileSync(path.join(RES, 'app/main.mjs'), [
  `// 大肥鱼的家.app 的入口：真正的代码在项目文件夹里（${ROOT}）`,
  `import ${JSON.stringify(pathToFileURL(path.join(APP_DIR, 'main.mjs')).href)};`,
  '',
].join('\n'));

// 3. 图标：app/icon.png → icon.icns
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-icon-'));
const iconset = path.join(tmp, 'icon.iconset');
fs.mkdirSync(iconset);
for (const s of [16, 32, 128, 256, 512]) {
  run('/usr/bin/sips', ['-z', String(s), String(s), path.join(APP_DIR, 'icon.png'), '--out', path.join(iconset, `icon_${s}x${s}.png`)]);
  run('/usr/bin/sips', ['-z', String(s * 2), String(s * 2), path.join(APP_DIR, 'icon.png'), '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)]);
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(RES, 'icon.icns')]);
fs.rmSync(tmp, { recursive: true, force: true });

// 4. 改名字：Info.plist 和可执行文件
const plist = path.join(C, 'Info.plist');
const oldExe = run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', plist]).trim();
if (oldExe !== EXE) fs.renameSync(path.join(C, 'MacOS', oldExe), path.join(C, 'MacOS', EXE));
const set = (key, value) => run('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
set('CFBundleExecutable', EXE);
set('CFBundleName', NAME);
set('CFBundleDisplayName', NAME);
set('CFBundleIdentifier', 'io.github.whale-room');
set('CFBundleIconFile', 'icon.icns');
set('CFBundleShortVersionString', version);
set('CFBundleVersion', version);
try { run('/usr/bin/plutil', ['-remove', 'ElectronAsarIntegrity', plist]); } catch { /* 本来就没有 */ }

// 5. 重新签名（改过的 app 签名就失效了，Apple 芯片上不签名打不开）。用本机临时签名，只在这台电脑上用
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', OUT]);

console.log(`做好了：${OUT}`);
console.log('拖进「应用程序」文件夹或者 Dock 里就能双击打开。开着它就不用再开 node server.mjs 和浏览器里的房间页面了。');

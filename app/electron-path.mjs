// 找一个能用的 Electron：环境变量 ELECTRON_PATH → 项目里 npm 装的 → DSH 自带的（装了 DSH 就不用再下载）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/** 给一个 .app 或者里面的可执行文件，返回 { bin, bundle }。 */
function normalize(p) {
  if (/\.app\/?$/.test(p)) {
    const bundle = p.replace(/\/$/, '');
    let exe = 'Electron';
    try { exe = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(fs.readFileSync(path.join(bundle, 'Contents/Info.plist'), 'utf8'))?.[1] ?? exe; } catch { /* 用默认名 */ }
    return { bin: path.join(bundle, 'Contents/MacOS', exe), bundle };
  }
  return { bin: p, bundle: /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(p)?.[1] ?? null };
}

/** 返回 { from: 从哪找到的, bin: 可执行文件, bundle: macOS 上的 Electron.app（别的系统是 null） }，找不到返回 null。 */
export function findElectron() {
  const tries = [];
  if (process.env.ELECTRON_PATH) tries.push(['环境变量 ELECTRON_PATH', process.env.ELECTRON_PATH]);
  try { tries.push(['项目里装的 electron', createRequire(import.meta.url)('electron')]); } catch { /* 没装 */ }
  if (process.platform === 'darwin') tries.push(['DSH 自带的 Electron', path.join(os.homedir(), '.dsh/electron/Electron.app')]);
  for (const [from, p] of tries) {
    if (typeof p !== 'string' || !p) continue;
    const found = normalize(p);
    if (fs.existsSync(found.bin)) return { from, ...found };
  }
  return null;
}

export const HOW_TO_GET_ELECTRON = [
  '没找到 Electron。装一个（只装在这个项目里，不影响别的）：',
  '  npm install --no-save electron',
  '在国内下载慢的话，先设一下镜像再装：',
  '  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/',
  '已经有 Electron 的话，也可以用 ELECTRON_PATH 指过去（Electron.app 或者它的可执行文件）。',
].join('\n');

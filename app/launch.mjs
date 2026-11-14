#!/usr/bin/env node
// npm run app：用 Electron 打开大肥鱼的家（开发时用；想要双击就开的 app，用 npm run app:mac）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findElectron, HOW_TO_GET_ELECTRON } from './electron-path.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const electron = findElectron();
if (!electron) { console.error(HOW_TO_GET_ELECTRON); process.exit(1); }
console.log(`用${electron.from}打开大肥鱼的家（日志在「帮助 → 打开日志」）`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 有的环境里带着它，Electron 就只会当 Node 用
const child = spawn(electron.bin, [APP_DIR], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

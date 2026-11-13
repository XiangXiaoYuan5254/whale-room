#!/usr/bin/env node
// 命令行小工具：查看 / 指挥房间里的身体。给大肥鱼的 AI 本体用，也可以自己玩。
//   node room.mjs state                 看她现在在干什么
//   node room.mjs actions               列出能做的动作
//   node room.mjs do window             让她去看窗外
//   node room.mjs do goto bed           走到床边
//   node room.mjs do say 主人你回来啦     头顶冒一句话
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const cfgFile = fs.existsSync(path.join(ROOT, 'config.json')) ? 'config.json' : 'config.example.json';
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, cfgFile), 'utf8'));
const base = process.env.WHALE_ROOM_URL ?? `http://${cfg.host ?? '127.0.0.1'}:${cfg.port}`;
const [cmd, ...rest] = process.argv.slice(2);

async function call(pathname, body) {
  let res;
  try {
    res = await fetch(base + pathname, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch (err) {
    console.error(`连不上房间服务（${base}）。先在这个文件夹里运行：node server.mjs\n原因：${err.cause?.code ?? err.message}`);
    process.exit(2);
  }
  return res.json();
}

if (cmd === 'state') {
  const s = await call('/api/state');
  if (!s.roomOpen) console.log(s.note);
  else {
    const st = s.state;
    console.log(`她正在：${st.doing}（${st.place}）`);
    console.log(`房间时间 ${st.roomTime}，${{ night: '夜里', dawn: '清晨', day: '白天', dusk: '黄昏' }[st.dayPhase]}，${{ clear: '晴', cloudy: '多云', rain: '下雨', snow: '下雪' }[st.weather]}；台灯${st.lampOn ? '开着' : '关着'}，电脑${st.laptopOn ? '开着' : '关着'}`);
    console.log(`表情 ${st.expression}，心情 ${st.mood}，${st.freeRoam ? '自由活动中' : '在等指令'}`);
  }
  console.log(`QQ：${s.qq.connected ? '已连接' : s.qq.enabled ? '未连接' : '未启用'}`);
} else if (cmd === 'actions') {
  const { actions } = await call('/api/actions');
  for (const [k, v] of Object.entries(actions)) console.log(`${k.padEnd(9)} ${v}`);
} else if (cmd === 'do' && rest.length) {
  const [action, ...args] = rest;
  const body = { action };
  if (action === 'say') body.text = args.join(' ');
  else if (args.length === 2 && args.every((a) => !Number.isNaN(Number(a)))) body.target = { x: Number(args[0]), z: Number(args[1]) };
  else if (args.length) body.target = args[0];
  body.wait = true; // 等身体真的做完（或到位）再返回，这样说出来的才是真的
  const r = await call('/api/act', body);
  if (!r.ok) { console.log(`${r.error}\n可用动作：${(r.actions ?? []).join(' ')}`); process.exit(1); }
  if (!r.delivered) console.log(r.note);
  else if (r.done) {
    console.log(`做好了，她现在：${r.doing}`);
    if (r.photo) console.log(r.photo.taken ? `照片（${r.photo.subject}）${r.photo.sentToQQ ? '已发到主人 QQ' : '没发到 QQ：' + (r.photo.note ?? '')}，存在 ${r.photo.file}` : `没拍成：${r.photo.note}`);
    if (r.music) console.log(r.music.error ? `音箱没反应：${r.music.error}` : r.music.playing ? `在放：${r.music.track ?? ''}${r.music.artist ? ' — ' + r.music.artist : ''}` : '音乐关了');
  } else console.log(`没做完：${r.note ?? r.error ?? ''}（她现在：${r.doing ?? '不清楚'}）`);
} else {
  console.log('用法：node room.mjs state | actions | do <动作> [目标] | do say <一句话>');
  process.exit(cmd ? 1 : 0);
}

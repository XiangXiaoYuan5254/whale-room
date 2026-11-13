#!/usr/bin/env node
// 假的 NapCat（OneBot 11 正向 WebSocket 服务端），只用来在没有 QQ 的机器上测试桥接。
// 行为照着真实配置来：需要 access_token；主人的消息会作为事件推送；
// 她自己的回复「不推送」（reportSelfMessage=false），只能从 get_friend_msg_history 里查到。
//
// 用法：node bridge/mock-onebot.mjs [--demo]
//   启动后在终端里直接打字 = 主人发消息；  /r 内容 = 她回复；  /poke = 戳一戳；  /auto = 开关自动回复
//   --demo：有客户端连上后自动演一小段对话
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgFile = fs.existsSync(path.join(ROOT, 'config.json')) ? 'config.json' : 'config.example.json';
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, cfgFile), 'utf8')).onebot;
const port = Number(process.env.MOCK_PORT ?? new URL(cfg.url).port ?? 3001);
// 配置里没填 QQ 号时，用两个假号码
const SELF = Number(cfg.botQQ) || 10001, OWNER = Number(cfg.ownerQQ?.[0]) || 10002;
const demo = process.argv.includes('--demo');

const clients = new Set();
const history = [];
let seq = 1000, auto = false;

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}
const sendAll = (obj) => { const f = frame(JSON.stringify(obj)); for (const s of clients) s.write(f); };

function message(from, text, extra = {}) {
  const m = {
    self_id: SELF, user_id: from, time: Math.floor(Date.now() / 1000), message_id: ++seq, message_seq: seq,
    message_type: 'private', sub_type: 'friend', raw_message: text, font: 14,
    sender: { user_id: from, nickname: from === SELF ? '大肥鱼' : '主人', card: '' },
    message: [{ type: 'text', data: { text } }], message_format: 'array', ...extra,
  };
  history.push(m);
  return m;
}
function ownerSays(text) {
  const m = message(OWNER, text);
  sendAll({ ...m, post_type: 'message' });
  console.log(`[mock] 主人 → ${text}`);
  if (auto) setTimeout(() => botSays(`收到「${text}」啦～`), 3500);
}
function botSays(text) {
  message(SELF, text); // 注意：不推送事件，只进历史
  console.log(`[mock] 她 → ${text}（只进历史，等房间轮询到）`);
}
function poke() {
  sendAll({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: SELF, user_id: OWNER, target_id: SELF, time: Math.floor(Date.now() / 1000) });
  console.log('[mock] 主人戳了她一下');
}

function onRequest(sock, req) {
  let data = {};
  switch (req.action) {
    case 'get_login_info': data = { user_id: SELF, nickname: '大肥鱼' }; break;
    case 'get_friend_msg_history': data = { messages: history.filter((m) => m.user_id === Number(req.params?.user_id) || m.user_id === SELF).slice(-(req.params?.count ?? 20)) }; break;
    case 'send_private_msg': { // 房间替她发照片：只打印一下收到了什么，不真发
      const segs = Array.isArray(req.params?.message) ? req.params.message : [];
      const img = segs.find((x) => x?.type === 'image');
      console.log(`[mock] 她给 ${req.params?.user_id} 发来${img ? `一张图片（约 ${Math.round(String(img.data?.file ?? '').length * 0.75 / 1024)} KB）` : '一条消息'}`);
      data = { message_id: Date.now() % 1e9 };
      break;
    }
    default:
  }
  sock.write(frame(JSON.stringify({ status: 'ok', retcode: 0, data, message: '', wording: '', echo: req.echo })));
}

const server = http.createServer((req, res) => { res.writeHead(426); res.end('这里只接受 WebSocket'); });
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://local');
  const token = url.searchParams.get('access_token') ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (cfg.accessToken && token !== cfg.accessToken) {
    sock.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    console.log('[mock] 拒绝了一个 token 不对的连接');
    return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(sock);
  console.log(`[mock] 客户端已连接（共 ${clients.size} 个）`);
  sock.write(frame(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect', self_id: SELF, time: Math.floor(Date.now() / 1000) })));
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const mask = buf.subarray(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4])); }
      buf = buf.subarray(need);
      if (op === 8) { sock.end(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op !== 1) continue;
      try { onRequest(sock, JSON.parse(payload.toString('utf8'))); } catch (err) { console.log('[mock] 收到无法解析的请求: ' + err.message); }
    }
  });
  const gone = () => { if (clients.delete(sock)) console.log(`[mock] 客户端断开（剩 ${clients.size} 个）`); };
  sock.on('close', gone); sock.on('error', gone);
  if (demo) {
    setTimeout(() => ownerSays('在干嘛呀？'), 2500);
    setTimeout(() => botSays('刚在窗边看风景～你回来啦！'), 6500);
    setTimeout(() => ownerSays('去玩会儿电脑吧'), 16000);
    setTimeout(() => botSays('好呀，那我去刷会儿视频，嘿嘿'), 20000);
  }
});

server.on('error', (err) => { console.error(err.code === 'EADDRINUSE' ? `端口 ${port} 被占用了（真的 NapCat 在跑？那就不需要这个假的）` : err); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  console.log(`[mock] 假 NapCat 已启动 ws://127.0.0.1:${port}  机器人号 ${SELF}  主人号 ${OWNER}`);
  console.log('[mock] 直接打字 = 主人发消息； /r 内容 = 她回复； /poke = 戳一戳； /auto = 开关自动回复');
});

if (process.stdin.isTTY) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith('/r ')) botSays(t.slice(3));
    else if (t === '/poke') poke();
    else if (t === '/auto') { auto = !auto; console.log('[mock] 自动回复 ' + (auto ? '开' : '关')); }
    else ownerSays(t);
  });
}

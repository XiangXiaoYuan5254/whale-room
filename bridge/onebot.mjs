// OneBot 11 (NapCat) 正向 WebSocket 桥。
// 作为第二个客户端连到 NapCat 的 WS 服务端（DSH 的 dsh-onebot 是第一个）：读事件 + 查历史；唯一会发的是她在房间里拍的照片（sendImage）。
// 她自己发出去的回复默认不会被 NapCat 推送（reportSelfMessage=false），所以用 get_friend_msg_history 轮询补齐。
import { EventEmitter } from 'node:events';

const str = (v) => (v === undefined || v === null ? '' : String(v));

/** 从一段文字（或分享卡片的 JSON）里找 B 站视频：返回 BV 号，或者 b23.tv 短链接（要再解析一次才知道 BV 号），找不到返回 null。 */
export function findBiliLink(s) {
  const t = str(s).replace(/\\\//g, '/');
  const bv = /BV[0-9A-Za-z]{10}/.exec(t);
  if (bv) return bv[0];
  const short = /https?:\/\/b23\.tv\/[0-9A-Za-z]+/.exec(t);
  return short ? short[0] : null;
}

/** 把 OneBot 消息段数组压成一行可显示的文字，同时提取贴图/图片等标记，以及消息里分享的 B 站视频（link）。 */
export function flattenMessage(message, rawMessage) {
  const out = { text: '', sticker: false, image: false, kinds: [], link: null };
  if (typeof message === 'string') {
    out.text = message.replace(/\[CQ:[^\]]*\]/g, (m) => {
      if (m.startsWith('[CQ:image')) { out.image = true; return m.includes('sub_type=1') ? '[动画表情]' : '[图片]'; }
      if (m.startsWith('[CQ:face')) return '[表情]';
      if (m.startsWith('[CQ:record')) return '[语音]';
      if (m.startsWith('[CQ:at')) return '@';
      return '';
    });
    out.link = findBiliLink(message);
    return out;
  }
  if (!Array.isArray(message)) { out.text = str(rawMessage); return out; }
  const parts = [];
  for (const seg of message) {
    const d = seg?.data ?? {};
    out.kinds.push(seg?.type);
    switch (seg?.type) {
      case 'text': parts.push(str(d.text)); break;
      case 'face': parts.push('[表情]'); break;
      case 'mface': out.sticker = true; parts.push(d.summary ? str(d.summary) : '[动画表情]'); break;
      case 'image': {
        out.image = true;
        const isSticker = Number(d.sub_type) === 1 || /动画表情/.test(str(d.summary));
        if (isSticker) out.sticker = true;
        parts.push(isSticker ? '[动画表情]' : '[图片]');
        break;
      }
      case 'record': parts.push('[语音]'); break;
      case 'video': parts.push('[视频]'); break;
      case 'file': parts.push('[文件]'); break;
      case 'at': parts.push('@' + (d.name || d.qq || '')); break;
      case 'reply': break;
      case 'json': { const link = findBiliLink(d.data); if (link) { out.link ??= link; parts.push('[B站视频]'); } else parts.push('[卡片]'); break; }
      case 'forward': parts.push('[聊天记录]'); break;
      case 'poke': parts.push('[戳一戳]'); break;
      default: if (seg?.type) parts.push(`[${seg.type}]`);
    }
  }
  out.text = parts.join('').trim();
  out.link ??= findBiliLink(out.text);
  return out;
}

export class OneBotBridge extends EventEmitter {
  constructor(cfg, log = console.log) {
    super();
    this.cfg = cfg;
    this.log = log;
    this.ws = null;
    this.connected = false;
    this.selfId = str(cfg.botQQ);
    this.owners = new Set((cfg.ownerQQ ?? []).map(str));
    this.pending = new Map();
    this.echoSeq = 0;
    this.seen = new Set();
    this.primed = new Set();
    this.activeUntil = 0;
    this.retryMs = 2000;
    this.stopped = false;
    this.lastError = null;
    this.pollTimer = null;
  }

  status() {
    return {
      enabled: true,
      connected: this.connected,
      url: this.cfg.url,
      selfId: this.selfId,
      owners: [...this.owners],
      lastError: this.lastError,
    };
  }

  start() {
    if (typeof WebSocket === 'undefined') {
      this.lastError = '当前 Node 版本没有内置 WebSocket（需要 Node 22+）';
      this.log('[onebot] ' + this.lastError);
      this.emit('status', this.status());
      return;
    }
    this.#connect();
    this.#schedulePoll(1000);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    try { this.ws?.close(); } catch (err) { this.lastError = String(err?.message ?? err); }
  }

  #connect() {
    if (this.stopped) return;
    const sep = this.cfg.url.includes('?') ? '&' : '?';
    const url = this.cfg.accessToken
      ? `${this.cfg.url}${sep}access_token=${encodeURIComponent(this.cfg.accessToken)}`
      : this.cfg.url;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.lastError = String(err?.message ?? err);
      this.#retry();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.connected = true;
      this.lastError = null;
      this.retryMs = 2000;
      this.log(`[onebot] 已连接 ${this.cfg.url}`);
      this.emit('status', this.status());
      this.call('get_login_info', {}).then((info) => {
        if (info?.user_id) this.selfId = str(info.user_id);
        this.log(`[onebot] 登录号 ${this.selfId} ${info?.nickname ?? ''}`);
        this.emit('status', this.status());
      }).catch((err) => this.log('[onebot] get_login_info 失败: ' + err.message));
    });
    ws.addEventListener('message', (ev) => {
      let data;
      try { data = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); }
      catch (err) { this.log('[onebot] 收到非 JSON 帧: ' + err.message); return; }
      if (data && data.echo !== undefined && this.pending.has(data.echo)) {
        const p = this.pending.get(data.echo);
        this.pending.delete(data.echo);
        clearTimeout(p.timer);
        if (data.status === 'ok' || data.retcode === 0) p.resolve(data.data);
        else p.reject(new Error(data.message || data.wording || `retcode ${data.retcode}`));
        return;
      }
      this.#handleEvent(data);
    });
    ws.addEventListener('close', () => {
      const was = this.connected;
      this.connected = false;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('连接已断开')); }
      this.pending.clear();
      if (was) this.log('[onebot] 连接断开，稍后重连');
      this.emit('status', this.status());
      this.#retry();
    });
    ws.addEventListener('error', (ev) => {
      this.lastError = str(ev?.message || ev?.error?.message || '连接失败（NapCat 没开？）');
    });
  }

  #retry() {
    if (this.stopped) return;
    setTimeout(() => this.#connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 1.6, 30000);
  }

  call(action, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.connected) { reject(new Error('未连接')); return; }
      const echo = `room-${++this.echoSeq}`;
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error(`${action} 超时`)); }, timeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ action, params, echo }));
    });
  }

  #isOwner(id) { return this.owners.size === 0 || this.owners.has(str(id)); }

  #handleEvent(e) {
    if (!e || typeof e !== 'object') return;
    if (e.self_id && !this.selfId) this.selfId = str(e.self_id);
    switch (e.post_type) {
      case 'meta_event': return;
      case 'message':
      case 'message_sent': {
        if (e.message_type !== 'private') return; // 群聊不上屏
        this.#ingest(e, false);
        if (e.post_type === 'message') this.nudge();
        return;
      }
      case 'notice': {
        if (e.notice_type === 'notify' && e.sub_type === 'poke') {
          if (str(e.target_id) === this.selfId && this.#isOwner(e.user_id)) {
            this.emit('event', { type: 'poke', from: str(e.user_id), at: Date.now() });
          }
        } else if (e.notice_type === 'notify' && e.sub_type === 'input_status') {
          if (this.#isOwner(e.user_id)) {
            this.emit('event', { type: 'typing', from: str(e.user_id), at: Date.now() });
          }
        }
        return;
      }
      default:
    }
  }

  /** 统一处理一条私聊消息（来自事件推送或历史轮询）。history=true 表示连上之前就存在的旧消息，只进聊天记录不触发动作。 */
  #ingest(m, history) {
    const senderId = str(m.sender?.user_id ?? m.user_id);
    const out = m.post_type === 'message_sent' || senderId === this.selfId;
    const peer = out ? str(m.target_id ?? m.peer_id ?? m.user_id) : senderId;
    const flat = flattenMessage(m.message, m.raw_message);
    // 两把去重钥匙：消息号，以及「方向+秒级时间+正文」（事件推送和历史查询的消息号万一对不上时兜底）
    const id = str(m.message_id || m.message_seq || `${m.time}-${m.user_id}`);
    const alt = `${out ? 'o' : 'i'}|${m.time ?? ''}|${flat.text}`;
    if (this.seen.has(id) || (m.time && this.seen.has(alt))) return;
    this.seen.add(id);
    if (m.time) this.seen.add(alt);
    if (this.seen.size > 4000) this.seen = new Set([...this.seen].slice(-2000));
    const fromOwner = this.#isOwner(out ? peer : senderId);
    if (!fromOwner && !this.cfg.showOthers) {
      if (!out && !history) this.emit('event', { type: 'qq', dir: 'in', hidden: true, text: '', at: Date.now() });
      return;
    }
    if (!out && !history) this.activeUntil = Date.now() + (this.cfg.activeWindowMs ?? 120000);
    this.emit('event', {
      type: 'qq',
      dir: out ? 'out' : 'in',
      id,
      peer,
      nickname: str(m.sender?.nickname || m.sender?.card || ''),
      text: flat.text,
      sticker: flat.sticker,
      image: flat.image,
      link: flat.link,
      history,
      at: m.time ? m.time * 1000 : Date.now(),
    });
  }

  #schedulePoll(ms) {
    if (this.stopped) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.#poll(), ms);
  }

  async #poll() {
    const active = Date.now() < this.activeUntil;
    try {
      if (this.connected) {
        for (const owner of this.owners) {
          const data = await this.call('get_friend_msg_history', { user_id: Number(owner) || owner, count: 12 });
          const list = Array.isArray(data?.messages) ? data.messages : Array.isArray(data) ? data : [];
          const first = !this.primed.has(owner);
          list.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
          for (const m of list) {
            // 历史里的私聊消息没有 target_id，补上对端，方便判断归属
            this.#ingest({ ...m, message_type: 'private', target_id: m.target_id ?? owner }, first);
          }
          this.primed.add(owner);
        }
      }
    } catch (err) {
      this.lastError = '轮询历史失败: ' + err.message;
    }
    this.#schedulePoll(active ? (this.cfg.pollActiveMs ?? 1500) : (this.cfg.pollIdleMs ?? 15000));
  }

  /**
   * 把一张图片发到主人的 QQ 私聊（她在房间里拍的照片）。
   * @param base64 图片内容（不带 data: 前缀）
   * @returns 发给了哪些号
   */
  async sendImage(base64) {
    if (!this.connected) throw new Error('QQ 没连上');
    if (!this.owners.size) throw new Error('config.json 里没写主人的 QQ 号（onebot.ownerQQ）');
    const sent = [];
    for (const owner of this.owners) {
      await this.call('send_private_msg', { user_id: Number(owner) || owner, message: [{ type: 'image', data: { file: 'base64://' + base64 } }] }, 20000);
      sent.push(owner);
    }
    this.nudge();
    return sent;
  }

  /** 有新的来信时立刻加快轮询，尽快拿到她的回复。 */
  nudge() {
    this.activeUntil = Date.now() + (this.cfg.activeWindowMs ?? 120000);
    this.#schedulePoll(this.cfg.pollActiveMs ?? 1500);
  }
}

// 界面层：头顶气泡、QQ 聊天面板、顶部状态条、底部按钮。全部是叠在 3D 画面上的普通网页元素。
import * as THREE from 'three';
import { WEATHER_LABEL } from './env.js';

const $ = (id) => document.getElementById(id);
const hhmm = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

class Bubble {
  constructor(cls, dx, dy) {
    this.el = document.createElement('div');
    this.el.className = 'bubble ' + cls;
    this.dx = dx; this.dy = dy; this.until = 0; this.shown = false;
    $('bubbles').appendChild(this.el);
  }
  show(html, sec, now) { this.el.innerHTML = html; this.until = now + sec; this.shown = true; this.el.classList.add('show'); }
  text(str, sec, now) { this.el.textContent = str; this.until = now + sec; this.shown = true; this.el.classList.add('show'); }
  hide() { this.shown = false; this.el.classList.remove('show'); }
  place(x, y) { this.el.style.transform = `translate(${Math.round(x + this.dx)}px, ${Math.round(y + this.dy)}px) translate(-50%, -100%)`; }
}

export class UI {
  constructor(clock) {
    this.clock = clock; // 气泡的显示时长跟模拟时钟走（页面在后台时也不会乱）
    this.speechB = new Bubble('', 0, -8);
    this.thinkB = new Bubble('think', 0, -8);
    this.museB = new Bubble('muse', 0, -8);
    this.emoteB = new Bubble('emote', 54, 6);
    this.phoneB = new Bubble('phone', -20, -8);
    this.typing = null; // 打字机效果
    this.handlers = {};
    this.name = '大肥鱼';
    this.chatCount = 0;
    try { this.chatClearedAt = Number(localStorage.getItem('whaleRoom.chatClearedAt') || 0); } catch { this.chatClearedAt = 0; }
    this.#bind();
  }

  on(name, fn) { this.handlers[name] = fn; }
  #emit(name, ...args) { this.handlers[name]?.(...args); }

  #bind() {
    const chat = $('chat');
    if (innerWidth < 1100) chat.classList.add('closed');
    $('chat-toggle').addEventListener('click', () => chat.classList.toggle('closed'));
    $('chat-clear').addEventListener('click', () => this.clearChat());
    for (const b of document.querySelectorAll('#g-act button')) b.addEventListener('click', () => this.#emit('act', b.dataset.act, b.dataset.target ?? null));
    const group = (sel, attr, ev) => {
      const btns = [...document.querySelectorAll(sel + ' button')];
      for (const b of btns) b.addEventListener('click', () => { btns.forEach((o) => o.classList.toggle('on', o === b)); this.#emit(ev, b.dataset[attr]); });
    };
    group('#g-time', 'time', 'time');
    group('#g-weather', 'weather', 'weather');
    $('btn-lamp').addEventListener('click', () => this.#emit('lamp'));
    $('btn-follow').addEventListener('click', () => { const on = $('btn-follow').classList.toggle('on'); this.#emit('follow', on); });
    $('btn-reset').addEventListener('click', () => { $('btn-follow').classList.remove('on'); this.#emit('reset'); });
    $('btn-sound').addEventListener('click', () => this.#emit('sound'));
    $('snap').addEventListener('click', () => $('snap').classList.remove('show'));
    const send = (kind) => {
      const input = $('test-text');
      const text = input.value.trim();
      if (kind !== 'poke' && !text) { input.focus(); return; }
      this.#emit('test', kind, text);
      if (kind !== 'poke') input.value = '';
    };
    $('test-in').addEventListener('click', () => send('in'));
    $('test-out').addEventListener('click', () => send('out'));
    $('test-poke').addEventListener('click', () => send('poke'));
    $('test-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') send('in'); });
    setTimeout(() => { $('hint').style.opacity = '0'; }, 9000);
  }

  setName(name) { this.name = name; $('name').textContent = name; document.title = name + '的家'; }
  ready() { $('loading').classList.add('gone'); }

  // ---------- 气泡 ----------
  /** 她说的话：从头顶冒出来，带打字机效果。 */
  speech(text, sec) {
    this.thinkB.hide(); this.museB.hide();
    this.typing = { text, i: 0, acc: 0, el: this.speechB.el };
    this.speechB.text('', sec, this.now);
  }
  /** 她的心里话 / 碎碎念：云朵气泡，一个字一个字冒出来。正在说话时不抢。 */
  thought(text, sec) {
    if (this.speechB.shown) return;
    this.typing = { text, i: 0, acc: 0, el: this.museB.el };
    this.museB.text('', sec, this.now);
  }
  /** 拍照时闪一下。 */
  flash() { const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 90); }
  /** 右下角弹出她刚拍的照片。note：一句说明（发到 QQ 了 / 只存在了本地）。 */
  showPhoto(dataUrl, note) {
    const s = $('snap');
    s.querySelector('img').src = dataUrl; s.querySelector('small').textContent = note;
    s.classList.add('show');
    clearTimeout(this.snapTimer); this.snapTimer = setTimeout(() => s.classList.remove('show'), 9000);
  }
  /** 顶部的「正在放的歌」。传 null 收起。 */
  setMusic(text) { const c = $('chip-music'); c.hidden = !text; c.textContent = text ? '♪ ' + text : ''; }
  setSound(on) { $('btn-sound').classList.toggle('on', on); }
  think(on) { if (on) { this.speechB.hide(); this.museB.hide(); this.thinkB.text('···', 9999, this.now); } else this.thinkB.hide(); }
  emote(sym, sec = 2) { this.emoteB.text(sym, sec, this.now); }
  /** 手机上弹出的来信。 */
  phoneNote(text, sec = 6) {
    const safe = document.createElement('span'); safe.textContent = text;
    this.phoneB.show(`<small>📱 你发来</small>${safe.innerHTML}`, sec, this.now);
  }
  clearBubbles() { this.speechB.hide(); this.thinkB.hide(); this.museB.hide(); this.phoneB.hide(); this.typing = null; }

  /** 每帧：推进打字机、过期隐藏、把气泡贴到她头顶在屏幕上的位置。 */
  get now() { return this.clock.now; }

  update(dt, headWorld, camera) {
    if (this.typing) {
      this.typing.acc += dt * 32;
      const n = Math.min(this.typing.text.length, Math.floor(this.typing.acc));
      if (n !== this.typing.i) { this.typing.i = n; this.typing.el.textContent = this.typing.text.slice(0, n); }
      if (n >= this.typing.text.length) this.typing = null;
    }
    for (const b of [this.speechB, this.thinkB, this.museB, this.emoteB, this.phoneB]) if (b.shown && this.now > b.until) b.hide();
    const v = headWorld.clone().project(camera);
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const cx = Math.min(innerWidth - 150, Math.max(150, x)), cy = Math.max(90, y);
    this.speechB.place(cx, cy); this.thinkB.place(cx, cy); this.museB.place(cx, cy); this.emoteB.place(x, y);
    this.phoneB.place(Math.max(140, x - 150), cy + 70);
  }

  // ---------- 聊天面板 ----------
  clearChat() {
    this.chatClearedAt = Date.now();
    try { localStorage.setItem('whaleRoom.chatClearedAt', String(this.chatClearedAt)); } catch {}
    this.chatCount = 0;
    $('chat-log').innerHTML = '<div class="empty">已清空当前显示的消息。<br>新的 QQ 对话还会继续同步到这里。</div>';
  }
  addChat(ev) {
    if (ev.history && (ev.at ?? 0) <= this.chatClearedAt) return;
    const log = $('chat-log');
    if (this.chatCount === 0) log.innerHTML = '';
    this.chatCount++;
    const el = document.createElement('div');
    el.className = `msg ${ev.dir === 'in' ? 'in' : 'out'}${ev.history ? ' old' : ''}`;
    const who = document.createElement('small');
    who.textContent = `${ev.dir === 'in' ? '你' : this.name} · ${hhmm(ev.at ?? Date.now())}${ev.mock ? ' · 测试' : ''}`;
    el.appendChild(who);
    el.appendChild(document.createTextNode(ev.text || (ev.sticker ? '[动画表情]' : '[消息]')));
    log.appendChild(el);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  // ---------- 顶部状态 ----------
  setBridge(st) {
    const chip = $('chip-qq'), dot = chip.querySelector('.dot'), label = chip.querySelector('span');
    dot.className = 'dot' + (st?.connected ? ' ok' : st?.enabled ? ' bad' : '');
    label.textContent = st?.connected ? 'QQ 已连接' : st?.enabled ? 'QQ 未连接（等 NapCat）' : 'QQ 桥未启用';
    chip.title = st?.connected ? `机器人号 ${st.selfId}` : (st?.lastError ?? '');
    const test = $('test');
    if (!st?.connected && test && !test.dataset.touched) { test.open = true; test.dataset.touched = '1'; }
  }
  setDoing(text) { $('chip-doing').innerHTML = ''; const b = document.createElement('b'); b.textContent = text; $('chip-doing').append('她：', b); }
  setEnv(state, timeMode) {
    const h = Math.floor(state.hour), m = Math.floor((state.hour - h) * 60);
    const phase = { night: '夜', dawn: '清晨', day: '白天', dusk: '黄昏' }[state.phase];
    $('chip-time').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${phase}${timeMode === 'auto' ? '' : '（手动）'}`;
    $('chip-weather').textContent = `${WEATHER_LABEL[state.weather]}${state.temperature != null && state.real ? ` ${Math.round(state.temperature)}°C` : ''}`;
  }
  setLamp(on) { $('btn-lamp').classList.toggle('on', on); }
  setAuto(on) { for (const b of document.querySelectorAll('#g-act button')) b.classList.toggle('on', b.dataset.act === 'auto' && on); }
}

/** 区分「点击」和「拖动旋转」，并把点击射到场景里。 */
export class Picker {
  constructor(canvas, camera, scene, onPick) {
    this.ray = new THREE.Raycaster();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), held = performance.now() - down.t;
      down = null;
      if (moved > 6 || held > 450) return;
      const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.ray.setFromCamera(ndc, camera);
      const hits = this.ray.intersectObjects(scene.children, true);
      for (const h of hits) {
        const o = h.object;
        if (o.userData.isOutline || o.material?.colorWrite === false && !o.name) continue;
        let her = false;
        for (let q = o; q; q = q.parent) if (q.userData.isCharacterRoot) { her = true; break; }
        if (her) { onPick('her', h.point); return; }
        let n = o;
        while (n && !n.name) n = n.parent;
        if (n?.name) { onPick(n.name, h.point); return; }
        if (o.isMesh && o.material?.side !== THREE.BackSide) return; // 被没名字的东西挡住了
      }
    });
  }
}

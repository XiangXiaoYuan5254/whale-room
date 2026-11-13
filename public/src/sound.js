// 房间里的声音：雨声、脚步、敲键盘、踢球、手机提示音、电饭煲、水龙头、翻书、快门、挥枪……
// 没有任何音频文件：每个声音都是在浏览器里现合成的（噪声 + 滤波，或者一两个音调），所以听起来偏「示意」，不是真实录音。
// 想换成真的录音：把文件放进 public/assets/sfx/，文件名用下面 NAMES 里的名字（比如 rain.mp3、step.mp3、key.mp3），
// 有文件的就用文件，没有的继续用合成的。
// 音乐不在这里：歌是让这台 Mac 的「音乐」App 放的（见 speaker.js 和 server.mjs 的 /api/music）。
// 浏览器规定必须先有一次点击才能出声，所以声音默认关着，点一下底部的「声音」按钮才开。

/** 一次性的声音 */
const SHOTS = ['step', 'kick', 'bounce', 'key', 'tap', 'click', 'shutter', 'pop', 'beep', 'clink', 'page', 'jump', 'land', 'ring', 'buzz', 'switch', 'munch', 'swish', 'thud'];
/** 持续的声音（循环） */
const LOOPS = ['rain', 'water'];
export const NAMES = [...SHOTS, ...LOOPS];

export class Sound {
  constructor() {
    this.ctx = null; this.on = false; this.master = null; this.noise = null;
    this.buffers = {}; // 你放进 assets/sfx/ 的文件
    this.loops = {}; // name → { gain, level }
    this.prev = {}; this.keyT = 0; this.buzzT = 0; this.lastPhase = 0;
    try { this.want = localStorage.getItem('whale.sound') === '1'; } catch (err) { this.want = false; console.debug('读不到本地存储，声音开关不会被记住', err); }
  }

  /** 上次开着声音：等页面上第一次点击时自动打开（浏览器不允许不经点击就出声）。 */
  armAutostart(onChange) {
    if (!this.want) return;
    const go = () => { removeEventListener('pointerdown', go); this.enable(true).then(() => onChange?.(this.on)); };
    addEventListener('pointerdown', go);
  }

  /** 开 / 关声音。必须在点击事件里调用。 */
  async enable(on) {
    this.on = on;
    try { localStorage.setItem('whale.sound', on ? '1' : '0'); } catch (err) { console.debug('声音开关没记住（本地存储不可用）', err); }
    if (!on) { if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); return; }
    if (!this.ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) { console.warn('[声音] 这个浏览器不支持 Web Audio，出不了声'); this.on = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.#loadFiles();
    }
    await this.ctx.resume();
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.08);
  }

  async #loadFiles() {
    try {
      const { files } = await (await fetch('/api/sfx')).json();
      for (const f of files ?? []) {
        const name = f.replace(/\.[^.]+$/, '');
        if (!NAMES.includes(name)) continue;
        this.buffers[name] = await this.ctx.decodeAudioData(await (await fetch('/assets/sfx/' + encodeURIComponent(f))).arrayBuffer());
        console.info(`[声音] ${name} 用的是你放的文件 ${f}`);
      }
    } catch (err) { console.warn('[声音] 读 assets/sfx/ 里的文件时出错，继续用合成的声音', err); }
  }

  // ---------- 合成用的小零件 ----------
  #env(peak, attack, decay, at) {
    const g = this.ctx.createGain(), t = this.ctx.currentTime + at;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master);
    return g;
  }
  /** 一小段过滤过的噪声。 */
  #burst({ type = 'bandpass', f = 1000, q = 1, peak = 0.1, attack = 0.002, decay = 0.05, at = 0, f2 = null }) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const flt = this.ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    const t = this.ctx.currentTime + at;
    flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + attack + decay);
    src.connect(flt).connect(this.#env(peak, attack, decay, at));
    src.start(t, Math.random() * 1.5); src.stop(t + attack + decay + 0.05);
  }
  /** 一个音调（可以滑音）。 */
  #tone({ type = 'sine', f = 440, f2 = null, peak = 0.1, attack = 0.003, decay = 0.08, at = 0 }) {
    const o = this.ctx.createOscillator(); o.type = type;
    const t = this.ctx.currentTime + at;
    o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + attack + decay);
    o.connect(this.#env(peak, attack, decay, at));
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  /** 放一个一次性的声音。k：音量倍数。 */
  play(name, k = 1) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const file = this.buffers[name];
    if (file) { const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = file; g.gain.value = k; s.connect(g).connect(this.master); s.start(); return; }
    const r = () => 0.85 + Math.random() * 0.3;
    switch (name) {
      case 'step': this.#burst({ type: 'lowpass', f: 420 * r(), peak: 0.07 * k, decay: 0.07 }); break; // 软底鞋踩在木地板上
      case 'kick': this.#tone({ f: 150, f2: 55, peak: 0.5 * k, decay: 0.14 }); this.#burst({ type: 'highpass', f: 1500, peak: 0.08 * k, decay: 0.03 }); break;
      case 'bounce': this.#tone({ f: 230 * r(), f2: 120, peak: 0.16 * k, decay: 0.07 }); break;
      case 'key': this.#burst({ f: 2400 * r(), q: 2.5, peak: 0.1 * k, decay: 0.025 }); this.#tone({ f: 190 * r(), peak: 0.03 * k, decay: 0.03 }); break;
      case 'tap': this.#burst({ type: 'lowpass', f: 900 * r(), peak: 0.035 * k, decay: 0.02 }); break; // 手指点手机屏幕
      case 'click': this.#burst({ type: 'highpass', f: 2200, peak: 0.16 * k, decay: 0.018 }); break;
      case 'shutter': this.#burst({ type: 'highpass', f: 2800, peak: 0.22 * k, decay: 0.03 }); this.#burst({ type: 'highpass', f: 1800, peak: 0.18 * k, decay: 0.05, at: 0.085 }); break;
      case 'pop': this.#tone({ f: 320, f2: 640, peak: 0.14 * k, decay: 0.06 }); this.#burst({ type: 'lowpass', f: 1200, peak: 0.1 * k, decay: 0.08 }); break; // 电饭煲盖子弹开
      case 'beep': this.#tone({ f: 988, peak: 0.07 * k, decay: 0.11 }); break;
      case 'clink': this.#tone({ f: 2300 * r(), peak: 0.045 * k, decay: 0.09 }); this.#tone({ f: 3450 * r(), peak: 0.025 * k, decay: 0.06 }); break; // 勺子碰碗
      case 'page': this.#burst({ f: 1500, f2: 3200, q: 0.8, peak: 0.06 * k, attack: 0.03, decay: 0.16 }); break;
      case 'jump': this.#tone({ f: 300, f2: 520, peak: 0.05 * k, decay: 0.08 }); break;
      case 'land': this.#burst({ type: 'lowpass', f: 300, peak: 0.2 * k, decay: 0.1 }); break;
      case 'ring': this.#tone({ f: 1047, peak: 0.09 * k, decay: 0.1 }); this.#tone({ f: 1319, peak: 0.09 * k, decay: 0.14, at: 0.13 }); break; // 手机消息提示：两声「滴滴」
      case 'buzz': for (let i = 0; i < 6; i++) this.#tone({ type: 'sawtooth', f: 155, peak: 0.035 * k, attack: 0.008, decay: 0.03, at: i * 0.045 }); break; // 手机在台面上震
      case 'switch': this.#burst({ type: 'highpass', f: 1800, peak: 0.2 * k, decay: 0.014 }); break;
      case 'swish': this.#burst({ f: 700 * r(), f2: 2600, q: 1.4, peak: 0.09 * k, attack: 0.05, decay: 0.16 }); break; // 枪划过空气「咻」的一声
      case 'thud': this.#tone({ f: 120 * r(), f2: 70, peak: 0.12 * k, decay: 0.09 }); this.#burst({ type: 'lowpass', f: 600, peak: 0.06 * k, decay: 0.05 }); break; // 枪尾杵在地上 / 枪放下
      case 'munch': for (let i = 0; i < 3; i++) this.#burst({ type: 'lowpass', f: 800 * r(), peak: 0.05 * k, decay: 0.05, at: i * 0.17 }); break;
      default: console.warn('[声音] 没有这个声音: ' + name);
    }
  }

  /** 持续的声音：把音量平滑地调到 level（0 = 停）。 */
  loop(name, level) {
    if (!this.ctx) return;
    let L = this.loops[name];
    if (!L) {
      if (level <= 0) return;
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master);
      const src = this.ctx.createBufferSource(); src.loop = true;
      if (this.buffers[name]) { src.buffer = this.buffers[name]; src.connect(g); }
      else {
        src.buffer = this.noise;
        const hp = this.ctx.createBiquadFilter(), lp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; lp.type = 'lowpass';
        if (name === 'rain') { hp.frequency.value = 500; lp.frequency.value = 5200; } // 隔着窗户听到的雨：沙沙的一片
        else { hp.frequency.value = 1500; lp.frequency.value = 7000; } // 水龙头
        src.connect(hp).connect(lp).connect(g);
      }
      src.start();
      L = this.loops[name] = { gain: g, level: -1 };
    }
    if (Math.abs(L.level - level) < 0.01) return;
    L.level = level;
    L.gain.gain.setTargetAtTime(level * (name === 'rain' ? 0.16 : 0.09), this.ctx.currentTime, 0.4);
  }

  /**
   * 每帧调用：看房间里正在发生什么，该响的就响。只读状态，不改任何东西。
   * @param R window.__room 里的那一套（actor、anim、brain、ball、phone、kitchen、room、env）
   */
  frame(dt, R) {
    if (!this.on || !this.ctx) return;
    const p = this.prev, { actor, anim, brain, ball, phone, kitchen, room, env } = R;
    const edge = (key, now) => { const was = p[key]; p[key] = now; return was !== undefined && was !== now ? now : null; };
    // 雨声、水龙头
    this.loop('rain', env.state.weather === 'rain' ? 1 : 0);
    this.loop('water', kitchen.sink.running ? 1 : brain.pour > 0 ? 0.5 : 0);
    // 脚步：步态每走过半圈（一只脚落地）响一下
    if (actor.speed > 0.06 && actor.pos.y === (p.y ?? actor.pos.y)) {
      const half = Math.floor(anim.walkPhase / Math.PI);
      if (half !== this.lastPhase) { this.lastPhase = half; this.play('step', actor.surface === 'bed' ? 0.45 : actor.speed > 0.8 ? 1.3 : 0.9); }
    } else this.lastPhase = Math.floor(anim.walkPhase / Math.PI);
    p.y = actor.pos.y;
    // 敲键盘 / 在手机上打字
    this.keyT -= dt;
    if (this.keyT <= 0) {
      if (anim.arms === 'type') { this.play('key'); this.keyT = 0.07 + Math.random() * 0.13; }
      else if (anim.hand.typing) { this.play('tap'); this.keyT = 0.1 + Math.random() * 0.2; }
      else this.keyT = 0.05;
    }
    // 球：被踢、撞墙弹回
    const sp = ball.speed;
    if (sp - (p.ballSp ?? 0) > 0.8) this.play('kick');
    else if (p.bvx !== undefined && sp > 0.25 && (Math.sign(ball.vel.x) !== Math.sign(p.bvx) || Math.sign(ball.vel.z) !== Math.sign(p.bvz)) && Math.abs(p.bvx) + Math.abs(p.bvz) > 0.3) this.play('bounce', Math.min(1.5, sp));
    p.ballSp = sp; p.bvx = ball.vel.x; p.bvz = ball.vel.z;
    // 手机：来消息「滴滴」，放着的时候隔一会儿震一下
    if (edge('ring', phone.state === 'ring') === true) { this.play('ring'); this.buzzT = 0.5; }
    if (phone.state === 'ring') { this.buzzT -= dt; if (this.buzzT <= 0) { this.play('buzz'); this.buzzT = 2.2; } }
    // 电饭煲、台灯、翻书、勺子、吃
    const open = edge('cooker', kitchen.cooker.open);
    if (open !== null) { this.play('beep'); this.play(open ? 'pop' : 'click'); }
    if (edge('lamp', room.lamp.on) !== null) this.play('switch');
    if (edge('flip', brain.flip > 0) === true) this.play('page');
    if (edge('spoon', kitchen.spoon.loaded) === true) this.play('clink', 0.8);
    if (edge('bite', brain.bite > 0.9) === true) this.play('munch');
    // 起跳、落地（看她的高度有没有突然开始变、又停下）
    const air = Math.abs(actor.pos.y - (p.ay ?? actor.pos.y)) > 1e-4; p.ay = actor.pos.y;
    const a = edge('air', air);
    if (a === true) this.play('jump'); else if (a === false) this.play('land', 0.8);
  }
}

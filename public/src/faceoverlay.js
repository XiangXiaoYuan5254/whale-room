// 给「脸画在贴图上」的模型加表情：在脸的正面再叠一张实时画的透明图（眼皮、嘴、腮红）。
// 眼睛睁着的时候什么都不盖，用的还是模型自己画好的眼睛；眨眼、睡觉、笑眯眼时才画上眼皮。
// 表情的状态沿用内置角色那套（face.js）：这里只是把同一个状态画到新模型的脸上。
import * as THREE from 'three';

const PX = 1000; // 每个模型单位画多少像素
const LINE = '#221a3a';

export class FaceOverlay {
  /**
   * @param cfg  .rig.json 里的 face：rect [x0, y0, 宽, 高]；eyeL / eyeR [中心x, 中心y, 半宽, 半高]；mouth [x, y, 半宽]；blush [|x|, y]
   * @param skin 脸的肤色（CSS 颜色）
   * @param eyeSkin [左眼, 右眼] 周围的肤色；不给就用 skin
   */
  constructor(cfg, skin, eyeSkin = null) {
    this.cfg = cfg; this.skin = skin; this.eyeSkin = eyeSkin ?? [skin, skin];
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(cfg.rect[2] * PX); this.canvas.height = Math.round(cfg.rect[3] * PX);
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    this.key = '';
    /** 眼皮合上的程度：0 睁着，0.5 半睁，1 闭着或笑眯眼。 */
    this.lid = 0;
  }

  /** 每帧调用：状态变了才重画。face 是内置角色的 Face 对象。 */
  update(face) {
    const s = face.state;
    const eyes = face.blink > 0 ? 'closed' : s.eyes;
    const talking = face.talk > 0;
    const mouth = talking ? 'talk' + Math.round(face.talkOpen * 4) : s.mouth;
    const blush = Math.round((s.blush ?? 0) * 4);
    const key = eyes + '|' + mouth + '|' + blush;
    if (key === this.key) return;
    this.key = key;
    this.draw(eyes, mouth, blush / 4, face.talkOpen);
  }

  // 模型坐标 → 画布坐标
  X(x) { return (x - this.cfg.rect[0]) * PX; }
  Y(y) { return (this.cfg.rect[1] + this.cfg.rect[3] - y) * PX; }

  /** 一块边缘羽化的肤色，用来盖住画在贴图上的眼睛或嘴。solid：中间多大一块是实心的（0~1），外面一圈渐渐透明。 */
  patch(x, y, rx, ry, color = this.skin, solid = 0.8) {
    const g = this.g;
    g.save(); g.translate(this.X(x), this.Y(y)); g.scale(rx * PX, ry * PX);
    const gr = g.createRadialGradient(0, 0, solid, 0, 0, 1);
    gr.addColorStop(0, color); gr.addColorStop(1, color.replace('rgb(', 'rgba(').replace(')', ',0)'));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  draw(eyes, mouth, blush, talkOpen) {
    const g = this.g, c = this.cfg;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.lineCap = 'round'; g.lineJoin = 'round';

    // 眼皮
    const lid = eyes === 'closed' || eyes === 'happy' ? 1 : eyes === 'half' ? 0.5 : 0;
    this.lid = lid;
    if (lid > 0) {
      for (const [k, e] of [c.eyeL, c.eyeR].entries()) {
        const [ex, ey, a, b] = e, sx = Math.sign(ex), skin = this.eyeSkin[k];
        if (lid === 1) {
          // 实心的部分要把整只眼睛连睫毛都盖住（否则边上会透出一圈原来的眼线），颜色用眼睛周围那一圈皮肤的
          this.patch(ex, ey, a + 0.085, b + 0.08, skin, 0.76);
          g.strokeStyle = LINE; g.lineWidth = 0.013 * PX;
          g.beginPath();
          if (eyes === 'happy') { // ^ ^
            g.moveTo(this.X(ex - a * 0.82), this.Y(ey - b * 0.3)); g.quadraticCurveTo(this.X(ex), this.Y(ey + b * 0.75), this.X(ex + a * 0.82), this.Y(ey - b * 0.3));
          } else { // 闭着：一道向下弯的弧，外眼角带两根睫毛
            g.moveTo(this.X(ex - a * 0.86), this.Y(ey - b * 0.12)); g.quadraticCurveTo(this.X(ex), this.Y(ey - b * 0.78), this.X(ex + a * 0.86), this.Y(ey - b * 0.12));
          }
          g.stroke();
          if (eyes !== 'happy') {
            g.lineWidth = 0.008 * PX;
            for (const k of [0.86, 0.6]) { const lx = ex + sx * a * k, ly = ey - b * (k > 0.7 ? 0.14 : 0.42); g.beginPath(); g.moveTo(this.X(lx), this.Y(ly)); g.lineTo(this.X(lx + sx * 0.022), this.Y(ly - 0.022)); g.stroke(); }
          }
        } else { // 半睁：盖住上半只眼睛
          g.save();
          g.beginPath(); g.rect(this.X(ex - a - 0.05), this.Y(ey + b + 0.05), (a * 2 + 0.1) * PX, (b + 0.05 + b * 0.05) * PX); g.clip();
          this.patch(ex, ey + b * 0.35, a + 0.075, b * 1.15, skin, 0.72);
          g.restore();
          g.strokeStyle = LINE; g.lineWidth = 0.014 * PX;
          g.beginPath(); g.moveTo(this.X(ex - a * 0.92), this.Y(ey - b * 0.02)); g.quadraticCurveTo(this.X(ex), this.Y(ey + b * 0.1), this.X(ex + a * 0.92), this.Y(ey - b * 0.02)); g.stroke();
        }
      }
    }

    // 腮红（模型自己已经有一点，害羞、开心时再加深）。画在眼皮之后：不然眼皮那块肤色会把腮红挖掉一块，看着像翻白眼
    if (blush > 0.45) {
      for (const sx of [-1, 1]) {
        g.save(); g.translate(this.X(sx * c.blush[0]), this.Y(c.blush[1])); g.scale(0.062 * PX, 0.03 * PX);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, `rgba(255,120,140,${0.55 * blush})`); gr.addColorStop(1, 'rgba(255,120,140,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }

    // 嘴：模型自带的是抿着的小嘴。要换嘴型就先用肤色盖掉，再画新的。
    const [mx, my, mw] = c.mouth;
    const keep = mouth === 'smile' || mouth === 'flat';
    if (!keep) {
      this.patch(mx, my, mw + 0.03, 0.045);
      g.strokeStyle = LINE; g.lineWidth = 0.009 * PX; g.fillStyle = '#c8485a';
      const X = (x) => this.X(mx + x), Y = (y) => this.Y(my + y);
      g.beginPath();
      if (mouth.startsWith('talk')) { // 说话：一张一合
        const o = 0.25 + 0.75 * talkOpen;
        g.ellipse(X(0), Y(-0.004), mw * 0.5 * PX, 0.026 * o * PX, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      } else if (mouth === 'open') { // 开口笑
        g.moveTo(X(-mw * 0.8), Y(0.012)); g.quadraticCurveTo(X(0), Y(0.004), X(mw * 0.8), Y(0.012)); g.quadraticCurveTo(X(0), Y(-0.05), X(-mw * 0.8), Y(0.012)); g.fill(); g.stroke();
      } else if (mouth === 'o') {
        g.ellipse(X(0), Y(-0.004), mw * 0.36 * PX, 0.02 * PX, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      } else if (mouth === 'cat') { // ω
        g.moveTo(X(-mw * 0.85), Y(0.008)); g.quadraticCurveTo(X(-mw * 0.42), Y(-0.03), X(0), Y(0.004)); g.quadraticCurveTo(X(mw * 0.42), Y(-0.03), X(mw * 0.85), Y(0.008)); g.stroke();
      } else if (mouth === 'wavy') { // ～
        g.moveTo(X(-mw * 0.8), Y(-0.004)); g.bezierCurveTo(X(-mw * 0.4), Y(0.016), X(-mw * 0.1), Y(-0.022), X(mw * 0.25), Y(-0.002)); g.quadraticCurveTo(X(mw * 0.55), Y(0.012), X(mw * 0.8), Y(-0.006)); g.stroke();
      } else if (mouth === 'frown') { // ︵
        g.moveTo(X(-mw * 0.7), Y(-0.02)); g.quadraticCurveTo(X(0), Y(0.012), X(mw * 0.7), Y(-0.02)); g.stroke();
      } else { // pout：撅嘴
        g.moveTo(X(-mw * 0.45), Y(-0.014)); g.quadraticCurveTo(X(0), Y(0.016), X(mw * 0.45), Y(-0.014)); g.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }
}

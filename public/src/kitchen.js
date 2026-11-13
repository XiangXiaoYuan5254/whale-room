// 吃饭的家当：靠右墙贴着地面的一块小木托盘、上面的电饭煲、一只碗和一把勺子。
// 托盘是按她的个头摆的。她只有 65 厘米高，头大手短：手只够得到下巴以下、胸口跟前的东西。
// 所以电饭煲得放得很低——锅沿在她胸口以下，她站在锅前低头就能看见饭，勺子才伸得进去。
// 碗和勺子是真实放在那儿的东西：不吃饭时在矮几上，盛饭、吃饭时在她手里，吃到一半被叫走就先搁在脚边的地上。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { whale } from './room.js';
import { HOLD } from './animator.js';
import { Carry } from './body.js';
import { SCALE } from './character.js';
import { smooth } from './util.js';

const TABLE = [1.685, 2.07, -0.40, -0.06]; // 托盘：[x0, x1, z0, z1]（电饭煲的边在 z -0.385，刚好放下）
const TOP = 0.035; // 托盘面的高度
/**
 * 托盘占的地方（寻路要绕开）：[x0, x1, z0, z1]。z0 比托盘本身往里收了 4 厘米：托盘只有 3.5 厘米高，
 * 而椅子和托盘之间是去书桌右边、桌子底下的唯一通道，不收就窄得走不过去。
 */
export const RICE_TABLE = [1.685, 2.08, -0.36, -0.04];
/** 靠墙的米袋占的地方。它单独算，并且紧贴着墙：椅子和它之间要留出一条去书桌右边的路。 */
export const RICE_BAG = [1.86, 2.06, -0.62, -0.46];
/** 她盛饭时的位置：先走到 RICE_SPOT（寻路允许的最近处），再直接迈一小步到 RICE_NEAR——电饭煲正对面，锅沿就在脸底下。 */
export const RICE_SPOT = { surface: 'floor', x: 1.53, z: -0.265, yaw: Math.PI / 2 };
export const RICE_NEAR = { x: 1.62, z: -0.265 };
/** 她坐下吃饭的位置（地毯右边）。 */
export const EAT_SPOT = { surface: 'floor', x: 0.6, z: 0.3 };
/**
 * 洗碗的地方：靠右墙、电饭煲和矮书架之间，一只搪瓷盆架在小木架上，旁边立着一个小水龙头。
 * 木架和电饭煲差不多高（盆沿约 19 厘米，锅沿约 18.6 厘米）：她站在盆前微微弯腰就够得着，
 * 不用跪下去把头埋进盆里。
 */
const SINK = { x: 1.895, z: 0.115, top: 0.14, rim: 0.192 }; // 盆的中心；top 是木架面的高度，rim 是盆沿的高度
/** 洗碗盆占的地方（寻路要绕开）。 */
export const SINK_BOX = [1.76, 2.08, -0.05, 0.28];
/** 她洗碗时的位置：先走到 SINK_SPOT，再迈一小步到 SINK_NEAR，站在盆前。 */
export const SINK_SPOT = { surface: 'floor', x: 1.6, z: 0.115, yaw: Math.PI / 2 };
export const SINK_NEAR = { x: 1.69, z: 0.115 };
const COOKER = { x: 1.875, z: -0.265 }, BOWL_HOME = { x: 1.745, z: -0.15 }; // 碗放在电饭煲右前方，她转个身就够得着

const std = (color, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

export function buildKitchen(scene) {
  const g = new THREE.Group(); g.name = 'kitchen'; scene.add(g);
  const [tx0, tx1, tz0, tz1] = TABLE, tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2;

  // ---------- 木托盘（四只矮脚） ----------
  const wood = std(0xc79a6a, 0.6), woodDark = std(0x8a5a3a, 0.65);
  const top = new THREE.Mesh(new RoundedBoxGeometry(tx1 - tx0, 0.016, tz1 - tz0, 3, 0.006), wood);
  top.position.set(tcx, TOP - 0.008, tcz); top.castShadow = true; top.receiveShadow = true; top.name = 'ricecooker'; g.add(top);
  for (const [x, z] of [[tx0 + 0.035, tz0 + 0.035], [tx1 - 0.035, tz0 + 0.035], [tx0 + 0.035, tz1 - 0.035], [tx1 - 0.035, tz1 - 0.035]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, TOP - 0.014, 12), woodDark); leg.position.set(x, (TOP - 0.014) / 2, z); g.add(leg);
  }
  // 托盘旁边靠墙放的米袋（在电饭煲和书桌之间的角落里）
  const BAG = { x: 1.96, z: -0.54 };
  const bag = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.15, 0.16, 5, 0.05), std(0xf1ead9, 0.95)); bag.position.set(BAG.x, 0.075, BAG.z); bag.castShadow = true; bag.receiveShadow = true; g.add(bag);
  const label = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const x = c.getContext('2d'); x.fillStyle = '#d9483b'; x.beginPath(); x.roundRect(8, 8, 112, 80, 14); x.fill();
    x.fillStyle = '#fff'; x.font = '700 58px "PingFang SC", "Microsoft YaHei", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('米', 64, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.075), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9 }));
    m.rotation.y = -Math.PI / 2; m.position.set(BAG.x - 0.101, 0.08, BAG.z);
    return m;
  })();
  g.add(label);

  // ---------- 电饭煲（正面朝房间里） ----------
  const cooker = new THREE.Group(); cooker.position.set(COOKER.x, TOP, COOKER.z); cooker.rotation.y = -Math.PI / 2; g.add(cooker);
  const white = std(0xf7f8fb, 0.35), blue = std(0x8fb6f5, 0.4), dark = std(0x2a2f45, 0.4), steel = std(0xb9bfca, 0.3, { metalness: 0.6 });
  const body = new THREE.Mesh(lathe([[0.001, 0], [0.098, 0], [0.112, 0.012], [0.119, 0.06], [0.119, 0.132], [0.113, 0.15], [0.001, 0.15]]), white);
  body.castShadow = true; body.name = 'ricecooker'; cooker.add(body);
  const band = new THREE.Mesh(lathe([[0.1135, 0.014], [0.1203, 0.058], [0.1203, 0.078], [0.1203, 0.078]]), blue); cooker.add(band);
  // 内胆和里面的饭（开盖才看得见）
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.104, 0.012, 36, 1, true), steel); pot.position.y = 0.151; cooker.add(pot);
  const riceIn = new THREE.Mesh(new THREE.SphereGeometry(0.1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xfffef8, 1)); riceIn.scale.y = 0.16; riceIn.position.y = 0.136; cooker.add(riceIn);
  // 面板：小屏幕 + 指示灯 + 按钮
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.082, 0.052, 0.014, 3, 0.006), dark); panel.position.set(0, 0.088, 0.114); cooker.add(panel);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.016), screenMat); lcd.position.set(-0.014, 0.094, 0.1215); cooker.add(lcd);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff8a3c, toneMapped: false });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), ledMat); led.position.set(0.02, 0.098, 0.1215); cooker.add(led);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.005, 18).rotateX(Math.PI / 2), white); btn.position.set(0.016, 0.079, 0.122); cooker.add(btn);
  // 盖子：后面是合页，往后掀开
  const hinge = new THREE.Group(); hinge.position.set(0, 0.15, -0.108); cooker.add(hinge);
  const lid = new THREE.Mesh(lathe([[0.001, 0], [0.116, 0], [0.114, 0.014], [0.1, 0.034], [0.066, 0.05], [0.03, 0.057], [0.001, 0.058]]), white);
  lid.position.set(0, 0, 0.108); lid.castShadow = true; lid.name = 'ricecooker'; hinge.add(lid);
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.012, 0.022, 3, 0.005), blue); handle.position.set(0, 0.038, 0.2); handle.rotation.x = 0.55; hinge.add(handle);
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.01, 16), dark); vent.position.set(0, 0.055, 0.07); hinge.add(vent);
  const sticker = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const x = c.getContext('2d'); x.translate(62, 54); x.scale(1.1, 1.1); whale(x, '#2f55d0', '#cfe0ff');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.045), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2 + 0.2; m.position.set(0, 0.054, 0.125);
    return m;
  })();
  hinge.add(sticker);
  // 热气：开盖时从锅里冒，煮饭时从排气孔冒
  const steam = Array.from({ length: 6 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.userData.ph = i / 6; cooker.add(m); return m;
  });

  // ---------- 洗碗盆、水龙头、海绵 ----------
  const sinkG = new THREE.Group(); sinkG.name = 'sink'; g.add(sinkG);
  const stool = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.014, 0.3, 3, 0.005), wood); stool.position.set(SINK.x + 0.02, SINK.top - 0.007, SINK.z); stool.castShadow = true; stool.receiveShadow = true; stool.name = 'sink'; sinkG.add(stool);
  for (const [dx, dz] of [[-0.09, -0.12], [0.11, -0.12], [-0.09, 0.12], [0.11, 0.12]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, SINK.top - 0.014, 10), woodDark); leg.position.set(SINK.x + 0.02 + dx, (SINK.top - 0.014) / 2, SINK.z + dz); leg.castShadow = true; sinkG.add(leg);
  }
  // 木架下面一层搁板（四条腿撑着一块板太像高脚凳；有了这层才像个洗碗架）
  const shelf = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.012, 0.27, 3, 0.004), wood); shelf.position.set(SINK.x + 0.02, 0.035, SINK.z); shelf.castShadow = true; shelf.receiveShadow = true; shelf.name = 'sink'; sinkG.add(shelf);
  const enamel = new THREE.MeshStandardMaterial({ color: 0xfafcff, roughness: 0.25, side: THREE.DoubleSide });
  const basin = new THREE.Mesh(lathe([[0.001, 0.004], [0.062, 0.004], [0.07, 0.008], [0.092, SINK.rim - SINK.top - 0.004], [0.097, SINK.rim - SINK.top], [0.094, SINK.rim - SINK.top], [0.088, SINK.rim - SINK.top - 0.005], [0.066, 0.011], [0.001, 0.009]], 40), enamel);
  basin.position.set(SINK.x, SINK.top, SINK.z); basin.castShadow = true; basin.name = 'sink'; sinkG.add(basin);
  const basinRim = new THREE.Mesh(new THREE.TorusGeometry(0.0955, 0.003, 8, 48).rotateX(Math.PI / 2), std(0x8fb6f5, 0.4)); basinRim.position.set(SINK.x, SINK.rim, SINK.z); sinkG.add(basinRim);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, roughness: 0.08, transparent: true, opacity: 0 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.086, 40).rotateX(-Math.PI / 2), waterMat); water.position.set(SINK.x, SINK.top + 0.012, SINK.z); sinkG.add(water);
  // 水龙头：从木架靠她这一侧的角上立起来，弯向盆里（比她站着时的下巴低，不会碰到脸）
  const TAP = { x: SINK.x - 0.085, z: SINK.z + 0.115, h: SINK.top + 0.105 };
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, TAP.h - SINK.top, 12), steel); pipe.position.set(TAP.x, (TAP.h + SINK.top) / 2, TAP.z); pipe.castShadow = true; sinkG.add(pipe);
  const spoutEnd = new THREE.Vector3(SINK.x - 0.03, TAP.h - 0.012, SINK.z + 0.045);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 10).rotateX(Math.PI / 2), steel);
  { const a = new THREE.Vector3(TAP.x, TAP.h, TAP.z), d = spoutEnd.clone().sub(a); arm.scale.z = d.length(); arm.position.copy(a).addScaledVector(d, 0.5); arm.lookAt(spoutEnd); }
  sinkG.add(arm);
  const tapKnob = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.008, 0.012, 2, 0.003), blue); tapKnob.position.set(TAP.x, TAP.h + 0.012, TAP.z); sinkG.add(tapKnob);
  const streamMat = new THREE.MeshBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.75, depthWrite: false });
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 1, 8), streamMat); stream.visible = false; sinkG.add(stream);
  const suds = Array.from({ length: 7 }, (_, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.007 + (i % 3) * 0.003, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.userData.ph = i / 7; sinkG.add(m); return m; });
  // 洗洁精和海绵（放在木架靠她的另一个角上）
  const soap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.05, 14), std(0x7fd6a8, 0.35)); soap.position.set(SINK.x + 0.115, SINK.top + 0.025, SINK.z - 0.12); soap.castShadow = true; sinkG.add(soap);
  const soapCap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.014, 10), white); soapCap.position.set(SINK.x + 0.115, SINK.top + 0.057, SINK.z - 0.12); sinkG.add(soapCap);
  const sponge = new THREE.Mesh(new RoundedBoxGeometry(0.034, 0.014, 0.024, 2, 0.004), std(0xffd257, 0.9)); sponge.castShadow = true; scene.add(sponge);
  const spongeHome = new THREE.Vector3(SINK.x - 0.085, SINK.top + 0.008, SINK.z - 0.115);
  sponge.position.copy(spongeHome);

  // ---------- 碗和勺子 ----------
  // 跟她一样用卡通着色（暗部不压黑），不然背光时白碗会发灰
  const ramp = new THREE.DataTexture(new Uint8Array([200, 228, 255, 255]), 4, 1, THREE.RedFormat); ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, emissive: color, emissiveIntensity: 0.12 });
  const bowl = new THREE.Group(); bowl.name = 'bowl'; scene.add(bowl); // 原点在碗底中心
  const bowlBody = new THREE.Mesh(lathe([[0.001, 0], [0.024, 0], [0.029, 0.005], [0.044, 0.03], [0.048, 0.043], [0.045, 0.043], [0.04, 0.03], [0.022, 0.009], [0.001, 0.007]], 32), toon(0xfdfdff));
  bowlBody.castShadow = true; bowlBody.name = 'ricecooker'; bowl.add(bowlBody);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0465, 0.0022, 8, 40).rotateX(Math.PI / 2), toon(0x8fb6f5)); rim.position.y = 0.043; bowl.add(rim);
  const riceGeo = new THREE.IcosahedronGeometry(0.043, 3), rp = riceGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) { // 饭粒堆出来的坑坑洼洼
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i), k = 1 + (Math.sin(x * 310) * Math.sin(z * 290 + 1.3) * Math.sin(y * 270 + 0.7)) * 0.07;
    rp.setXYZ(i, x * k, y * k, z * k);
  }
  riceGeo.computeVertexNormals();
  // 米饭：一粒一粒的米（不然白饭盛在白碗里，看着像空碗）
  const riceTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#ece6d6'; x.fillRect(0, 0, 256, 256);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 520; i++) {
      x.save(); x.translate(rnd() * 256, rnd() * 256); x.rotate(rnd() * Math.PI);
      x.fillStyle = rnd() < 0.5 ? '#ffffff' : '#fbf8f0'; x.strokeStyle = 'rgba(150,135,110,0.55)'; x.lineWidth = 1.2;
      x.beginPath(); x.ellipse(0, 0, 7, 3.4, 0, 0, Math.PI * 2); x.fill(); x.stroke();
      x.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
    return t;
  })();
  const riceMat = new THREE.MeshToonMaterial({ color: 0xffffff, map: riceTex, gradientMap: ramp, emissive: 0xfffef6, emissiveIntensity: 0.1 });
  riceIn.material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: riceTex, roughness: 1 }); // 锅里的饭也是一粒一粒的
  const rice = new THREE.Mesh(riceGeo, riceMat); rice.position.y = 0.034; rice.scale.y = 0.72; rice.visible = false; bowl.add(rice);
  const puffs = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.userData.ph = i / 2; bowl.add(m); return m; });
  // 勺子：原点在勺柄末端（手握的地方），勺头朝 +Z
  const SPOON_LEN = HOLD.spoon.len * SCALE;
  const spoon = new THREE.Group(); spoon.name = 'spoon'; scene.add(spoon);
  const spoonMat = toon(0x8fb6f5);
  const stem = new THREE.Mesh(new RoundedBoxGeometry(0.0075, 0.0034, SPOON_LEN - 0.016, 2, 0.0015), spoonMat); stem.position.z = (SPOON_LEN - 0.016) / 2; stem.castShadow = true; spoon.add(stem);
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshToonMaterial({ color: 0x8fb6f5, gradientMap: ramp, emissive: 0x8fb6f5, emissiveIntensity: 0.12, side: THREE.DoubleSide }));
  scoop.scale.set(0.0105, 0.0055, 0.014); scoop.position.set(0, 0.0028, SPOON_LEN - 0.012); spoon.add(scoop);
  const lump = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), riceMat); lump.scale.set(0.0095, 0.0065, 0.0125); lump.position.set(0, 0.0045, SPOON_LEN - 0.012); lump.visible = false; spoon.add(lump);

  // 碗放在哪、勺子放在哪
  const UP = new THREE.Vector3(0, 1, 0);
  const bowlCarry = new Carry(bowl), spoonCarry = new Carry(spoon);
  const tablePos = new THREE.Vector3(BOWL_HOME.x, TOP, BOWL_HOME.z), floorPos = new THREE.Vector3();
  const bowlOff = new THREE.Vector3(HOLD.bowl.at[0] - HOLD.bowl.L[0], HOLD.bowl.at[1] - HOLD.bowl.L[1], HOLD.bowl.at[2] - HOLD.bowl.L[2]);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();
  const potPoint = new THREE.Vector3(COOKER.x - 0.076, TOP + 0.146, COOKER.z + 0.022); // 勺子伸进锅里舀饭的那一点（靠她这一侧的锅沿里面）
  const aim = (from, to, quat) => quat.setFromRotationMatrix(_m.lookAt(to, from, UP)); // 让 +Z 从 from 指向 to
  /** 勺子搁在碗里：勺头在碗底，勺柄斜靠着碗沿伸出来。 */
  const spoonInBowl = (pos, quat) => {
    bowl.updateMatrixWorld();
    pos.set(0.03, 0.058, 0.012).applyMatrix4(bowl.matrixWorld);
    aim(pos, _a.set(-0.012, 0.013, -0.004).applyMatrix4(bowl.matrixWorld), quat);
  };
  bowl.position.copy(tablePos);
  bowlCarry.to((pos, quat) => { pos.copy(tablePos); quat.identity(); });
  spoonCarry.to(spoonInBowl);
  const spongeCarry = new Carry(sponge);
  spongeCarry.to((pos, quat) => { pos.copy(spongeHome); quat.identity(); });
  const use = { body: null, bite: 0, pot: 0 }; // 勺子在手里时：勺头指向哪（碗里 → 嘴边 / 锅里）

  const st = { open: 0, openV: 0, openTarget: 0, press: 0, cooking: false, riceLeft: 0, where: 'table', spoon: 'bowl', tap: false, flow: 0, level: 0, suds: 0, sudsOn: false, dirty: false };
  const setRice = (k) => { st.riceLeft = k; rice.visible = k > 0.03; rice.scale.set(0.82 + 0.18 * k, 0.06 + 0.56 * k, 0.82 + 0.18 * k); rice.position.y = 0.024 + 0.01 * k; };
  return {
    group: g,
    cooker: {
      /** 盖子是不是开着（或正在打开）。 */
      get open() { return st.openTarget > 0; },
      /** 掀开 / 合上盖子。 */
      setOpen(v) { st.openTarget = v ? 1 : 0; },
      /** 按一下开盖按钮（按钮陷下去再弹回来）。 */
      press() { st.press = 1; },
      /** 开盖按钮的世界坐标（她伸手去按的地方）。 */
      buttonPoint(out = new THREE.Vector3()) { return out.set(COOKER.x - 0.124, TOP + 0.079, COOKER.z + 0.016); },
      /** 锅里舀饭的那一点（世界坐标）。 */
      potPoint,
      /** 正在煮（快到饭点还没吃）：指示灯变红、排气孔冒气。 */
      setCooking(v) { st.cooking = Boolean(v); },
    },
    sink: {
      /** 盆里放碗的那一点（盆底中心往上一点，世界坐标）。 */
      basin: new THREE.Vector3(SINK.x, SINK.top + 0.02, SINK.z),
      /** 水龙头的开关（她伸手去拧的地方）。 */
      knob: new THREE.Vector3(TAP.x, TAP.h + 0.012, TAP.z),
      /** 水龙头现在是不是开着。 */
      get running() { return st.tap; },
      /** 开 / 关水龙头。开着时水流进盆里，关了以后盆里的水慢慢漏掉。 */
      setTap(on) { st.tap = Boolean(on); },
      /** 起不起泡泡（正在用海绵擦碗时）。 */
      setSuds(on) { st.sudsOn = Boolean(on); },
      /** 右手拿起海绵 / 放回木架上。 */
      useSponge(body, on) {
        if (on) spongeCarry.to((pos, quat) => { body.hand('R', pos); pos.y -= 0.012; quat.setFromAxisAngle(UP, body.yaw); }, 0.25, 0.02);
        else spongeCarry.to((pos, quat) => { pos.copy(spongeHome); quat.identity(); }, 0.28, 0.02);
      },
    },
    bowl: {
      group: bowl,
      /** 碗用过还没洗。 */
      get dirty() { return st.dirty; },
      set dirty(v) { st.dirty = Boolean(v); },
      /** 碗现在在哪：table 托盘上 | hand 她手里 | floor 搁在地上。 */
      get where() { return st.where; },
      /** 碗里还剩多少饭（0~1）。 */
      get rice() { return st.riceLeft; },
      setRice,
      /** 她伸手去端碗时，两只手该去的地方（碗的两侧，世界坐标）。 */
      gripPoints(yaw, outL = new THREE.Vector3(), outR = new THREE.Vector3()) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        outL.set(bowl.position.x + c * 0.046, bowl.position.y + 0.024, bowl.position.z - s * 0.046);
        outR.set(bowl.position.x - c * 0.046, bowl.position.y + 0.024, bowl.position.z + s * 0.046);
        return [outL, outR];
      },
      /** 端到手里（之后一直跟着她的左手，碗口保持水平）。 */
      take(body) {
        st.where = 'hand'; use.body = body;
        bowlCarry.to((pos, quat) => { body.inLeftHand(bowlOff, pos); quat.setFromAxisAngle(UP, body.yaw); }, 0.28, 0.02);
      },
      /** 放回托盘上。 */
      toTable() { st.where = 'table'; bowlCarry.to((pos, quat) => { pos.copy(tablePos); quat.identity(); }, 0.32, 0.03); },
      /** 搁在地上的某一点。 */
      toFloor(x, z) { st.where = 'floor'; floorPos.set(x, 0.001, z); const q = bowl.quaternion.clone(); bowlCarry.to((pos, quat) => { pos.copy(floorPos); quat.copy(q); }, 0.32, 0.03); },
      get moving() { return bowlCarry.moving; },
    },
    spoon: {
      group: spoon,
      /** 勺子在哪：bowl 搁在碗里 | hand 她右手里。 */
      get where() { return st.spoon; },
      /** 右手拿起勺子 / 把勺子搁回碗里。 */
      use(body, on) {
        if ((st.spoon === 'hand') === on) return;
        st.spoon = on ? 'hand' : 'bowl'; use.body = body;
        if (!on) { lump.visible = false; spoonCarry.to(spoonInBowl, 0.22, 0.012); return; }
        spoonCarry.to((pos, quat) => {
          body.hand('R', pos);
          // 勺头指向：碗里的饭 →（bite）嘴边；舀饭时（pot）指向锅里
          bowl.updateMatrixWorld();
          _a.set(0, 0.03 + 0.012 * st.riceLeft, 0).applyMatrix4(bowl.matrixWorld);
          _a.lerp(body.mouthWorld(_b), smooth(use.bite)).lerp(potPoint, smooth(use.pot));
          aim(pos, _a, quat);
        }, 0.22, 0.012);
      },
      /** 勺子上有没有一口饭。 */
      set loaded(v) { lump.visible = Boolean(v) && st.spoon === 'hand'; },
      get loaded() { return lump.visible; },
      /** 勺头的世界坐标。 */
      tip(out = new THREE.Vector3()) { spoon.updateMatrixWorld(); return out.set(0, 0, SPOON_LEN - 0.012).applyMatrix4(spoon.matrixWorld); },
    },
    /**
     * 每帧调用（在她这一帧的姿势定下来之后）。
     * @param now 模拟时间（秒）
     * @param bite 勺子从碗里送到嘴边的程度（0~1）
     * @param pot 勺子伸向锅里的程度（0~1）
     */
    update(dt, now, bite = 0, pot = 0) {
      use.bite = bite; use.pot = pot;
      bowlCarry.update(dt); spoonCarry.update(dt); spongeCarry.update(dt);
      // 水龙头的水流、盆里的水位、泡泡
      st.flow += ((st.tap ? 1 : 0) - st.flow) * (1 - Math.exp(-dt * 10));
      st.level = Math.max(0, Math.min(1, st.level + (st.tap ? dt / 2.5 : -dt / 5)));
      st.suds += ((st.sudsOn ? 1 : 0) - st.suds) * (1 - Math.exp(-dt * 3));
      const wy = SINK.top + 0.012 + st.level * 0.045;
      water.position.y = wy; waterMat.opacity = Math.min(0.62, st.level * 2);
      water.scale.setScalar(0.76 + 0.24 * st.level);
      stream.visible = st.flow > 0.03;
      if (stream.visible) { const h = Math.max(0.01, spoutEnd.y - wy); stream.scale.set(st.flow, h, st.flow); stream.position.set(spoutEnd.x, wy + h / 2, spoutEnd.z); }
      for (const m of suds) {
        const p = (now * 0.3 + m.userData.ph) % 1, a = m.userData.ph * 40;
        m.position.set(SINK.x + Math.cos(a) * 0.05 * (0.4 + p * 0.6), wy + 0.004 + p * 0.03 * st.suds, SINK.z + Math.sin(a) * 0.05 * (0.4 + p * 0.6));
        m.material.opacity = st.suds * Math.sin(p * Math.PI) * 0.9;
      }
      // 盖子：按钮一按，弹簧把它弹开（有点回弹）；合上时慢一些
      if (st.openTarget > st.open + 1e-3 || st.openV > 1e-3) { st.openV += ((st.openTarget - st.open) * 90 - st.openV * 11) * dt; st.open += st.openV * dt; }
      else { st.openV = 0; st.open += (st.openTarget - st.open) * (1 - Math.exp(-dt * 6)); }
      hinge.rotation.x = -1.2 * Math.max(0, st.open);
      st.press = Math.max(0, st.press - dt * 4); btn.position.z = 0.122 - 0.004 * Math.sin(Math.min(1, st.press) * Math.PI);
      ledMat.color.setHex(st.cooking ? 0xff3b30 : 0xff8a3c);
      screenMat.color.setHex(st.cooking ? 0xff7a45 : 0xffb347);
      const amount = Math.max(Math.min(1, st.open), st.cooking ? 0.45 : 0);
      for (const m of steam) {
        const p = (now * 0.35 + m.userData.ph) % 1, fromPot = st.open > 0.3;
        const r = fromPot ? 0.05 : 0.004;
        m.position.set(Math.sin(m.userData.ph * 17 + p * 4) * r, (fromPot ? 0.16 : 0.215) + p * 0.2, (fromPot ? 0 : -0.038) + Math.cos(m.userData.ph * 11 + p * 3) * r);
        m.scale.setScalar(0.6 + p * 1.8); m.material.opacity = Math.sin(p * Math.PI) * 0.34 * amount;
      }
      for (const m of puffs) { // 碗里的饭冒的热气
        const p = (now * 0.4 + m.userData.ph) % 1;
        m.position.set(Math.sin(p * 6 + m.userData.ph * 5) * 0.012, 0.07 + p * 0.07, 0);
        m.scale.setScalar(0.6 + p * 1.2); m.material.opacity = Math.sin(p * Math.PI) * 0.26 * st.riceLeft;
      }
    },
  };
}

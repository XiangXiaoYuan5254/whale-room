// 她的心情。只读，不写。先找新的一整套（dsh-jingjing）记的 ~/.dsh/jingjing/state/mood.json，
// 没有再找 DSH 插件「鱼的心情」（dsh-feiyu-mood）的 ~/.dsh/feiyu-mood/state.json。
// 插件只在心情变的时候落盘，「慢慢回稳」这里按各自的回稳速度算出「现在」的样子（只读它们的存档，没用它们的代码）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 两边记的情绪种类和散掉的快慢不一样：fast 里的半衰 45 分钟，别的半衰 slowMin 分钟。
const FEIYU = {
  dims: { happy: '开心', calm: '踏实', sweet: '甜蜜', heartache: '心疼', worry: '担心', sad: '难过', jealous: '吃醋', angry: '生气' },
  fast: new Set(['angry']), slowMin: 90,
};
const JINGJING = {
  dims: { happy: '开心', calm: '踏实', sweet: '甜蜜', miss: '想念', shy: '害羞', worry: '担心', sad: '难过', jealous: '吃醋', angry: '生气', bored: '无聊', heartache: '心疼' },
  fast: new Set(['angry', 'shy']), slowMin: 120,
};
export const DIMS = { ...FEIYU.dims, ...JINGJING.dims };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 顶上小牌子上的字（和 dsh-jingjing 用的一样）
export function moodLabel(v) {
  return v >= 82 ? '特别开心' : v >= 66 ? '挺开心' : v >= 50 ? '还行' : v >= 35 ? '有点低落' : v >= 20 ? '难过' : '很难过';
}
export function moodEmoji(v) {
  return v >= 82 ? '😊' : v >= 66 ? '🙂' : v >= 50 ? '😌' : v >= 35 ? '😕' : v >= 20 ? '🥺' : '😢';
}

/** 心情向基线回落（半衰 halfHours 小时），各种情绪向 0 衰减。不改原对象。kind：FEIYU 或 JINGJING。 */
export function decayed(s, base, halfHours, now, kind = FEIYU) {
  const mood = clamp(Number(s.mood ?? 70), 0, 100);
  const since = Number(s.lastDecayAt ?? s.updatedAt) || now;
  const ageMin = Math.max(0, now - since) / 60000;
  const km = 1 - Math.exp(-(Math.LN2 * ageMin) / (halfHours * 60));
  const dims = {};
  for (const k of Object.keys(kind.dims)) {
    const kk = 1 - Math.exp(-(Math.LN2 * ageMin) / (kind.fast.has(k) ? 45 : kind.slowMin));
    dims[k] = Math.max(0, (Number(s.dims?.[k]) || 0) * (1 - kk));
  }
  return { mood: mood + (base - mood) * km, dims };
}

/**
 * 现在的心情。插件没装、还没判过心情、文件坏了都返回 null。
 * @param cfg config.json 的 mood 段：{ dir（默认 ~/.dsh/feiyu-mood）, slot（用哪一份心情，默认插件配置里的第一份） }
 * @returns { value, label, emoji, dims, top: [{ key, label, value }], reason, confidence, updatedAt, kind }
 */
export function readMood(cfg = {}, now = Date.now()) {
  if (cfg.source !== 'feiyu') {
    const jj = readJingjing(cfg, now);
    if (jj) return jj;
  }
  const dir = cfg.dir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'feiyu-mood');
  let st, mc = {};
  try { st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { return null; }
  try { mc = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { /* 用默认 */ }
  // 新版是 { moods: { 份: 心情 } }，很老的版本整个文件就是一份心情
  const moods = st && typeof st.moods === 'object' && st.moods ? st.moods : st && 'mood' in st ? { only: st } : {};
  const first = Array.isArray(mc.slots) ? mc.slots.find((p) => p && p.id && moods[p.id])?.id : null;
  const key = [cfg.slot, first, 'jingjing', st?.lastActive].find((k) => k && moods[k]) ?? Object.keys(moods)[0];
  const s = key ? moods[key] : null;
  if (!s || typeof s !== 'object') return null;
  const base = clamp(Number(mc.moodBase) || 70, 30, 100);
  const half = clamp(Number(mc.decayHalfHours) || 12, 1, 168);
  const d = decayed(s, base, half, now);
  const dims = Object.fromEntries(Object.entries(d.dims).map(([k, v]) => [k, Math.round(v)]));
  const top = Object.entries(dims).filter(([, v]) => v >= 15).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => ({ key: k, label: DIMS[k], value: v }));
  return {
    value: Math.round(d.mood), label: moodLabel(d.mood), emoji: moodEmoji(d.mood), dims, top,
    reason: String(s.lastReason ?? '').slice(0, 200), confidence: Number(s.lastConfidence) || 0,
    updatedAt: Number(s.updatedAt) || 0, kind: String(s.kind ?? ''),
  };
}

/** dsh-jingjing 记的心情（格式和「鱼的心情」的一份心情一样，多了 base、halfHours）。 */
function readJingjing(cfg, now) {
  const file = cfg.jingjingFile || path.join(process.env.JINGJING_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'jingjing'), 'state', 'mood.json');
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!s || typeof s !== 'object' || !('mood' in s)) return null;
  const base = clamp(Number(s.base) || 65, 20, 100);
  const half = clamp(Number(s.halfHours) || 8, 0.5, 168);
  const d = decayed(s, base, half, now, JINGJING);
  const dims = Object.fromEntries(Object.entries(d.dims).map(([k, v]) => [k, Math.round(v)]));
  const top = Object.entries(dims).filter(([, v]) => v >= 15).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => ({ key: k, label: DIMS[k], value: v }));
  return {
    value: Math.round(d.mood), label: moodLabel(d.mood), emoji: moodEmoji(d.mood), dims, top,
    reason: String(s.lastReason ?? '').slice(0, 200), confidence: Number(s.lastConfidence) || 0,
    updatedAt: Number(s.updatedAt) || 0, kind: 'jingjing',
  };
}

/**
 * 她的作息（dsh-jingjing 每分钟记一次的 ~/.dsh/jingjing/state/life.json）。
 * 有的话，房间按它睡觉、起床，不用自己那套固定的深夜时间；5 分钟没更新（插件没在跑）就当没有。
 * @returns { asleep, sleepAt, wakeAt, at } 或 null
 */
export function readLife(cfg = {}, now = Date.now()) {
  const file = cfg.jingjingLifeFile || path.join(process.env.JINGJING_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'jingjing'), 'state', 'life.json');
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!s || !Number.isFinite(s.checkedAt) || now - s.checkedAt > 5 * 60000) return null;
  return { asleep: s.phase === 'asleep', sleepAt: Number(s.sleepAt) || 0, wakeAt: Number(s.wakeAt) || 0, at: s.checkedAt };
}

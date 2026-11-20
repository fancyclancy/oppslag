// Spaced repetition (SM-2 family, Anki-style buttons: Again / Hard / Good / Easy)
import { S, save } from './store.js';

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const LEARN_STEPS = [1, 10];   // minutes

export function cardKey(deckId, id, dir) { return `${deckId}:${id}:${dir}`; }

export function state(key) { return S().srs[key]; }

export function isDue(key, now = Date.now()) {
  const c = S().srs[key];
  return c && c.due <= now;
}

export function grade(key, g /* 0 again,1 hard,2 good,3 easy */) {
  const now = Date.now();
  let c = S().srs[key];
  const isNew = !c;
  if (!c) c = { ease: 2.5, ivl: 0, reps: 0, lapses: 0, step: 0, due: now, learning: true };
  if (c.learning) {
    if (g === 0) { c.step = 0; c.due = now + LEARN_STEPS[0] * 60000; }
    else if (g === 1) { c.due = now + LEARN_STEPS[Math.min(c.step, LEARN_STEPS.length - 1)] * 60000 * 1.5; }
    else if (g === 2) {
      c.step++;
      if (c.step >= LEARN_STEPS.length) { c.learning = false; c.ivl = 1; c.due = now + DAY; }
      else c.due = now + LEARN_STEPS[c.step] * 60000;
    } else { c.learning = false; c.ivl = 4; c.due = now + 4 * DAY; }
  } else {
    if (g === 0) {
      c.lapses++; c.ease = Math.max(1.3, c.ease - 0.2); c.learning = true; c.step = 0;
      c.ivl = Math.max(1, Math.round(c.ivl * 0.3)); c.due = now + LEARN_STEPS[0] * 60000;
    } else {
      const late = Math.max(0, (now - c.due) / DAY);
      if (g === 1) { c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.15); }
      if (g === 2) c.ivl = Math.max(c.ivl + 1, Math.round((c.ivl + late / 2) * c.ease));
      if (g === 3) { c.ivl = Math.max(c.ivl + 1, Math.round((c.ivl + late) * c.ease * 1.3)); c.ease += 0.15; }
      c.ivl = Math.min(c.ivl, 3650);
      c.due = now + c.ivl * DAY;
    }
  }
  c.reps++; c.last = now;
  S().srs[key] = c;
  const d = S().daily[today()] ||= { new: 0, reviewed: 0 };
  d.reviewed++; if (isNew) d.new++;
  save();
  return c;
}

export function preview(key, g) {
  // interval label for a button without mutating
  const saved = S().srs[key] ? structuredClone(S().srs[key]) : undefined;
  const daily = structuredClone(S().daily);
  const c = grade(key, g);
  const ms = c.due - Date.now();
  if (saved) S().srs[key] = saved; else delete S().srs[key];
  S().daily = daily; save();
  return fmt(ms);
}
function fmt(ms) {
  const m = ms / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + 'm';
  const h = m / 60; if (h < 24) return Math.round(h) + 'h';
  const d = h / 24; if (d < 30) return Math.round(d) + 'd';
  const mo = d / 30; if (mo < 12) return mo.toFixed(1).replace('.0', '') + 'mo';
  return (d / 365).toFixed(1) + 'y';
}

export function newToday() { return S().daily[today()]?.new || 0; }

// Build the study queue for a deck: due cards first, then new ones up to the daily limit
export function queue(deckId, ids, dirs, newLimit) {
  const now = Date.now();
  const due = [], fresh = [];
  for (const id of ids) for (const dir of dirs) {
    const k = cardKey(deckId, id, dir);
    const c = S().srs[k];
    if (!c) fresh.push(k); else if (c.due <= now) due.push([k, c.due]);
  }
  due.sort((a, b) => a[1] - b[1]);
  const left = Math.max(0, newLimit - newToday());
  return { due: due.map(x => x[0]), fresh: fresh.slice(0, left), totalNew: fresh.length };
}

export function stats(deckId, ids, dirs) {
  const now = Date.now();
  let n = 0, learning = 0, due = 0, mature = 0;
  for (const id of ids) for (const dir of dirs) {
    const c = S().srs[cardKey(deckId, id, dir)];
    if (!c) n++; else { if (c.due <= now) due++; if (c.learning) learning++; else if (c.ivl >= 21) mature++; }
  }
  return { new: n, due, learning, mature };
}

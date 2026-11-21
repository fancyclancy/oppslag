// Dictionary data access + search.
const DATA = 'data/';
let IDX = null;      // columnar index
let LOW = null;      // lowercased lemma strings ('|' separated variants)
let ENL = null;      // lowercased English short glosses
let FORMS = null;    // inflected form -> [ids]
let POS_OF = null;   // id -> row
let META = null;
let SENT = null;
let LISTS = null;
const shardCache = new Map();
let LEMMA_MAP = null;  // lowercased lemma -> [row indexes]
function lemmaMap() {
  if (LEMMA_MAP) return LEMMA_MAP;
  LEMMA_MAP = new Map();
  for (let i = 0; i < LOW.length; i++) for (const l of LOW[i].split('|')) {
    const a = LEMMA_MAP.get(l); if (a) a.push(i); else LEMMA_MAP.set(l, [i]);
  }
  return LEMMA_MAP;
}

export async function load(onProgress) {
  const get = async (f) => { const r = await fetch(DATA + f); if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); };
  onProgress?.('Loading dictionary…');
  const [idx, forms, meta] = await Promise.all([get('index.json'), get('forms.json'), get('meta.json')]);
  IDX = idx; FORMS = forms; META = meta;
  const n = IDX.id.length;
  LOW = new Array(n); ENL = new Array(n); POS_OF = new Map();
  for (let i = 0; i < n; i++) {
    LOW[i] = IDX.l[i].toLowerCase();
    ENL[i] = IDX.en[i].toLowerCase();
    POS_OF.set(IDX.id[i], i);
  }
  return meta;
}
export const meta = () => META;
export const ready = () => !!IDX;

export function row(id) {
  const i = POS_OF.get(id);
  if (i === undefined) return null;
  return {
    id, i, lemmas: IDX.l[i].split('|'), pos: IDX.p[i], g: IDX.g[i], hg: IDX.hg[i], rank: IDX.r[i],
    en: IDX.en[i], no: IDX.no[i], flags: IDX.f[i], ipa: IDX.ipa ? IDX.ipa[i] : '',
    wk: IDX.f[i].includes('w'), shared: IDX.f[i].includes('s'),
    tone: IDX.f[i].includes('2') ? 2 : IDX.f[i].includes('1') ? 1 : 0,
  };
}

export async function entry(id) {
  const s = id % (META?.shards || 256);
  if (!shardCache.has(s)) {
    shardCache.set(s, fetch(`${DATA}e/${s}.json`).then(r => { if (!r.ok) throw new Error('shard ' + s); return r.json(); })
      .catch(err => { shardCache.delete(s); throw err; }));
  }
  const m = await shardCache.get(s);
  const e = m[id];
  return e ? { id, ...e } : null;
}

export async function sentences() {
  if (!SENT) SENT = fetch(DATA + 'sentences.json').then(r => r.json());
  return SENT;
}
export async function lists() {
  if (!LISTS) LISTS = fetch(DATA + 'lists.json').then(r => r.json());
  return LISTS;
}

// ---------- normalisation (the Norwegian equivalent of Shirabe's romaji input)
export function variants(q) {
  q = q.toLowerCase().normalize('NFC').trim().replace(/\s+/g, ' ');
  const out = new Set([q]);
  const conv = q.replace(/aa/g, 'å').replace(/ae/g, 'æ').replace(/oe/g, 'ø').replace(/o\//g, 'ø').replace(/a\//g, 'å');
  out.add(conv);
  // only-one-substitution variants for words where e.g. "ae" is genuine (e.g. "israelsk")
  for (const [a, b] of [['aa', 'å'], ['ae', 'æ'], ['oe', 'ø']]) if (q.includes(a)) out.add(q.replace(a, b));
  return [...out].filter(Boolean);
}
export const hasNorChars = (q) => /[æøåÆØÅ]/.test(q);

function wildcardRe(q) {
  const esc = q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

const rankKey = (i) => IDX.r[i] || 1e7;

export function search(qRaw, limit = 120) {
  if (!IDX) return [];
  const q0 = qRaw.trim();
  if (!q0) return [];
  const n = IDX.id.length;
  const res = [];
  const seen = new Set();
  const push = (i, kind, extra) => {
    if (seen.has(i)) return;
    seen.add(i); res.push({ id: IDX.id[i], i, kind, ...extra });
  };

  // ---- wildcards
  if (/[*?]/.test(q0)) {
    const vs = variants(q0);
    const res_ = [];
    const resEn = [];
    const reList = vs.map(wildcardRe);
    for (let i = 0; i < n; i++) {
      const ls = LOW[i].split('|');
      if (ls.some(l => reList.some(re => re.test(l)))) res_.push(i);
      else if (!hasNorChars(q0) && ENL[i] && ENL[i].split('; ').some(s => reList[0].test(s.replace(/^(to|a|an|the) /, '')))) resEn.push(i);
    }
    res_.sort((a, b) => rankKey(a) - rankKey(b)).slice(0, limit).forEach(i => push(i, 'wild'));
    resEn.sort((a, b) => rankKey(a) - rankKey(b)).slice(0, limit).forEach(i => push(i, 'en'));
    return res;
  }

  const vs = variants(q0);
  // ---- 1. exact lemma
  const exact = [...new Set(vs.flatMap(v => lemmaMap().get(v) || []))];
  exact.sort((a, b) => rankKey(a) - rankKey(b));
  // obscure Wiktionary-only exact matches (often English loanwords like "house") go after English results
  const weakExact = exact.filter(i => IDX.f[i].includes('w') && !IDX.r[i]);
  exact.filter(i => !weakExact.includes(i)).forEach(i => push(i, 'exact'));

  // ---- 2. inflected forms -> lemma (de-inflection)
  for (const v of vs) {
    const ids = FORMS[v];
    if (ids) ids.map(id => POS_OF.get(id)).filter(i => i !== undefined).sort((a, b) => rankKey(a) - rankKey(b))
      .forEach(i => push(i, 'form', { form: v }));
  }

  // ---- 3. English -> Norwegian (strong matches)
  const latin = !hasNorChars(q0);
  const enStrong = [], enWeak = [];
  if (latin && q0.length >= 2) {
    const ql = q0.toLowerCase();
    const wordRe = new RegExp('(^|[^a-z])' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])');
    for (let i = 0; i < n; i++) {
      const s = ENL[i];
      if (!s || !s.includes(ql)) continue;
      let best = 0;
      const segs = s.split('; ');
      for (let k = 0; k < segs.length; k++) {
        const seg = segs[k].replace(/^\((.*?)\)\s*/, '');
        const core = seg.replace(/^(to|a|an|the) /, '').replace(/[.,;:!]+$/, '');
        let sc = 0;
        if (core === ql) sc = 100;
        else if (core.split(/, | — /).includes(ql)) sc = 85;
        else if (core.startsWith(ql + ' ') || core.startsWith(ql + ',') || core.startsWith(ql + ' (')) sc = 55;
        else if (wordRe.test(seg)) sc = 30;
        if (sc) best = Math.max(best, sc - k * 4);
      }
      if (best >= 70) enStrong.push([i, best]); else if (best > 0) enWeak.push([i, best]);
    }
    const sortEn = (a, b) => (b[1] - Math.log2(rankKey(b[0]))) - (a[1] - Math.log2(rankKey(a[0])));
    enStrong.sort(sortEn).slice(0, 60).forEach(([i]) => push(i, 'en'));
  }
  weakExact.forEach(i => push(i, 'exact2'));

  // ---- 4. Norwegian prefix
  const pre = [];
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const L = LOW[i];
    for (const v of vs) { if (L.startsWith(v) || (L.includes('|' + v))) { pre.push(i); break; } }
  }
  pre.sort((a, b) => rankKey(a) - rankKey(b) || LOW[a].length - LOW[b].length).slice(0, 60).forEach(i => push(i, 'prefix'));

  // ---- 5. weaker English matches
  enWeak.sort((a, b) => (b[1] - Math.log2(rankKey(b[0]))) - (a[1] - Math.log2(rankKey(a[0])))).slice(0, 60).forEach(([i]) => push(i, 'en'));

  // ---- 6. contains (compounds etc.)
  if (vs[0].length >= 3) {
    const con = [];
    for (let i = 0; i < n; i++) {
      if (seen.has(i)) continue;
      const L = LOW[i];
      if (vs.some(v => L.includes(v))) con.push(i);
    }
    con.sort((a, b) => rankKey(a) - rankKey(b) || LOW[a].length - LOW[b].length).slice(0, 60).forEach(i => push(i, 'contains'));
  }
  return res.slice(0, limit);
}

// Suggestions for the dropdown: fast prefix-only
export function suggest(q, limit = 8) {
  if (!IDX || !q.trim() || /[*?]/.test(q)) return [];
  const vs = variants(q);
  const out = [];
  for (let i = 0; i < IDX.id.length && out.length < 400; i++) {
    const L = LOW[i];
    if (vs.some(v => L.startsWith(v))) out.push(i);
  }
  out.sort((a, b) => rankKey(a) - rankKey(b));
  const seenL = new Set(); const res = [];
  for (const i of out) { const l = IDX.l[i].split('|')[0]; if (!seenL.has(l)) { seenL.add(l); res.push(l); } if (res.length >= limit) break; }
  return res;
}

// Look up a single token (used by the sentence analyser)
export function lookupToken(tok) {
  const t = tok.toLowerCase();
  const ids = (lemmaMap().get(t) || []).map(i => IDX.id[i]);
  for (const id of FORMS[t] || []) if (!ids.includes(id)) ids.push(id);
  return ids.sort((a, b) => (row(a)?.rank || 1e7) - (row(b)?.rank || 1e7));
}

// Find the entry ids for an exact lemma (for links from compound parts, synonyms…)
export function byLemma(lemma) {
  const t = lemma.toLowerCase().replace(/-$/, '');
  const out = [...new Set([...(lemmaMap().get(t) || []), ...(lemmaMap().get(t + '-') || [])])].map(i => IDX.id[i]);
  return out.sort((a, b) => (row(a)?.rank || 1e7) - (row(b)?.rank || 1e7));
}

export function randomCommon(seed) {
  // deterministic "word of the day": among top 4000 ranked entries with English
  const pool = [];
  for (let i = 0; i < IDX.id.length; i++) if (IDX.r[i] && IDX.r[i] <= 4000 && IDX.en[i] && !IDX.f[i].includes('w')) pool.push(IDX.id[i]);
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return pool[Math.abs(h) % pool.length];
}

// Compounds built on a word: the rest of the headword must itself be a dictionary word
// (optionally after a linking -s- or -e-), so "gåsehud" doesn't count as a compound of "gå".
export function compoundsOf(lemma, limit = 24) {
  const t = lemma.toLowerCase();
  if (t.length < 2) return { first: [], last: [] };
  const M = lemmaMap();
  const isWord = (w) => w.length >= 2 && M.has(w);
  const first = [], last = [];
  for (let i = 0; i < IDX.id.length; i++) {
    if (IDX.f[i].includes('w')) continue;
    for (const L of LOW[i].split('|')) {
      if (L.length < t.length + 3 || L.includes(' ')) continue;
      if (L.startsWith(t)) {
        const rest = L.slice(t.length);
        if (isWord(rest) || (/^[se]/.test(rest) && isWord(rest.slice(1)))) { first.push(i); break; }
      }
      if (L.endsWith(t)) {
        const head = L.slice(0, -t.length);
        if (isWord(head) || (/[se]$/.test(head) && isWord(head.slice(0, -1)))) { last.push(i); break; }
      }
    }
  }
  const s = (a, b) => rankKey(a) - rankKey(b);
  return { first: first.sort(s).slice(0, limit).map(i => IDX.id[i]), last: last.sort(s).slice(0, limit).map(i => IDX.id[i]) };
}
export const allIds = () => IDX.id;

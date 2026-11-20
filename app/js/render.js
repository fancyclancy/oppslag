// Shared rendering helpers
export const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Bokmålsordboka mini-markup -> HTML. [[text|id]] link, {{word}} mention, ^{x} superscript
export function rich(s) {
  return h(s)
    .replace(/\[\[(.*?)\|(-?\d+)\]\]/g, (_, t, id) => `<a class="xref" href="#/w/${id}">${t}</a>`)
    .replace(/\{\{(.*?)\}\}/g, '<em class="use">$1</em>')
    .replace(/\^\{(.*?)\}/g, '<sup>$1</sup>');
}

export const POS = {
  n: 'noun', v: 'verb', a: 'adjective', adv: 'adverb', prep: 'preposition', pron: 'pronoun', det: 'determiner',
  conj: 'conjunction', sconj: 'subordinating conjunction', intj: 'interjection', num: 'numeral', expr: 'expression',
  pfx: 'prefix', sfx: 'suffix', abbr: 'abbreviation', sym: 'symbol', name: 'proper noun', x: '',
};
export const POS_NO = {
  n: 'substantiv', v: 'verb', a: 'adjektiv', adv: 'adverb', prep: 'preposisjon', pron: 'pronomen', det: 'determinativ',
  conj: 'konjunksjon', sconj: 'subjunksjon', intj: 'interjeksjon', num: 'tallord', expr: 'uttrykk', pfx: 'prefiks',
  sfx: 'suffiks', abbr: 'forkortelse', sym: 'symbol', name: 'egennavn', x: '',
};
const GENDER = { m: 'masculine', f: 'feminine', n: 'neuter' };
const ARTICLE = { m: 'en', f: 'ei', n: 'et' };

export function genderLabel(g) {
  if (!g) return '';
  return [...g].map(c => GENDER[c]).join(' / ');
}
export function articleFor(g) {
  if (!g) return '';
  return [...g].map(c => ARTICLE[c]).join('/');
}
export function posLine(r) {
  const p = POS[r.pos] || r.pos;
  if (r.pos === 'n' && r.g) return `${p} · ${genderLabel(r.g)}`;
  return p;
}

export function band(rank) {
  if (!rank) return 0;
  return rank <= 500 ? 1 : rank <= 1500 ? 2 : rank <= 3000 ? 3 : rank <= 6000 ? 4 : rank <= 12000 ? 5 : 0;
}
export function badges(r) {
  const out = [];
  const b = band(r.rank);
  if (b) out.push(`<span class="badge common" title="Frequency rank ${r.rank}">common</span><span class="badge band" title="Frequency band ${b} (rank ${r.rank})">B${b}</span>`);
  if (r.tone) out.push(`<span class="badge tone t${r.tone}" title="Tonelag ${r.tone}">T${r.tone}</span>`);
  if (r.wk) out.push('<span class="badge wk" title="From Wiktionary only — not in Bokmålsordboka">wikt</span>');
  return out.join('');
}

// ---------- inflection tables
export const SLOT_LABELS = {
  n: [['Singular', 'indefinite', 'entall ubestemt'], ['Singular', 'definite', 'entall bestemt'], ['Plural', 'indefinite', 'flertall ubestemt'], ['Plural', 'definite', 'flertall bestemt']],
  v: [['Infinitive', '', 'infinitiv'], ['Present', '', 'presens'], ['Past', '', 'preteritum'], ['Perfect', 'har …', 'presens perfektum'],
      ['Imperative', '', 'imperativ'], ['Passive', 'infinitive', 's-passiv infinitiv'], ['Passive', 'present', 's-passiv presens'],
      ['Past participle', 'masc/fem', 'perfektum partisipp m/f'], ['Past participle', 'neuter', 'perfektum partisipp n'],
      ['Past participle', 'definite', 'perfektum partisipp bestemt'], ['Past participle', 'plural', 'perfektum partisipp flertall'],
      ['Present participle', '', 'presens partisipp']],
  vs: [['Infinitive', '', 'infinitiv'], ['Present', '', 'presens'], ['Past', '', 'preteritum'], ['Perfect', 'har …', 'presens perfektum'], ['Imperative', '', 'imperativ']],
  a: [['Masc/fem', 'singular', 'hankjønn/hunkjønn'], ['Neuter', 'singular', 'intetkjønn'], ['Definite', 'singular', 'bestemt form'], ['Plural', '', 'flertall'],
      ['Comparative', '', 'komparativ'], ['Superlative', 'indefinite', 'superlativ ubestemt'], ['Superlative', 'definite', 'superlativ bestemt']],
  d: [['Masculine', '', 'hankjønn'], ['Feminine', '', 'hunkjønn'], ['Neuter', '', 'intetkjønn'], ['Plural', '', 'flertall'],
      ['Comparative', '', 'komparativ'], ['Superlative', 'indefinite', 'superlativ ubestemt'], ['Superlative', 'definite', 'superlativ bestemt']],
  r: [['Positive', '', 'positiv'], ['Comparative', '', 'komparativ'], ['Superlative', '', 'superlativ']],
  p: [['Subject', '', 'nominativ'], ['Object', '', 'akkusativ']],
};

export function slotLabel(kind, i) {
  const l = SLOT_LABELS[kind]?.[i];
  return l ? (l[0] + (l[1] ? ' ' + l[1] : '')) : '';
}

// which slot(s) of an entry contain a given form
export function slotsOf(e, form) {
  if (!e.inf) return [];
  const f = form.toLowerCase();
  const out = [];
  e.inf.f.forEach((cell, i) => {
    if (cell && cell.split('/').some(w => w.replace(/^~/, '').toLowerCase() === f)) out.push(slotLabel(e.inf.k, i));
  });
  return [...new Set(out)];
}

// ---------- tonelag (pitch accent) contour, drawn over syllables like Shirabe's accent line
export function toneSVG(ipa, tone) {
  if (!ipa) return '';
  const raw = ipa.replace(/^\/|\/$/g, '');
  const syl = raw.split('.').filter(Boolean);
  let si = syl.findIndex(s => s.includes('ˈ'));
  if (si < 0) si = 0;
  const clean = syl.map(s => s.replace(/[ˈˌ]/g, ''));
  const W = 46, H = 40, pad = 6;
  const width = Math.max(1, clean.length) * W + pad * 2;
  const yHi = 8, yMid = 16, yLo = 26;
  const pts = [];
  clean.forEach((s, k) => {
    const x0 = pad + k * W + 6, x1 = pad + (k + 1) * W - 6;
    let a, b;
    if (k < si) { a = yMid; b = yMid; }
    else if (k === si) {
      if (tone === 2) { a = yHi; b = yLo; }
      else if (clean.length - 1 === si) { a = yLo; b = yHi; }   // monosyllable/final stress: low rise
      else { a = yLo; b = yLo + 1; }
    } else if (k === si + 1) { a = tone === 2 ? yLo : yLo - 2; b = tone === 2 ? yHi : yHi; }
    else { a = yHi + 2; b = yHi + 4; }
    pts.push([x0, a], [x1, b]);
  });
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
  const labels = clean.map((s, k) => `<text x="${pad + k * W + W / 2}" y="${H + 12}" text-anchor="middle" class="${k === si ? 'stress' : ''}">${h(s)}</text>`).join('');
  return `<svg class="tonesvg" viewBox="0 0 ${width} ${H + 18}" width="${width}" height="${H + 18}" role="img" aria-label="Tonelag ${tone || '?'} pitch contour">
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.2" fill="currentColor"/>`).join('')}
    ${labels}</svg>`;
}

export const TONE_HELP = {
  1: 'Tonelag 1 (“enkel tone”): the stressed syllable is low and the pitch rises afterwards. Typical of monosyllables and many words with the definite suffix (e.g. bønder “farmers”).',
  2: 'Tonelag 2 (“dobbel tone”): the stressed syllable falls, then the pitch rises again on the following syllable. Only possible in words of two or more syllables (e.g. bønner “beans”).',
};

export function relTime(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

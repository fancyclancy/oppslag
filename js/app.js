import * as db from './db.js';
import * as store from './store.js';
import * as srs from './srs.js';
import { speak, available as ttsAvailable, norwegianVoices } from './speech.js';
import { h, rich, POS, POS_NO, posLine, badges, articleFor, SLOT_LABELS, slotLabel, slotsOf, toneSVG, TONE_HELP, band, relTime, toast } from './render.js';
import { ICON } from './icons.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = () => $('#view');
const qInput = () => $('#q');

// ------------------------------------------------------------------ theme
function applyTheme() {
  const s = store.settings();
  const root = document.documentElement;
  root.dataset.theme = s.theme === 'auto' ? '' : s.theme;
  if (s.theme === 'auto') delete root.dataset.theme;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--fs', s.fontScale);
}

// ------------------------------------------------------------------ router
const routes = [
  [/^#?\/?$/, () => viewHome('')],
  [/^#\/s\/(.*)$/, (m) => viewHome(decodeURIComponent(m[1]))],
  [/^#\/w\/(-?\d+)(?:\?f=(.*))?$/, (m) => viewEntry(+m[1], m[2] ? decodeURIComponent(m[2]) : '')],
  [/^#\/history$/, () => viewHistory()],
  [/^#\/lists$/, () => viewMyLists()],
  [/^#\/list\/(.+)$/, (m) => viewMyList(decodeURIComponent(m[1]))],
  [/^#\/builtin$/, () => viewBuiltins()],
  [/^#\/builtin\/(.+)$/, (m) => viewBuiltin(decodeURIComponent(m[1]))],
  [/^#\/cards$/, () => viewDecks()],
  [/^#\/review\/(.+)$/, (m) => viewReview(decodeURIComponent(m[1]))],
  [/^#\/reader$/, () => viewReader()],
  [/^#\/examples(?:\/(.*))?$/, (m) => viewExamples(m[1] ? decodeURIComponent(m[1]) : '')],
  [/^#\/settings$/, () => viewSettings()],
  [/^#\/about$/, () => viewAbout()],
];
let currentCleanup = null;
async function route() {
  closeDrawer(); hideSuggest();
  currentCleanup?.(); currentCleanup = null;
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      document.body.dataset.route = hash.split('/')[1] || 'home';
      $$('#drawer a').forEach(a => a.classList.toggle('active', hash.startsWith(a.getAttribute('href')) && a.getAttribute('href') !== '#/' || (a.getAttribute('href') === '#/' && /^#\/(s\/.*)?$/.test(hash))));
      if (!/^#\/w\//.test(hash)) window.scrollTo(0, 0);
      if (!/^#\/?(s\/.*|w\/.*)?$/.test(hash)) { qInput().value = ''; $('#clearQ').hidden = true; }
      try { await fn(m); } catch (e) { console.error(e); view().innerHTML = `<div class="empty">Something went wrong: ${h(e.message)}</div>`; }
      return;
    }
  }
  location.hash = '#/';
}

// ------------------------------------------------------------------ search box
let searchTimer = null;
function setupSearch() {
  const q = qInput();
  q.addEventListener('input', () => {
    $('#clearQ').hidden = !q.value;
    clearTimeout(searchTimer);
    showSuggest(q.value);
    searchTimer = setTimeout(() => {
      const target = q.value ? '#/s/' + encodeURIComponent(q.value) : '#/';
      if (/^#\/(s\/.*)?$/.test(location.hash || '#/')) history.replaceState(null, '', target), route();
      else location.hash = target;
    }, 140);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); store.addSearch(q.value); hideSuggest(); q.blur(); const first = $('#view .res'); if (first && e.metaKey) first.click(); }
    if (e.key === 'Escape') { q.value = ''; q.dispatchEvent(new Event('input')); }
    if (e.key === 'ArrowDown') { const s = $('#suggest li'); if (s) { e.preventDefault(); s.focus(); } }
  });
  q.addEventListener('focus', () => document.body.classList.add('typing'));
  q.addEventListener('blur', () => setTimeout(() => { document.body.classList.remove('typing'); hideSuggest(); }, 200));
  $('#clearQ').addEventListener('click', () => { q.value = ''; q.dispatchEvent(new Event('input')); q.focus(); });
  $('#pasteBtn').addEventListener('click', async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return toast('Clipboard is empty');
      if (t.split(/\s+/).length > 3) { sessionStorage.setItem('reader', t); location.hash = '#/reader'; return; }
      q.value = t; q.dispatchEvent(new Event('input'));
    } catch { toast('Clipboard access was blocked'); }
  });
  $$('#keybar button').forEach(b => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const ch = b.dataset.k;
    const s = q.selectionStart ?? q.value.length, en = q.selectionEnd ?? q.value.length;
    q.value = q.value.slice(0, s) + ch + q.value.slice(en);
    q.setSelectionRange(s + ch.length, s + ch.length);
    q.dispatchEvent(new Event('input'));
  }));
}
function showSuggest(v) {
  const ul = $('#suggest');
  const items = v.trim() ? db.suggest(v, 7) : store.S().searches.slice(0, 7);
  if (!items.length || (items.length === 1 && items[0] === v)) return hideSuggest();
  ul.innerHTML = items.map(s => `<li tabindex="0">${v.trim() ? ICON.search : ICON.clock}<span>${h(s)}</span></li>`).join('');
  ul.hidden = false;
  $$('li', ul).forEach((li, k) => {
    const pick = () => { qInput().value = items[k]; store.addSearch(items[k]); qInput().dispatchEvent(new Event('input')); hideSuggest(); qInput().blur(); };
    li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(); });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pick();
      if (e.key === 'ArrowDown') li.nextElementSibling?.focus();
      if (e.key === 'ArrowUp') (li.previousElementSibling || qInput()).focus();
    });
  });
}
function hideSuggest() { const ul = $('#suggest'); if (ul) ul.hidden = true; }

// ------------------------------------------------------------------ drawer
function openDrawer() { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }

// ------------------------------------------------------------------ result rows
function resultRow(id, extra = '') {
  const r = db.row(id);
  if (!r) return '';
  const art = r.pos === 'n' && r.g ? `<span class="art">${articleFor(r.g)}</span>` : (r.pos === 'v' ? '<span class="art">å</span>' : '');
  const gloss = r.en || (r.no ? `<span class="nogloss">${h(r.no)}</span>` : '');
  return `<a class="res" href="#/w/${id}" data-id="${id}">
    <div class="res-head">${art}<span class="lem">${h(r.lemmas.join(' / '))}</span>${r.hg ? `<sup class="hg">${r.hg}</sup>` : ''}
      <span class="pos">${h(posLine(r))}</span><span class="badges">${badges(r)}</span></div>
    <div class="res-gloss">${r.en ? h(r.en) : gloss}</div>${extra}</a>`;
}
function rowsHTML(ids) { return ids.map(id => resultRow(id)).join(''); }

// ------------------------------------------------------------------ HOME / SEARCH
async function viewHome(q) {
  if (qInput().value !== q && document.activeElement !== qInput()) qInput().value = q;
  $('#clearQ').hidden = !qInput().value;
  document.title = q ? `${q} – Oppslag` : 'Oppslag';
  if (!q.trim()) return viewHomeEmpty();
  const t0 = performance.now();
  const res = db.search(q);
  const ms = Math.round(performance.now() - t0);
  if (!res.length) {
    view().innerHTML = `<div class="empty"><p>No results for <b>${h(q)}</b>.</p>
      <p class="muted">Tips: type <kbd>aa</kbd>, <kbd>ae</kbd>, <kbd>oe</kbd> for å, æ, ø · use <kbd>*</kbd> and <kbd>?</kbd> as wildcards · search in English to find Norwegian words.</p>
      <a class="btn" href="#/examples/${encodeURIComponent(q)}">Search example sentences</a></div>`;
    return;
  }
  const label = { exact: 'Exact matches', exact2: 'Also spelled this way', form: 'Inflected forms', en: 'English → Norwegian', prefix: 'Starting with', contains: 'Containing', wild: 'Wildcard matches' };
  let html = '', last = '';
  for (const r of res) {
    const group = r.kind;
    if (group !== last) { html += `<div class="group-label">${label[group]}</div>`; last = group; }
    const extra = r.kind === 'form' ? `<div class="res-note" data-form="${h(r.form)}" data-id="${r.id}">${ICON.arrow} <b>${h(r.form)}</b> is a form of this word</div>` : '';
    html += resultRow(r.id, extra).replace(`href="#/w/${r.id}"`, `href="#/w/${r.id}${r.kind === 'form' ? '?f=' + encodeURIComponent(r.form) : ''}"`);
  }
  const words = q.trim().split(/\s+/);
  view().innerHTML = `${words.length > 2 ? `<a class="banner" href="#/reader" id="toReader">${ICON.reader} Break this sentence into words</a>` : ''}
    <div class="results">${html}</div><div class="foot muted">${res.length} results · ${ms} ms</div>`;
  $('#toReader')?.addEventListener('click', () => sessionStorage.setItem('reader', q));
  // annotate inflected forms with their grammatical slot
  for (const el of $$('.res-note[data-form]')) {
    db.entry(+el.dataset.id).then(e => {
      const sl = e && slotsOf(e, el.dataset.form);
      if (sl?.length) el.innerHTML = `${ICON.arrow} <b>${h(el.dataset.form)}</b> · ${h(sl.join(', '))}`;
    }).catch(() => {});
  }
  $$('.res', view()).forEach(a => a.addEventListener('click', () => store.addSearch(q)));
}

function viewHomeEmpty() {
  const day = new Date().toISOString().slice(0, 10);
  const wotd = db.randomCommon(day);
  const hist = store.S().history.slice(0, 8);
  const m = db.meta();
  view().innerHTML = `
    <section class="card wotd"><div class="card-title">${ICON.sun} Word of the day</div>${resultRow(wotd)}</section>
    ${hist.length ? `<section><div class="group-label">Recently viewed <a href="#/history" class="more">All</a></div>${rowsHTML(hist.map(x => x.id))}</section>` : ''}
    <section class="tips card">
      <div class="card-title">${ICON.info} Searching</div>
      <ul>
        <li>Type Norwegian or English: <a href="#/s/hus">hus</a>, <a href="#/s/house">house</a></li>
        <li>Inflected forms find their dictionary word: <a href="#/s/gikk">gikk</a> → gå, <a href="#/s/bøkene">bøkene</a> → bok</li>
        <li>No æ ø å key? Type <kbd>ae</kbd> <kbd>oe</kbd> <kbd>aa</kbd>: <a href="#/s/blaabaer">blaabaer</a></li>
        <li>Wildcards: <a href="#/s/*hus">*hus</a>, <a href="#/s/b%3Fk">b?k</a></li>
        <li>Paste a whole sentence to break it into words</li>
      </ul>
    </section>
    <div class="foot muted">${m.entries.toLocaleString()} entries · ${m.withEnglish.toLocaleString()} with English · ${m.sentences.toLocaleString()} example sentences</div>`;
}

// ------------------------------------------------------------------ ENTRY
async function viewEntry(id, fromForm) {
  const r = db.row(id);
  view().innerHTML = '<div class="loading">Loading…</div>';
  const e = await db.entry(id);
  if (!e || !r) { view().innerHTML = '<div class="empty">Entry not found.</div>'; return; }
  store.addHistory(id);
  document.title = `${e.l[0]} – Oppslag`;
  const s = store.settings();
  const lemma = e.l[0];
  const fav = store.inList('fav', id);
  const art = r.pos === 'n' && r.g ? articleFor(r.g) : (r.pos === 'v' ? 'å' : '');
  const formNote = fromForm && fromForm.toLowerCase() !== lemma.toLowerCase()
    ? `<div class="formnote">${ICON.arrow} You searched <b>${h(fromForm)}</b>${slotsOf(e, fromForm).length ? ' — ' + h(slotsOf(e, fromForm).join(', ')) : ''}</div>` : '';
  const head = `
    <header class="entry-head">
      ${formNote}
      <div class="headword">${art ? `<span class="art">${h(art)}</span>` : ''}<h1>${h(e.l.join(' / '))}</h1>${e.hg ? `<sup class="hg">${e.hg}</sup>` : ''}
        ${ttsAvailable() ? `<button class="icon speak" data-say="${h(lemma)}" title="Listen">${ICON.speaker}</button>` : ''}</div>
      <div class="sub">${h(posLine(r))}${noPosLine(r, e)}</div>
      <div class="badges big">${badges(r)}${r.rank ? `<span class="badge plain">rank ${r.rank.toLocaleString()}</span>` : ''}</div>
      <div class="actions">
        <button class="pill ${fav ? 'on' : ''}" id="favBtn">${fav ? ICON.starFill : ICON.star}<span>${fav ? 'Saved' : 'Favourite'}</span></button>
        <button class="pill" id="listBtn">${ICON.plus}<span>Add to list</span></button>
        <button class="pill" id="shareBtn">${ICON.share}<span>Share</span></button>
      </div>
    </header>`;
  const sections = { pron: secPron, en: secEnglish, no: secNorsk, fx: secExpr, inf: secInflection, cmp: secCompound, ex: secExamples, ety: secEtymology, rel: secRelated, note: secNote, src: secSource };
  const parts = [];
  for (const k of s.sections) {
    if (s.hidden.includes(k) || !sections[k]) continue;
    const html = await sections[k](e, r);
    if (html) parts.push(`<section class="esec" data-sec="${k}">${html}</section>`);
  }
  view().innerHTML = `<article class="entry">${head}${parts.join('')}</article>`;
  wireEntry(e, r);
  window.scrollTo(0, 0);
}

function noPosLine(r, e) {
  const no = POS_NO[r.pos] || '';
  const ic = (e.ic || []).filter(x => x !== no && x !== POS[r.pos]);
  const txt = [no !== POS[r.pos] ? no : '', ic.length ? ic.join(', ') : ''].filter(Boolean).join(' · ');
  return txt ? ` <span class="muted">· ${h(txt)}</span>` : '';
}
function secHead(title, no, extra = '') { return `<h2>${h(title)}${no ? ` <span class="muted no">${h(no)}</span>` : ''}${extra}</h2>`; }

function secPron(e, r) {
  if (!e.ipa && !e.bp) return '';
  const s = store.settings();
  let html = secHead('Pronunciation', 'uttale');
  if (e.ipa) {
    html += `<div class="pron"><span class="ipa">/${h(e.ipa)}/</span>${(e.ipa2 || []).map(x => `<span class="ipa alt">/${h(x)}/</span>`).join('')}
      ${ttsAvailable() ? `<button class="icon speak" data-say="${h(e.l[0])}" title="Listen">${ICON.speaker}</button>` : ''}</div>`;
    if (e.tone && s.showTone) {
      html += `<div class="tone-box"><div class="tone-graph">${toneSVG(e.ipa, e.tone)}</div>
        <div><div class="tone-label t${e.tone}">Tonelag ${e.tone}</div><p class="muted small">${h(TONE_HELP[e.tone])}</p></div></div>`;
    }
    html += `<p class="muted small">Urban East Norwegian (NB Uttale).</p>`;
  }
  if (e.bp) html += `<p class="small">Bokmålsordboka: ${rich(e.bp)}</p>`;
  return html;
}

function senseLabels(t) { return t ? `<span class="labels">${t.map(x => `<span class="lab">${h(x)}</span>`).join('')}</span>` : ''; }

function secEnglish(e, r) {
  let html = secHead('English', 'engelsk');
  if (e.en?.length) {
    if (e.ens) html += `<p class="note-shared">${ICON.info} Wiktionary doesn’t say which homograph these senses belong to, so they cover <b>every</b> “${h(e.l[0])}” (${h(POS[r.pos] || '')}). Check the Norwegian definitions below.</p>`;
    html += '<ol class="senses">' + e.en.map(s => `<li>${senseLabels(s.t)}<span class="gl">${h(s.g)}</span>
      ${(s.x || []).map(x => `<div class="ex"><span class="exno">${h(x[0])}</span>${ttsAvailable() ? `<button class="icon tiny speak" data-say="${h(x[0])}">${ICON.speaker}</button>` : ''}<span class="exen">${h(x[1])}</span></div>`).join('')}</li>`).join('') + '</ol>';
    if (e.ensrc === 'tr') html += '<p class="muted small">From English Wiktionary entries that list this word as their Norwegian translation (sense in brackets).</p>';
    return html;
  }
  if (e.cmp) {
    const parts = [e.cmp[0], e.cmp[2]].map(p => {
      const ids = db.byLemma(p);
      const pr = ids.length ? db.row(ids[0]) : null;
      return `<a href="${ids.length ? '#/w/' + ids[0] : '#/s/' + encodeURIComponent(p)}"><b>${h(p)}</b></a>${pr?.en ? ` <span class="muted">(${h(pr.en.split('; ')[0])})</span>` : ''}`;
    });
    return html + `<p class="muted">No English dictionary entry. It’s a compound of ${parts.join(' + ')}.</p>`;
  }
  return html + '<p class="muted">No English translation in the open dictionaries for this word. The Norwegian definition is below.</p>';
}

function renderDefs(defs, depth = 0) {
  return `<ol class="defs d${depth}">` + defs.map(d => {
    let li = '';
    if (d.e) li += `<div class="expl">${d.e.map(rich).join('; ')}</div>`;
    if (d.x) li += `<ul class="noex">${d.x.map(x => `<li><span class="q">${rich(x[0])}</span>${x[1] ? ` <span class="xe">– ${rich(x[1])}</span>` : ''}</li>`).join('')}</ul>`;
    if (d.c) li += `<div class="clist">${d.ci ? rich(d.ci) + ': ' : ''}${d.c.map(c => `<a class="xref" href="#/w/${c[1]}">${h(c[0])}</a>`).join(', ')}</div>`;
    if (d.d) li += renderDefs(d.d, depth + 1);
    return `<li>${li}</li>`;
  }).join('') + '</ol>';
}
function secNorsk(e) {
  if (!e.d?.length) return '';
  return secHead('Definition', 'betydning og bruk') + renderDefs(e.d) + '<p class="muted small">Bokmålsordboka</p>';
}
function secExpr(e) {
  if (!e.fx?.length) return '';
  return secHead('Fixed expressions', 'faste uttrykk') + '<ul class="fx">' +
    e.fx.map(x => `<li><div class="fxl">${h(x.l)}</div>${renderDefs(x.d)}</li>`).join('') + '</ul>';
}

function cellHTML(cell, pcell, showIpa) {
  if (!cell) return '<span class="muted">—</span>';
  const ws = cell.split('/'); const ps = (pcell || '').split('/');
  return ws.map((w, k) => {
    const alt = w.startsWith('~'); const word = w.replace(/^~/, '');
    const [ipa, tone] = (ps[k] || '').split('|');
    return `<span class="form ${alt ? 'alt' : ''}" data-say="${h(word)}" title="${alt ? 'Also registered (non-standard)' : ''}">${h(word)}${showIpa && ipa ? `<span class="fipa">/${h(ipa)}/${tone ? `<i class="t${tone}">${tone}</i>` : ''}</span>` : ''}</span>`;
  }).join('<span class="sep">/</span>');
}
function secInflection(e) {
  if (!e.inf) return '';
  const k = e.inf.k, f = e.inf.f, p = e.infp || [];
  const showIpa = store.settings().showFormIpa;
  const labels = SLOT_LABELS[k];
  let html = secHead(k === 'v' || k === 'vs' ? 'Conjugation' : 'Inflection', 'bøying');
  if (k === 'v' || k === 'vs') {
    const perf = f[3] ? f[3].split('/').map(w => '~' === w[0] ? w : 'har ' + w).join('/') : null;
    const main = [['infinitiv', f[0] ? f[0].split('/').map(w => w[0] === '~' ? '~å ' + w.slice(1) : 'å ' + w).join('/') : null, p[0]],
      ['presens', f[1], p[1]], ['preteritum', f[2], p[2]], ['presens perfektum', perf, p[3]], ['imperativ', f[4] ? f[4].split('/').map(w => w + '!').join('/') : null, p[4]]];
    html += `<div class="conj-main">${main.map(([l, c, pc]) => `<div><div class="cl">${l}</div><div class="cf">${cellHTML(c, l === 'infinitiv' || l === 'presens perfektum' ? '' : pc, showIpa)}</div></div>`).join('')}</div>`;
    if (k === 'v') {
      html += `<table class="infl"><tbody>${labels.slice(5).map((l, j) => f[j + 5] ? `<tr><th>${h(l[0])}${l[1] ? ` <span class="muted">${h(l[1])}</span>` : ''}<div class="no">${h(l[2])}</div></th><td>${cellHTML(f[j + 5], p[j + 5], showIpa)}</td></tr>` : '').join('')}</tbody></table>`;
    }
  } else if (k === 'n') {
    html += `<table class="infl grid"><thead><tr><th></th><th>indefinite<div class="no">ubestemt</div></th><th>definite<div class="no">bestemt</div></th></tr></thead><tbody>
      <tr><th>singular<div class="no">entall</div></th><td>${cellHTML(f[0], p[0], showIpa)}</td><td>${cellHTML(f[1], p[1], showIpa)}</td></tr>
      <tr><th>plural<div class="no">flertall</div></th><td>${cellHTML(f[2], p[2], showIpa)}</td><td>${cellHTML(f[3], p[3], showIpa)}</td></tr></tbody></table>`;
  } else {
    html += `<table class="infl"><tbody>${labels.map((l, j) => f[j] ? `<tr><th>${h(l[0])}${l[1] ? ` <span class="muted">${h(l[1])}</span>` : ''}<div class="no">${h(l[2])}</div></th><td>${cellHTML(f[j], p[j], showIpa)}</td></tr>` : '').join('')}</tbody></table>`;
  }
  const tags = [];
  if (e.cls?.includes('strong')) tags.push('strong / irregular verb');
  if (e.cls?.includes('sverb')) tags.push('s-verb');
  if (e.cls?.includes('irrplural')) tags.push('irregular plural');
  if (tags.length) html += `<div class="labels">${tags.map(t => `<span class="lab">${t}</span>`).join('')}</div>`;
  if (f.some(c => c && c.includes('~'))) html += '<p class="muted small">Faded forms are registered but not standard (common in speech).</p>';
  return html;
}

function secCompound(e) {
  let html = '';
  if (e.cmp) {
    const [a, joint, b] = e.cmp;
    const link = (p) => { const ids = db.byLemma(p); const r = ids.length ? db.row(ids[0]) : null;
      return `<a class="part" href="${ids.length ? '#/w/' + ids[0] : '#/s/' + encodeURIComponent(p)}"><b>${h(p)}</b>${r?.en ? `<span>${h(r.en.split('; ')[0])}</span>` : r?.no ? `<span>${h(r.no)}</span>` : ''}</a>`; };
    html += `<div class="cmp-tree"><div class="cmp-root">${h(e.l[0])}</div><div class="cmp-parts">${link(a)}${joint ? `<span class="joint" title="Linking letter (fuge)">+${h(joint)}+</span>` : '<span class="joint">+</span>'}${link(b)}</div></div>`;
  }
  const c = db.compoundsOf(e.l[0], 18);
  if (!e.l[0].includes(' ') && (c.first.length || c.last.length)) {
    const chips = (ids) => ids.map(id => { const r = db.row(id); return `<a class="chip" href="#/w/${id}">${h(r.lemmas[0])}</a>`; }).join('');
    if (c.first.length) html += `<div class="chips-label">Starting with ${h(e.l[0])}</div><div class="chips">${chips(c.first)}</div>`;
    if (c.last.length) html += `<div class="chips-label">Ending with ${h(e.l[0])}</div><div class="chips">${chips(c.last)}</div>`;
  }
  return html ? secHead('Compound', 'sammensetning') + html : '';
}

async function secExamples(e) {
  if (!e.ts?.length) return '';
  const S = await db.sentences();
  const forms = new Set(e.l.map(x => x.toLowerCase()));
  (e.inf?.f || []).forEach(c => c && c.split('/').forEach(w => forms.add(w.replace(/^~/, '').toLowerCase())));
  const mark = (t) => h(t).replace(/[A-Za-zÆØÅæøåéèêóòôüäö'-]+/g, (w) => forms.has(w.toLowerCase()) ? `<mark>${w}</mark>` : w);
  const items = e.ts.filter(id => S[id]).map(id => `<li><div class="sno"><span>${mark(S[id][0])}</span>${ttsAvailable() ? `<button class="icon tiny speak" data-say="${h(S[id][0])}">${ICON.speaker}</button>` : ''}</div><div class="sen">${h(S[id][1][0])}</div></li>`);
  return secHead('Example sentences', 'eksempelsetninger') + `<ul class="sents">${items.slice(0, 5).join('')}</ul>` +
    (items.length > 5 ? `<details class="more"><summary>Show ${items.length - 5} more</summary><ul class="sents">${items.slice(5).join('')}</ul></details>` : '') +
    '<p class="muted small">Tatoeba</p>';
}

function secEtymology(e) {
  if (!e.ety && !e.etyen) return '';
  return secHead('Word origin', 'etymologi') + (e.ety ? `<p>${rich(e.ety)} <span class="muted small">— Bokmålsordboka</span></p>` : '') +
    (e.etyen ? `<p class="muted">${h(e.etyen)} <span class="small">— Wiktionary</span></p>` : '');
}

async function secRelated(e) {
  const bits = [];
  const link = (w) => { const ids = db.byLemma(w); return `<a class="chip" href="${ids.length ? '#/w/' + ids[0] : '#/s/' + encodeURIComponent(w)}">${h(w)}</a>`; };
  if (e.syn?.length) bits.push(`<div class="chips-label">Synonyms</div><div class="chips">${e.syn.map(link).join('')}</div>`);
  if (e.ant?.length) bits.push(`<div class="chips-label">Antonyms</div><div class="chips">${e.ant.map(link).join('')}</div>`);
  if (e.top?.length) {
    const L = await db.lists();
    const t = e.top.map(t => { const l = L.find(x => x.group === 'Topics' && x.name === t); return l ? `<a class="chip topic" href="#/builtin/${encodeURIComponent(l.id)}">${h(t)}</a>` : ''; }).join('');
    if (t) bits.push(`<div class="chips-label">Topics</div><div class="chips">${t}</div>`);
  }
  const mine = store.listsContaining(e.id);
  if (mine.length) bits.push(`<div class="chips-label">In your lists</div><div class="chips">${mine.map(l => `<a class="chip" href="#/list/${encodeURIComponent(l.id)}">${h(l.name)}</a>`).join('')}</div>`);
  return bits.length ? secHead('Related', 'relatert') + bits.join('') : '';
}

function secNote(e) {
  return secHead('My notes', 'notater') + `<textarea id="noteBox" rows="2" placeholder="Add a personal note…">${h(store.note(e.id))}</textarea>`;
}

function secSource(e) {
  const links = [];
  if (e.src === 'bo') links.push(`<a href="https://ordbokene.no/bm/${e.id}" target="_blank" rel="noopener">ordbøkene.no</a>`);
  links.push(`<a href="https://en.wiktionary.org/wiki/${encodeURIComponent(e.l[0])}#Norwegian_Bokm%C3%A5l" target="_blank" rel="noopener">Wiktionary</a>`);
  return `<div class="src small muted">${e.src === 'bo' ? 'Definition and inflection: <b>Bokmålsordboka</b>, Språkrådet og Universitetet i Bergen (CC BY 4.0).' : 'Entry from <b>Wiktionary</b> only (CC BY-SA 4.0) — not in Bokmålsordboka.'}
    ${e.en ? ' English: Wiktionary (CC BY-SA 4.0).' : ''} Open in ${links.join(' · ')}</div>`;
}

function wireEntry(e, r) {
  $$('[data-say]', view()).forEach(b => b.addEventListener('click', (ev) => { ev.preventDefault(); speak(b.dataset.say); }));
  $('#favBtn')?.addEventListener('click', () => {
    const on = store.toggleInList('fav', e.id);
    const b = $('#favBtn'); b.classList.toggle('on', on); b.innerHTML = `${on ? ICON.starFill : ICON.star}<span>${on ? 'Saved' : 'Favourite'}</span>`;
    toast(on ? 'Added to Favourites' : 'Removed from Favourites');
  });
  $('#listBtn')?.addEventListener('click', () => listPicker(e.id));
  $('#shareBtn')?.addEventListener('click', async () => {
    const text = `${e.l[0]} — ${r.en || r.no}`;
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: e.l[0], text, url }); else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Copied'); } } catch {}
  });
  const nb = $('#noteBox');
  if (nb) { const grow = () => { nb.style.height = 'auto'; nb.style.height = nb.scrollHeight + 'px'; }; grow(); nb.addEventListener('input', () => { store.setNote(e.id, nb.value); grow(); }); }
}

// ------------------------------------------------------------------ modal helpers
function modal(html, onMount) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap || ev.target.closest('[data-close]')) close(); });
  onMount?.(wrap, close);
  return close;
}
function listPicker(id) {
  const render = () => store.lists().map(l => `<label class="check"><input type="checkbox" data-l="${h(l.id)}" ${l.ids.includes(id) ? 'checked' : ''}><span>${h(l.name)}</span><span class="muted">${l.ids.length}</span></label>`).join('');
  modal(`<h3>Add to list</h3><div class="picks">${render()}</div>
    <form class="row" id="nl"><input placeholder="New list name" id="nlName"><button class="btn">Create</button></form>
    <div class="modal-actions"><button class="btn primary" data-close>Done</button></div>`, (w) => {
    const bind = () => $$('input[data-l]', w).forEach(c => c.addEventListener('change', () => store.toggleInList(c.dataset.l, id)));
    bind();
    $('#nl', w).addEventListener('submit', (ev) => {
      ev.preventDefault(); const n = $('#nlName', w).value.trim(); if (!n) return;
      const l = store.newList(n); store.toggleInList(l.id, id); $('.picks', w).innerHTML = render(); bind(); $('#nlName', w).value = '';
    });
  });
}

// ------------------------------------------------------------------ HISTORY
function viewHistory() {
  const hs = store.S().history;
  document.title = 'History – Oppslag';
  view().innerHTML = `<div class="page-head"><h1>History</h1>${hs.length ? '<button class="btn small" id="clr">Clear</button>' : ''}</div>
    ${hs.length ? hs.map(x => resultRow(x.id, `<div class="res-note muted">${relTime(x.t)}</div>`)).join('') : '<div class="empty">Words you look up appear here.</div>'}`;
  $('#clr')?.addEventListener('click', () => { if (confirm('Clear search history?')) { store.clearHistory(); viewHistory(); } });
}

// ------------------------------------------------------------------ MY LISTS
function viewMyLists() {
  document.title = 'Bookmarks – Oppslag';
  const ls = store.lists();
  view().innerHTML = `<div class="page-head"><h1>Bookmarks</h1><button class="btn small" id="newL">${ICON.plus} New list</button></div>
    <div class="tiles">${ls.map(l => `<a class="tile" href="#/list/${encodeURIComponent(l.id)}">${l.id === 'fav' ? ICON.starFill : ICON.folder}<div><b>${h(l.name)}</b><div class="muted">${l.ids.length} words</div></div></a>`).join('')}</div>`;
  $('#newL').addEventListener('click', () => { const n = prompt('List name'); if (n?.trim()) { store.newList(n.trim()); viewMyLists(); } });
}

function listToolbar(ids, name, srcRef) {
  return `<div class="toolbar">
    <button class="btn small" data-act="study">${ICON.cards} Study</button>
    <button class="btn small" data-act="anki">${ICON.download} Anki export</button>
    <button class="btn small" data-act="share">${ICON.share} Share</button>
  </div>`;
}
function wireToolbar(ids, name, source) {
  $$('.toolbar [data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'study') {
      const existing = store.decks().find(d => d.source.type === source.type && d.source.id === source.id);
      const d = existing || store.newDeck(name, source, 'no');
      location.hash = '#/review/' + encodeURIComponent(d.id);
    }
    if (act === 'anki') {
      const rows = [];
      for (const id of ids) {
        const e = await db.entry(id); const r = db.row(id); if (!e) continue;
        const front = (r.pos === 'n' && r.g ? articleFor(r.g) + ' ' : r.pos === 'v' ? 'å ' : '') + e.l.join(' / ');
        const back = [r.en || r.no, e.ipa ? `/${e.ipa}/` + (e.tone ? ` (tonelag ${e.tone})` : '') : '', e.inf ? e.inf.f.filter(Boolean).slice(0, 5).join(', ').replace(/~/g, '') : ''].filter(Boolean).join('<br>');
        rows.push(`${front.replace(/\t/g, ' ')}\t${back.replace(/\t/g, ' ')}\t${POS[r.pos] || ''}`);
      }
      download(`${name.replace(/[^\wæøå-]+/gi, '_')}.tsv`, '#separator:tab\n#html:true\n#columns:Front\tBack\tTags\n' + rows.join('\n'), 'text/tab-separated-values');
    }
    if (act === 'share') {
      const text = `${name}\n` + ids.map(id => { const r = db.row(id); return r ? `${r.lemmas[0]} — ${(r.en || r.no).split('; ')[0]}` : ''; }).join('\n');
      try { if (navigator.share) await navigator.share({ title: name, text }); else { await navigator.clipboard.writeText(text); toast('List copied'); } } catch {}
    }
  }));
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function viewMyList(id) {
  const l = store.list(id);
  if (!l) { location.hash = '#/lists'; return; }
  document.title = `${l.name} – Oppslag`;
  view().innerHTML = `<div class="page-head"><a href="#/lists" class="back">${ICON.back}</a><h1>${h(l.name)}</h1>
      ${l.id !== 'fav' ? `<button class="icon" id="ren" title="Rename">${ICON.edit}</button><button class="icon" id="del" title="Delete list">${ICON.trash}</button>` : ''}</div>
    ${l.ids.length ? listToolbar() : ''}
    <div class="results">${l.ids.length ? l.ids.map(x => resultRow(x, `<button class="rm icon tiny" data-rm="${x}" title="Remove">${ICON.close}</button>`)).join('') : '<div class="empty">Tap ☆ on a word or “Add to list” to save it here.</div>'}</div>`;
  wireToolbar(l.ids, l.name, { type: 'user', id: l.id });
  $$('[data-rm]').forEach(b => b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); store.toggleInList(id, +b.dataset.rm); viewMyList(id); }));
  $('#ren')?.addEventListener('click', () => { const n = prompt('Rename list', l.name); if (n?.trim()) { store.renameList(id, n.trim()); viewMyList(id); } });
  $('#del')?.addEventListener('click', () => { if (confirm(`Delete “${l.name}”?`)) { store.deleteList(id); location.hash = '#/lists'; } });
}

// ------------------------------------------------------------------ BUILT-IN LISTS
async function viewBuiltins() {
  document.title = 'Word lists – Oppslag';
  const L = await db.lists();
  const groups = {};
  for (const l of L) if (l.ids.length) (groups[l.group] ||= []).push(l);
  const desc = { Frequency: 'The most-used words, by how often they appear in Norwegian film and TV subtitles.', Grammar: 'Word classes and irregular patterns, from the official inflection data.', Pronunciation: 'Practise the two Norwegian tones (tonelag).', Topics: 'Subject lists from Wiktionary categories.' };
  view().innerHTML = `<div class="page-head"><h1>Word lists</h1></div>
    <input class="filter" id="lf" placeholder="Filter lists…">
    ${Object.entries(groups).map(([g, ls]) => `<section class="lgroup" data-g="${h(g)}"><div class="group-label">${h(g)}</div><p class="muted small">${h(desc[g] || '')}</p>
      <div class="tiles">${ls.map(l => `<a class="tile" data-name="${h(l.name.toLowerCase())}" href="#/builtin/${encodeURIComponent(l.id)}"><div><b>${h(l.name)}</b><div class="muted">${l.ids.length} words</div></div></a>`).join('')}</div></section>`).join('')}`;
  $('#lf').addEventListener('input', (ev) => {
    const v = ev.target.value.toLowerCase();
    $$('.tile[data-name]').forEach(t => t.hidden = !t.dataset.name.includes(v));
    $$('.lgroup').forEach(s => s.hidden = !$$('.tile[data-name]', s).some(t => !t.hidden));
  });
}
async function viewBuiltin(id) {
  const L = await db.lists();
  const l = L.find(x => x.id === id);
  if (!l) { location.hash = '#/builtin'; return; }
  document.title = `${l.name} – Oppslag`;
  const ids = l.ids.filter(x => db.row(x));
  if (l.type === 'pairs') {
    const side = (id, t) => { const r = db.row(id); return r ? `<a class="pairside" href="#/w/${id}"><span class="badge tone t${t}">T${t}</span> <b>${h(r.lemmas[0])}</b> <span class="muted">${h((r.en || r.no).split('; ')[0])}</span></a>` : ''; };
    view().innerHTML = `<div class="page-head"><a href="#/builtin" class="back">${ICON.back}</a><h1>${h(l.name)}</h1></div>
      <p class="muted small">Each form is spelled the same but pronounced with tonelag 1 in one word and tonelag 2 in the other. Tap the speaker to hear the form.</p>
      ${listToolbar()}
      <div class="pairs">${l.pairs.map(([f, a, b]) => `<div class="pair"><div class="pairform"><b>${h(f)}</b>${ttsAvailable() ? `<button class="icon tiny speak" data-say="${h(f)}">${ICON.speaker}</button>` : ''}</div>${side(a, 1)}${side(b, 2)}</div>`).join('')}</div>`;
    wireToolbar(ids, l.name, { type: 'builtin', id: l.id });
    $$('[data-say]', view()).forEach(b => b.addEventListener('click', () => speak(b.dataset.say)));
    return;
  }
  const PAGE = 100; let shown = PAGE;
  view().innerHTML = `<div class="page-head"><a href="#/builtin" class="back">${ICON.back}</a><h1>${h(l.name)}</h1></div>
    ${listToolbar()}<button class="btn small" id="copyL">${ICON.folder} Save a copy to Bookmarks</button>
    <div class="results" id="lr">${rowsHTML(ids.slice(0, PAGE))}</div>${ids.length > PAGE ? '<button class="btn wide" id="moreL">Show more</button>' : ''}`;
  wireToolbar(ids, l.name, { type: 'builtin', id: l.id });
  $('#moreL')?.addEventListener('click', (ev) => { $('#lr').insertAdjacentHTML('beforeend', rowsHTML(ids.slice(shown, shown + PAGE))); shown += PAGE; if (shown >= ids.length) ev.target.remove(); });
  $('#copyL').addEventListener('click', () => { const n = store.newList(l.name); n.ids = [...ids]; store.save(); toast('Saved to Bookmarks'); });
}

// ------------------------------------------------------------------ FLASHCARDS
async function deckIds(d) {
  if (d.source.type === 'user') return store.list(d.source.id)?.ids.filter(x => db.row(x)) || [];
  const L = await db.lists(); return (L.find(x => x.id === d.source.id)?.ids || []).filter(x => db.row(x));
}
const dirsOf = (d) => d.dir === 'both' ? ['no', 'en'] : [d.dir];

async function viewDecks() {
  document.title = 'Flashcards – Oppslag';
  const ds = store.decks();
  const rows = [];
  for (const d of ds) {
    const ids = await deckIds(d); const st = srs.stats(d.id, ids, dirsOf(d));
    rows.push(`<div class="deck"><a href="#/review/${encodeURIComponent(d.id)}"><b>${h(d.name)}</b>
      <div class="deckstats"><span class="due">${st.due} due</span><span class="new">${st.new} new</span><span class="muted">${st.mature} mature · ${ids.length} words</span></div></a>
      <select data-dir="${d.id}" title="Card direction"><option value="no" ${d.dir === 'no' ? 'selected' : ''}>NO → EN</option><option value="en" ${d.dir === 'en' ? 'selected' : ''}>EN → NO</option><option value="both" ${d.dir === 'both' ? 'selected' : ''}>Both</option></select>
      <button class="icon" data-deldeck="${d.id}" title="Delete deck">${ICON.trash}</button></div>`);
  }
  const L = await db.lists();
  const opts = [...store.lists().map(l => `<option value="user:${h(l.id)}">${h(l.name)} (${l.ids.length})</option>`),
    ...L.filter(l => l.ids.length && l.group !== 'Topics').map(l => `<option value="builtin:${h(l.id)}">${h(l.group)} · ${h(l.name)}</option>`),
    ...L.filter(l => l.ids.length && l.group === 'Topics').map(l => `<option value="builtin:${h(l.id)}">Topic · ${h(l.name)}</option>`)].join('');
  view().innerHTML = `<div class="page-head"><h1>Flashcards</h1></div>
    <p class="muted small">Spaced repetition: cards you know well come back less often. New cards per day: ${store.settings().newPerDay} (change in Settings).</p>
    ${rows.join('') || '<div class="empty">No decks yet. Make one from any list.</div>'}
    <form class="card newdeck" id="nd"><div class="card-title">${ICON.plus} New deck</div>
      <select id="ndSrc">${opts}</select>
      <select id="ndDir"><option value="no">Norwegian → English</option><option value="en">English → Norwegian</option><option value="both">Both directions</option></select>
      <button class="btn primary">Create deck</button></form>`;
  $$('[data-dir]').forEach(s => s.addEventListener('change', () => { store.updateDeck(s.dataset.dir, { dir: s.value }); viewDecks(); }));
  $$('[data-deldeck]').forEach(b => b.addEventListener('click', () => { if (confirm('Delete this deck and its review progress?')) { store.deleteDeck(b.dataset.deldeck); viewDecks(); } }));
  $('#nd').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const [type, ...rest] = $('#ndSrc').value.split(':'); const id = rest.join(':');
    const name = type === 'user' ? store.list(id).name : L.find(x => x.id === id).name;
    store.newDeck(name, { type, id }, $('#ndDir').value); viewDecks();
  });
}

async function viewReview(deckId) {
  const d = store.deck(deckId);
  if (!d) { location.hash = '#/cards'; return; }
  document.title = `${d.name} – Flashcards`;
  const ids = await deckIds(d);
  const s = store.settings();
  let q = srs.queue(d.id, ids, dirsOf(d), s.newPerDay);
  let items = [...q.due, ...q.fresh];
  let done = 0;
  const again = [];
  const next = async () => {
    if (!items.length && again.length) {
      // learning cards come back within the session once due
      again.sort((a, b) => srs.state(a).due - srs.state(b).due);
      items.push(again.shift());
    }
    if (!items.length) {
      const st = srs.stats(d.id, ids, dirsOf(d));
      view().innerHTML = `<div class="page-head"><a href="#/cards" class="back">${ICON.back}</a><h1>${h(d.name)}</h1></div>
        <div class="empty"><div class="big-emoji">✓</div><p><b>All done for now.</b> ${done} cards reviewed.</p>
        <p class="muted">${st.new} new cards left · new cards per day: ${s.newPerDay}</p><a class="btn" href="#/cards">Back to decks</a></div>`;
      return;
    }
    const key = items.shift();
    const [, idStr, dir] = key.split(':');
    const id = +idStr;
    const e = await db.entry(id); const r = db.row(id);
    if (!e || !r) return next();
    const art = r.pos === 'n' && r.g ? articleFor(r.g) + ' ' : r.pos === 'v' ? 'å ' : '';
    const noWord = `${art}${e.l.join(' / ')}`;
    const enText = r.en ? r.en.split('; ').slice(0, 3).join('; ') : r.no;
    const front = dir === 'no' ? `<div class="cf-word">${h(noWord)}</div><div class="muted">${h(POS[r.pos] || '')}</div>`
      : `<div class="cf-en">${h(enText)}</div><div class="muted">${h(POS[r.pos] || '')}${r.pos === 'n' && r.g ? ' · ' + articleFor(r.g) : ''}</div>`;
    const backParts = [];
    if (dir === 'en') backParts.push(`<div class="cf-word">${h(noWord)}</div>`);
    for (const f of s.cardBack) {
      if (f === 'en' && dir === 'no') backParts.push(`<div class="cb-en">${e.en ? e.en.slice(0, 4).map(x => h(x.g)).join('<br>') : h(r.no)}</div>`);
      if (f === 'pron' && e.ipa) backParts.push(`<div class="cb-pron"><span class="ipa">/${h(e.ipa)}/</span>${e.tone ? `<span class="tone-label t${e.tone}">Tonelag ${e.tone}</span>` : ''}</div>`);
      if (f === 'inf' && e.inf) backParts.push(`<div class="cb-inf">${e.inf.f.slice(0, e.inf.k === 'v' ? 5 : 4).filter(Boolean).map(c => h(c.split('/').filter(w => w[0] !== '~').join('/'))).join(' · ')}</div>`);
      if (f === 'no' && e.d) backParts.push(`<div class="cb-no">${renderDefs(e.d.slice(0, 2))}</div>`);
      if (f === 'ex' && e.ts?.length) { const S = await db.sentences(); const x = S[e.ts[0]]; if (x) backParts.push(`<div class="cb-ex"><div>${h(x[0])}</div><div class="muted">${h(x[1][0])}</div></div>`); }
      if (f === 'cmp' && e.cmp) backParts.push(`<div class="cb-cmp">${h(e.cmp[0])} + ${e.cmp[1] ? h(e.cmp[1]) + ' + ' : ''}${h(e.cmp[2])}</div>`);
      if (f === 'note' && store.note(id)) backParts.push(`<div class="cb-note">${h(store.note(id))}</div>`);
    }
    const remaining = items.length + 1 + again.length;
    view().innerHTML = `<div class="page-head"><a href="#/cards" class="back">${ICON.back}</a><h1>${h(d.name)}</h1><span class="muted">${remaining} left</span></div>
      <div class="flash" id="flash">
        <div class="front">${front}</div>
        ${s.typeAnswer ? `<input id="typed" class="typed" placeholder="${dir === 'no' ? 'Type the meaning…' : 'Type the Norwegian word…'}" autocapitalize="off" autocomplete="off" spellcheck="false">` : ''}
        <div class="cardback" hidden>${backParts.join('')}<div id="typedResult"></div>
          <div class="cardlinks">${ttsAvailable() ? `<button class="btn small" data-say="${h(e.l[0])}">${ICON.speaker} Listen</button>` : ''}<a class="btn small" href="#/w/${id}">Open entry</a></div></div>
      </div>
      <div class="answer" id="ans"><button class="btn primary wide" id="show">Show answer <kbd>space</kbd></button></div>`;
    if (dir === 'no' && ttsAvailable() && s.autoSpeak) speak(e.l[0]);
    const show = () => {
      $('.cardback').hidden = false;
      const typed = $('#typed');
      if (typed) {
        const v = typed.value.trim().toLowerCase(); typed.disabled = true;
        if (v) {
          const target = dir === 'no' ? (r.en || '').toLowerCase() : e.l.map(x => x.toLowerCase()).join('|');
          const ok = dir === 'no' ? target.split(/[;,]\s*/).some(t => t.replace(/^(to|a|an|the) /, '').trim() === v.replace(/^(to|a|an|the) /, '')) : target.split('|').includes(v);
          $('#typedResult').innerHTML = `<div class="typed-res ${ok ? 'ok' : 'bad'}">${ok ? '✓ Correct' : '✗ You typed: ' + h(typed.value)}</div>`;
        }
      }
      $('#ans').innerHTML = `<div class="grades">${['Again', 'Hard', 'Good', 'Easy'].map((g, k) => `<button class="grade g${k}" data-g="${k}"><b>${g}</b><span>${srs.preview(key, k)}</span><kbd>${k + 1}</kbd></button>`).join('')}</div>`;
      $$('.grade').forEach(b => b.addEventListener('click', () => answer(+b.dataset.g)));
      $$('[data-say]', view()).forEach(b => b.addEventListener('click', () => speak(b.dataset.say)));
      if (dir === 'en' && ttsAvailable() && s.autoSpeak) speak(e.l[0]);
    };
    const answer = (g) => {
      const c = srs.grade(key, g); done++;
      if (c.learning && c.due - Date.now() < 30 * 60000) again.push(key);
      next();
    };
    $('#show').addEventListener('click', show);
    $('#flash').addEventListener('click', (ev) => { if (!ev.target.closest('input,button,a') && $('.cardback').hidden) show(); });
    $('#typed')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); show(); } });
    $('#typed')?.focus();
    keyHandler = (ev) => {
      if (ev.target.matches('input,textarea,select')) return;
      if (ev.key === ' ' && $('.cardback')?.hidden) { ev.preventDefault(); show(); }
      else if ($('.cardback') && !$('.cardback').hidden && /^[1-4]$/.test(ev.key)) answer(+ev.key - 1);
    };
  };
  let keyHandler = null;
  const kh = (ev) => keyHandler?.(ev);
  document.addEventListener('keydown', kh);
  currentCleanup = () => document.removeEventListener('keydown', kh);
  next();
}

// ------------------------------------------------------------------ SENTENCE READER (multi-word lookup)
function viewReader() {
  document.title = 'Reader – Oppslag';
  const text = sessionStorage.getItem('reader') || '';
  view().innerHTML = `<div class="page-head"><h1>Reader</h1></div>
    <p class="muted small">Paste Norwegian text. Every word is looked up, including inflected forms.</p>
    <textarea id="rt" rows="4" placeholder="F.eks.: Jeg har bodd i Norge i tre år, og jeg snakker fortsatt ikke flytende norsk.">${h(text)}</textarea>
    <div class="row"><button class="btn primary" id="go">Look up words</button><button class="btn" id="paste">${ICON.paste} Paste</button>${ttsAvailable() ? `<button class="btn" id="say">${ICON.speaker} Read aloud</button>` : ''}</div>
    <div id="rout"></div>`;
  const run = () => {
    const t = $('#rt').value; sessionStorage.setItem('reader', t);
    const toks = t.match(/[A-Za-zÆØÅæøåÉéÈèÊêÓóÒòÔôÜüÄäÖö]+(?:[-'][A-Za-zÆØÅæøå]+)*/g) || [];
    const out = [];
    const seen = new Set();
    // greedy multi-word expressions (2–3 words) first
    for (let k = 0; k < toks.length; k++) {
      let matched = null;
      for (const len of [3, 2]) {
        if (k + len > toks.length) continue;
        const phrase = toks.slice(k, k + len).join(' ');
        const ids = db.byLemma(phrase);
        if (ids.length) { matched = { tok: phrase, ids, len }; break; }
      }
      if (!matched) matched = { tok: toks[k], ids: db.lookupToken(toks[k]), len: 1 };
      out.push(matched); k += matched.len - 1;
    }
    $('#rout').innerHTML = `<div class="reader-line">${out.map((o, i) => `<button class="rtok ${o.ids.length ? '' : 'unk'} ${o.len > 1 ? 'mwe' : ''}" data-i="${i}">${h(o.tok)}</button>`).join(' ')}</div>
      <div class="rlist">${out.map((o, i) => {
        const key = o.tok.toLowerCase(); if (seen.has(key)) return ''; seen.add(key);
        if (!o.ids.length) return `<div class="rword" id="rw${i}"><div class="rtokname">${h(o.tok)}</div><div class="muted small">Not found</div></div>`;
        return `<div class="rword" id="rw${i}"><div class="rtokname">${h(o.tok)}</div>${o.ids.slice(0, 3).map(id => resultRow(id)).join('')}</div>`;
      }).join('')}</div>`;
    $$('.rtok').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i; const tok = out[i].tok.toLowerCase();
      const target = $$('.rword').find(x => $('.rtokname', x).textContent.toLowerCase() === tok);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); target?.classList.add('flash-hl'); setTimeout(() => target?.classList.remove('flash-hl'), 900);
    }));
  };
  $('#go').addEventListener('click', run);
  $('#paste').addEventListener('click', async () => { try { $('#rt').value = await navigator.clipboard.readText(); run(); } catch { toast('Clipboard access was blocked'); } });
  $('#say')?.addEventListener('click', () => speak($('#rt').value));
  if (text) run();
}

// ------------------------------------------------------------------ EXAMPLE SENTENCE SEARCH
async function viewExamples(q) {
  document.title = 'Example sentences – Oppslag';
  view().innerHTML = `<div class="page-head"><h1>Example sentences</h1></div>
    <form id="exf" class="row"><input id="exq" value="${h(q)}" placeholder="Search Norwegian or English sentences…" autocapitalize="off"><button class="btn primary">Search</button></form><div id="exr" class="loading">Loading…</div>`;
  $('#exf').addEventListener('submit', (ev) => { ev.preventDefault(); location.hash = '#/examples/' + encodeURIComponent($('#exq').value); });
  const S = await db.sentences();
  if (!q.trim()) { $('#exr').className = ''; $('#exr').innerHTML = `<p class="muted">${Object.keys(S).length.toLocaleString()} Norwegian sentences with English translations from Tatoeba.</p>`; return; }
  const ql = q.toLowerCase();
  const re = new RegExp('(^|[^\\p{L}])(' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'iu');
  const hits = Object.values(S).filter(([no, en]) => re.test(no) || en.some(x => re.test(x))).sort((a, b) => a[0].length - b[0].length).slice(0, 200);
  const mk = (t) => h(t).replace(new RegExp('(' + h(ql).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
  $('#exr').className = '';
  $('#exr').innerHTML = hits.length ? `<ul class="sents">${hits.map(([no, en]) => `<li><div class="sno"><span>${mk(no)}</span>${ttsAvailable() ? `<button class="icon tiny speak" data-say="${h(no)}">${ICON.speaker}</button>` : ''}</div><div class="sen">${mk(en[0])}</div></li>`).join('')}</ul><div class="foot muted">${hits.length}${hits.length === 200 ? '+' : ''} sentences</div>` : '<div class="empty">No sentences found.</div>';
  $$('[data-say]', view()).forEach(b => b.addEventListener('click', () => speak(b.dataset.say)));
}

// ------------------------------------------------------------------ SETTINGS
const SECTION_NAMES = { pron: 'Pronunciation & tonelag', en: 'English meanings', no: 'Norwegian definition', fx: 'Fixed expressions', inf: 'Inflection / conjugation', cmp: 'Compound breakdown', ex: 'Example sentences', ety: 'Word origin', rel: 'Related words & topics', note: 'My notes', src: 'Sources' };
const BACK_FIELDS = { en: 'English meaning', pron: 'IPA & tonelag', inf: 'Inflection', no: 'Norwegian definition', ex: 'Example sentence', cmp: 'Compound parts', note: 'My note' };
const ACCENTS = ['#c8102e', '#00205b', '#1f7a5a', '#7a4fb3', '#d9730d', '#3b6fb6', '#444444'];

function viewSettings() {
  document.title = 'Settings – Oppslag';
  const s = store.settings();
  const voices = norwegianVoices();
  view().innerHTML = `<div class="page-head"><h1>Settings</h1></div>
  <section class="card"><div class="card-title">Appearance</div>
    <label class="field"><span>Theme</span><select id="theme"><option value="auto">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <div class="field"><span>Accent colour</span><div class="swatches">${ACCENTS.map(c => `<button class="sw ${c === s.accent ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<input type="color" id="accent" value="${s.accent}"></div></div>
    <label class="field"><span>Text size</span><input type="range" id="fs" min="0.85" max="1.4" step="0.05" value="${s.fontScale}"></label>
  </section>
  <section class="card"><div class="card-title">Word page layout</div><p class="muted small">Reorder or hide sections of each entry.</p>
    <ul class="reorder" id="ro">${s.sections.map(k => `<li data-k="${k}"><label class="check"><input type="checkbox" ${s.hidden.includes(k) ? '' : 'checked'}><span>${SECTION_NAMES[k]}</span></label><button class="icon tiny" data-up>${ICON.up}</button><button class="icon tiny" data-down>${ICON.down}</button></li>`).join('')}</ul>
    <label class="check"><input type="checkbox" id="showTone" ${s.showTone ? 'checked' : ''}><span>Show tonelag (pitch accent) graph</span></label>
    <label class="check"><input type="checkbox" id="showFormIpa" ${s.showFormIpa ? 'checked' : ''}><span>Show pronunciation for every inflected form</span></label>
  </section>
  <section class="card"><div class="card-title">Speech</div>
    ${ttsAvailable() ? `<label class="field"><span>Voice</span><select id="voice"><option value="">Automatic</option>${voices.map(v => `<option value="${h(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${h(v.name)} (${h(v.lang)})</option>`).join('')}</select></label>
    ${voices.length ? '' : '<p class="muted small">No Norwegian voice found. On iPhone: Settings → Accessibility → Spoken Content → Voices → Norwegian.</p>'}
    <label class="field"><span>Speed</span><input type="range" id="rate" min="0.5" max="1.3" step="0.05" value="${s.rate}"></label>
    <label class="check"><input type="checkbox" id="autoSpeak" ${s.autoSpeak ? 'checked' : ''}><span>Speak flashcards automatically</span></label>
    <button class="btn small" id="testVoice">${ICON.speaker} Test: “Hei, hvordan har du det?”</button>` : '<p class="muted">Speech is not available in this browser.</p>'}
  </section>
  <section class="card"><div class="card-title">Flashcards</div>
    <label class="field"><span>New cards per day</span><input type="number" id="npd" min="0" max="200" value="${s.newPerDay}"></label>
    <div class="field"><span>Show on the back</span><div>${Object.entries(BACK_FIELDS).map(([k, v]) => `<label class="check"><input type="checkbox" data-back="${k}" ${s.cardBack.includes(k) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="typeAnswer" ${s.typeAnswer ? 'checked' : ''}><span>Type the answer before revealing (scratchpad)</span></label>
  </section>
  <section class="card"><div class="card-title">History</div>
    <label class="field"><span>Keep the last</span><select id="hl">${[50, 100, 200, 500, 1000].map(n => `<option ${n === s.historyLimit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <button class="btn small" id="clrH">Clear history</button>
  </section>
  <section class="card"><div class="card-title">Backup & sync</div>
    <p class="muted small">Your bookmarks, notes and flashcard progress live only on this device. Export a backup to move them to another device.</p>
    <div class="row"><button class="btn" id="exp">${ICON.download} Export backup</button><label class="btn">${ICON.upload} Import backup<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
  </section>
  <section class="card"><div class="card-title">Offline</div>
    <p class="muted small" id="offStat">Checking…</p>
    <button class="btn" id="offBtn">${ICON.download} Download full dictionary</button>
  </section>`;
  $('#theme').value = s.theme;
  $('#theme').addEventListener('change', (ev) => { store.setSetting('theme', ev.target.value); applyTheme(); });
  $$('.sw').forEach(b => b.addEventListener('click', () => { store.setSetting('accent', b.dataset.c); applyTheme(); viewSettings(); }));
  $('#accent').addEventListener('input', (ev) => { store.setSetting('accent', ev.target.value); applyTheme(); });
  $('#fs').addEventListener('input', (ev) => { store.setSetting('fontScale', +ev.target.value); applyTheme(); });
  const saveOrder = () => {
    const order = $$('#ro li').map(li => li.dataset.k);
    const hidden = $$('#ro li').filter(li => !$('input', li).checked).map(li => li.dataset.k);
    store.setSetting('sections', order); store.setSetting('hidden', hidden);
  };
  $$('#ro li').forEach(li => {
    $('input', li).addEventListener('change', saveOrder);
    $('[data-up]', li).addEventListener('click', () => { li.previousElementSibling?.before(li); saveOrder(); });
    $('[data-down]', li).addEventListener('click', () => { li.nextElementSibling?.after(li); saveOrder(); });
  });
  for (const k of ['showTone', 'showFormIpa', 'typeAnswer', 'autoSpeak']) $('#' + k)?.addEventListener('change', (ev) => store.setSetting(k, ev.target.checked));
  $('#voice')?.addEventListener('change', (ev) => store.setSetting('voiceURI', ev.target.value));
  $('#rate')?.addEventListener('change', (ev) => store.setSetting('rate', +ev.target.value));
  $('#testVoice')?.addEventListener('click', () => speak('Hei, hvordan har du det?'));
  $('#npd').addEventListener('change', (ev) => store.setSetting('newPerDay', Math.max(0, +ev.target.value || 0)));
  $$('[data-back]').forEach(c => c.addEventListener('change', () => store.setSetting('cardBack', $$('[data-back]').filter(x => x.checked).map(x => x.dataset.back))));
  $('#hl').addEventListener('change', (ev) => store.setSetting('historyLimit', +ev.target.value));
  $('#clrH').addEventListener('click', () => { if (confirm('Clear history?')) { store.clearHistory(); toast('History cleared'); } });
  $('#exp').addEventListener('click', () => download(`oppslag-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportAll()));
  $('#imp').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { store.importAll(await f.text()); applyTheme(); toast('Backup restored'); viewSettings(); } catch (err) { alert('Could not import: ' + err.message); }
  });
  offlineStatus();
  $('#offBtn').addEventListener('click', () => prefetchAll(true));
}

// ------------------------------------------------------------------ ABOUT
function viewAbout() {
  const m = db.meta();
  document.title = 'About – Oppslag';
  view().innerHTML = `<div class="page-head"><h1>About Oppslag</h1></div>
  <section class="card"><p><b>Oppslag</b> (“look-up”) is an offline Norwegian Bokmål ⇄ English study dictionary, modelled on Shirabe Jisho.</p>
   <p class="muted small">Data built ${h(m.built)} · ${m.entries.toLocaleString()} entries (${m.bo.toLocaleString()} from Bokmålsordboka, ${m.wk.toLocaleString()} Wiktionary-only) · ${m.withEnglish.toLocaleString()} with English · ${m.withPron.toLocaleString()} with pronunciation · ${m.forms.toLocaleString()} word forms · ${m.sentences.toLocaleString()} example sentences.</p></section>
  <section class="card"><div class="card-title">Sources & licences</div>
   <ul class="sources">
    <li><b>Bokmålsordboka</b>: definitions, examples, fixed expressions, etymology, official spelling and inflection. © Språkrådet og Universitetet i Bergen, <a href="https://ordbokene.no" target="_blank" rel="noopener">ordbøkene.no</a>. Licence: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</li>
    <li><b>Norsk ordbank bokmål</b>: compound analysis. Språkbanken, Nasjonalbiblioteket / UiB. CC BY 4.0.</li>
    <li><b>NB Uttale</b>: IPA and tonelag (Urban East Norwegian). Språkbanken, Nasjonalbiblioteket. CC0.</li>
    <li><b>Wiktionary</b>: English meanings, English etymology, topics, synonyms. Extracted by <a href="https://kaikki.org" target="_blank" rel="noopener">kaikki.org</a>. CC BY-SA 4.0.</li>
    <li><b>Tatoeba</b>: example sentences with English translations. <a href="https://tatoeba.org" target="_blank" rel="noopener">tatoeba.org</a>. CC BY 2.0 FR.</li>
    <li><b>FrequencyWords</b> (H. Dave, OpenSubtitles 2018): word frequency for ranking and “common” labels. CC BY-SA 4.0.</li>
   </ul>
   <p class="muted small">Content has been reformatted and combined; English meanings are matched to Bokmålsordboka entries by spelling, word class and gender. Where Wiktionary can’t tell homographs apart, the entry says so.</p></section>
  <section class="card"><div class="card-title">Keyboard shortcuts</div>
   <ul class="kbd-list"><li><kbd>/</kbd> or <kbd>⌘K</kbd> focus search</li><li><kbd>Esc</kbd> clear search</li><li><kbd>↓</kbd> suggestions</li><li><kbd>Space</kbd> flip card · <kbd>1</kbd>–<kbd>4</kbd> grade</li><li><kbd>Alt</kbd>+<kbd>←</kbd> back</li></ul></section>`;
}

// ------------------------------------------------------------------ offline
async function offlineStatus() {
  const el = $('#offStat'); if (!el) return;
  try {
    const c = await caches.open('oppslag-data');
    const keys = await c.keys();
    const n = keys.filter(k => /\/e\/\d+\.json$/.test(k.url)).length;
    const total = db.meta().shards;
    el.textContent = n >= total ? '✓ The whole dictionary is saved on this device and works offline.' : `${n} of ${total} dictionary parts saved for offline use.`;
  } catch { el.textContent = 'Offline storage is not available in this browser.'; }
}
let prefetching = false;
async function prefetchAll(manual) {
  if (prefetching || !('caches' in window)) return;
  prefetching = true;
  try {
    const c = await caches.open('oppslag-data');
    const total = db.meta().shards;
    const urls = ['data/sentences.json', 'data/lists.json', ...Array.from({ length: total }, (_, i) => `data/e/${i}.json`)];
    let done = 0;
    const work = async () => {
      while (urls.length) {
        const u = urls.shift();
        const abs = new URL(u, location.href).href;
        if (!(await c.match(abs))) { try { const r = await fetch(u); if (r.ok) await c.put(abs, r); } catch {} }
        done++;
        if (manual && $('#offStat')) $('#offStat').textContent = `Downloading… ${Math.round(done / (total + 2) * 100)}%`;
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    try { localStorage.setItem('oppslag.offline', '1'); } catch {}
    if (manual) { offlineStatus(); toast('Dictionary saved for offline use'); }
  } finally { prefetching = false; }
}

// ------------------------------------------------------------------ boot
async function boot() {
  applyTheme();
  $('#menuBtn').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  setupSearch();
  // swipe from left edge to open the menu
  let sx = null;
  document.addEventListener('touchstart', (e) => { const x = e.touches[0].clientX; sx = x < 24 ? x : null; }, { passive: true });
  document.addEventListener('touchmove', (e) => { if (sx !== null && e.touches[0].clientX - sx > 60) { openDrawer(); sx = null; } }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if ((e.key === '/' && !e.target.matches('input,textarea')) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); qInput().focus(); qInput().select(); }
    if (e.key === 'Escape') closeDrawer();
  });
  try {
    await db.load((m) => { $('#splash-msg').textContent = m; });
  } catch (e) {
    $('#splash-msg').textContent = 'Could not load the dictionary: ' + e.message; return;
  }
  // dictionary rebuilt since last visit? drop the stale cached data and reload once
  const ver = `${db.meta().built}:${db.meta().entries}:${db.meta().forms}`;
  let oldVer = null; try { oldVer = localStorage.getItem('oppslag.dataver'); localStorage.setItem('oppslag.dataver', ver); } catch {}
  if (oldVer && oldVer !== ver && 'caches' in window) { await caches.delete('oppslag-data'); location.reload(); return; }
  document.body.classList.add('ready');
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => {
      // Shirabe works fully offline: quietly fetch the rest of the dictionary in the background
      setTimeout(() => prefetchAll(false), 4000);
    }).catch(() => {});
  }
}
boot();

import * as db from './db.js';
import * as store from './store.js';
import * as srs from './srs.js';
import { speak, available as ttsAvailable, norwegianVoices } from './speech.js';
import { h, rich, POS, POS_NO, posLine, articleFor, SLOT_LABELS, slotsOf, toneSVG, TONE_HELP, band, relTime, toast } from './render.js';
import { ICON } from './icons.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = () => $('#view');
const qInput = () => $('#q');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const POS_SHORT = { adv: 'adv.', prep: 'prep.', pron: 'pron.', det: 'det.', conj: 'conj.', sconj: 'conj.', intj: 'interj.', num: 'num.', expr: 'expr.', pfx: 'prefix', sfx: 'suffix', abbr: 'abbr.', sym: 'symbol', name: 'name', a: 'adj.' };
const COMMON_RANK = 6000;

// ------------------------------------------------------------------ theme
const ACCENTS = [['fjord', 'Fjord', '#3A6788', '#8CB3D4'], ['sage', 'Sage', '#4D7444', '#9CC08E'], ['heather', 'Heather', '#6A5A8C', '#B9AAD8'],
  ['clay', 'Clay', '#97573E', '#E2A78C'], ['slate', 'Slate', '#4E5C68', '#AAB7C2'], ['fjell', 'Fjell', '#A2283E', '#EE9AA6']];
const OLD_ACCENTS = { '#c8102e': 'fjord', '#5f8a55': 'fjord', '#4f7fa8': 'fjord', '#7d6c9e': 'heather', '#b2735b': 'clay', '#5b6b77': 'slate' };
function applyTheme() {
  const s = store.settings();
  if (!s.accent || OLD_ACCENTS[s.accent]) store.setSetting('accent', OLD_ACCENTS[s.accent] || 'fjord');   // migrate earlier versions
  const root = document.documentElement;
  if (s.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = s.theme;
  const preset = ACCENTS.find(a => a[0] === s.accent);
  root.style.setProperty('--acc-l', preset ? preset[2] : s.accent);
  root.style.setProperty('--acc-d', preset ? preset[3] : `color-mix(in srgb, ${s.accent} 55%, white)`);
  root.style.setProperty('--fs', s.fontScale);
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', bg));
  });
}

// ------------------------------------------------------------------ navigation chrome
const NAV_LINKS = [['#/', 'Dictionary', 'search'], ['#/history', 'History', 'clock'], ['#/lists', 'Bookmarks', 'bookmark'], ['#/builtin', 'Word lists', 'list'],
  ['#/cards', 'Flashcards', 'cards'], ['#/reader', 'Reader', 'reader'], ['#/examples', 'Example sentences', 'quote'], null, ['#/settings', 'Settings', 'gear'], ['#/about', 'About & sources', 'info']];
let backTarget = null;
function setNav({ title = '', back = null, right = '', search = false }) {
  backTarget = back;
  document.body.classList.toggle('has-search', search);
  document.body.classList.toggle('root', !back);
  $('#navTitle').textContent = title;
  const L = $('#navLeft');
  L.innerHTML = back ? ICON.back : ICON.menu;
  L.setAttribute('aria-label', back ? 'Back' : 'Menu');
  $('#navRight').innerHTML = right;
  if (!search) document.body.classList.remove('typing');
}
function goBack(fromSwipe = false) {
  if (navStack.length > 1) {
    expectBack = true; swipeBack = fromSwipe;
    if (OWN_HISTORY) location.replace(navStack[navStack.length - 2]); else history.back();
  }
  else go(backTarget || '#/', fromSwipe ? 'none' : 'back', true).then(() => { if (fromSwipe) endBackDrag(); });
}
// ---- swipe-back: the current page follows the finger; the previous one waits underneath, slightly
// behind (parallax) and shaded, the way iOS does it
function startBackDrag() {
  const prev = navStack.length > 1 ? navStack[navStack.length - 2] : backTarget;
  const snap = snaps.get(prev);
  $('#under')?.remove();
  const u = document.createElement('div');
  u.id = 'under'; u.inert = true; u.setAttribute('aria-hidden', 'true');
  if (snap) {
    u.className = snap.cls + (snap.page ? ' page-' + snap.page : '');
    u.innerHTML = `<header class="topbar">${snap.top}</header><div class="under-scroll" style="transform:translateY(${-snap.y}px)">${snap.view}</div>`;
    const q = u.querySelector('input[type=search]'); if (q) q.value = snap.q;
  }
  document.body.appendChild(u);
  return true;
}
function endBackDrag() {
  const r = document.documentElement;
  clearTimeout(settleTimer);
  r.classList.remove('page-moving', 'back-drag'); r.style.removeProperty('--page-x');
  pageX = 0;
  $('#under')?.remove();
}
// ------------------------------------------------------------------ the page layer
// Like Shirabe: the menu lies still underneath and the whole page (top bar, content, its background)
// slides right to reveal it, leaving a strip of the page you can tap or drag back. The same layer
// follows the finger on a swipe-back, with the previous page showing underneath.
const MOBILE_NAV = () => innerWidth < 1100;            // wider screens keep the menu as a sidebar
const drawerW = () => Math.round(Math.min(innerWidth * .74, 300));
const EASE_MS = { open: 400, close: 440 };             // closing is a touch slower, so it reads as one glide
let pageX = 0, drawerOpen = false, settleTimer = null;
function placePage(x, ms = 0) {
  clearTimeout(settleTimer);
  const r = document.documentElement;
  pageX = x;
  r.style.setProperty('--page-x', x + 'px');
  r.style.setProperty('--page-ms', (reducedMotion() ? 0 : ms) + 'ms');
  r.classList.add('page-moving');
}
function settlePage(x, ms, done) {
  placePage(x, ms);
  settleTimer = setTimeout(() => {
    if (x === 0) { const r = document.documentElement; r.classList.remove('page-moving', 'drawer-on'); r.style.removeProperty('--page-x'); }
    done?.();
  }, (reducedMotion() ? 0 : ms) + 30);
}
function openDrawer(ms = EASE_MS.open) {
  if (!MOBILE_NAV()) return;
  const r = document.documentElement;
  r.style.setProperty('--drawer-w', drawerW() + 'px');
  r.classList.add('drawer-on', 'drawer-open');
  drawerOpen = true; hideSuggest(); qInput().blur();
  settlePage(drawerW(), ms);
}
function closeDrawer(ms = EASE_MS.close) {
  if (!drawerOpen && !pageX) return;
  drawerOpen = false;
  document.documentElement.classList.remove('drawer-open');
  settlePage(0, ms);
}
// how long a release should take: the rest of the distance at the finger's speed, within sensible bounds
const releaseMs = (dist, v, max) => Math.round(Math.max(180, Math.min(max, Math.abs(dist) / Math.max(Math.abs(v), .8) * 1.4)));

// ------------------------------------------------------------------ router + transitions
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
  [/^#\/x\/(\d+)$/, (m) => viewSentence(m[1])],
  [/^#\/examples(?:\/(.*))?$/, (m) => viewExamples(m[1] ? decodeURIComponent(m[1]) : '')],
  [/^#\/settings$/, () => viewSettings()],
  [/^#\/about$/, () => viewAbout()],
];
const depth = (hash) => /^#\/(w|x)\//.test(hash) ? 2 : /^#\/(list|builtin|review)\//.test(hash) ? 1 : 0;
const isSearchHash = (hash) => /^#?\/?(s\/.*)?$/.test(hash);
const navStack = [location.hash || '#/'];
const scrollMem = new Map();
let lastHash = location.hash || '#/';
let currentCleanup = null;
let routeSeq = 0;   // each navigation gets a number; slower, superseded renders bail out
let restoreY = 0;   // going back: the scroll position to return to, so long lists render far enough to reach it
// the app restores scroll itself; the browser's own restore would jump the old page before the transition captures it
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

async function route() {
  routeSeq++;
  delete document.body.dataset.page;
  hideSuggest();
  currentCleanup?.(); currentCleanup = null;
  $('#pager').hidden = true;
  view().onclick = null;
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const top = '#/' + (hash.split('/')[1] || '');
    $$('#drawer a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === (isSearchHash(hash) ? '#/' : top)));
    if (!isSearchHash(hash) && !/^#\/w\//.test(hash)) { qInput().value = ''; $('#clearQ').hidden = true; }
    try { await fn(m); } catch (e) { console.error(e); view().innerHTML = `<div class="empty">Something went wrong: ${h(e.message)}</div>`; }
    watchLargeTitle();
    return;
  }
  nav('#/');
}

// A back made with the browser's own swipe (Safari in a tab) has already been animated by the browser;
// playing ours after it would show the move twice. Browsers that know say so with hasUAVisualTransition;
// Safari tabs that don't are recognised by a finger dragging in from the left edge (a tap on the back
// button never counts). The Home Screen app gives the system nothing to swipe back to (OWN_HISTORY).
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Safari on iPhone/iPad in a browser tab has its own swipe-back on the left edge; the Home Screen app doesn't
const BROWSER_EDGE = !STANDALONE && (/iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
// The Home Screen app on iOS has a system swipe-back of its own (iOS 26) that drags in a screenshot of
// the previous history entry, fighting the app's gesture and showing stale screens (often with the menu
// open). So on touch devices the Home Screen app keeps a single history entry: every step replaces it,
// the app's own navStack is the only back stack, and the system gesture has nowhere to go.
const OWN_HISTORY = STANDALONE && navigator.maxTouchPoints > 0;
function nav(hash) { if (OWN_HISTORY) location.replace(hash); else location.hash = hash; }
let skipAnim = false, browserSwipeAt = -1e9, expectBack = false, linkTapAt = -1e9;
document.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) linkTapAt = performance.now(); }, true);
if (OWN_HISTORY) document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented || a.target || a.hasAttribute('download')) return;
  e.preventDefault(); nav(a.getAttribute('href'));
});
addEventListener('popstate', (e) => {
  skipAnim = !!e.hasUAVisualTransition || (BROWSER_EDGE && performance.now() - browserSwipeAt < 800);
});

// A picture of each page as it's left (its markup, scroll and top-bar state), shown underneath while a
// swipe-back drags the current page away, so the finger uncovers the page it's going back to.
const snaps = new Map();
function snapshotPage(hash) {
  const b = document.body;
  snaps.set(hash, { top: $('.topbar').innerHTML, view: view().outerHTML, q: qInput().value, y: scrollY,
    cls: ['has-search', 'hero-visible', 'scrolled', 'root'].filter(c => b.classList.contains(c)).join(' '), page: b.dataset.page || '' });
  if (snaps.size > 24) snaps.delete(snaps.keys().next().value);
}
let swipeBack = false;
async function onHashChange() {
  const hash = location.hash || '#/';
  const fromSwipe = swipeBack; swipeBack = false;
  const fromDrawer = drawerOpen;
  const instant = skipAnim || fromSwipe || fromDrawer; skipAnim = false;
  snapshotPage(lastHash);
  scrollMem.set(lastHash, scrollY);
  let dir;
  // a real step back (the back button, a swipe, the browser's back) pops; following a link to the page
  // you came from is a new step forward, or the next back would go the wrong way
  const isBack = expectBack || performance.now() - linkTapAt > 400;
  expectBack = false;
  if (isBack && navStack.length > 1 && navStack[navStack.length - 2] === hash) { navStack.pop(); dir = 'back'; }
  else {
    navStack.push(hash);
    const a = depth(lastHash), b = depth(hash);
    dir = b > a || (b === 2 && a === 2) ? 'forward' : b < a ? 'back' : 'fade';
  }
  lastHash = hash;
  const y = dir === 'back' ? (scrollMem.get(hash) || 0) : 0;
  await transition(instant ? 'none' : dir, hash, async () => {
    restoreY = y;
    try { await route(); } finally { restoreY = 0; }
    window.scrollTo(0, y);
  });
  // the new page is drawn: a finished swipe-back drops the picture underneath in the same frame; a
  // choice from the menu glides the page (already showing the new screen) back over the menu
  if (fromSwipe) endBackDrag();
  if (fromDrawer) requestAnimationFrame(() => closeDrawer());
}
// The data a page needs, loaded before the transition starts. A view transition freezes the screen
// while its callback runs, so a first visit that fetches and parses JSON inside it looks like a stuck
// tap followed by a jump. Loading first keeps the old page live; once cached, this resolves at once.
function preload(hash) {
  const p = [];
  const w = hash.match(/^#\/w\/(-?\d+)/);
  if (w) p.push(db.entry(+w[1]), sents(), db.lists());
  else if (/^#\/x\//.test(hash)) p.push(sents(), db.formsReady());
  else if (/^#\/(list|builtin|cards|review)/.test(hash)) p.push(db.lists(), sents());
  else if (/^#\/examples/.test(hash)) p.push(sents());
  else if (/^#\/s\//.test(hash) && !db.formsLoaded()) p.push(db.formsReady());
  if (!p.length) return null;
  return Promise.race([Promise.allSettled(p), new Promise(r => setTimeout(r, 4000))]);
}
let navSeq = 0, activeVT = null;
async function transition(dir, hash, fn) {
  const my = ++navSeq;
  const pre = preload(hash);
  if (pre) {
    // normally everything is already loaded (warmUp) and this resolves at once; on a cold first visit
    // the current page dims slightly after a moment so the tap visibly registered
    const dim = setTimeout(() => document.body.classList.add('nav-wait'), 120);
    await pre; clearTimeout(dim); document.body.classList.remove('nav-wait');
    if (my !== navSeq) return;   // a newer navigation took over while loading
  }
  const root = document.documentElement;
  if (dir === 'none' || !document.startViewTransition || !document.body.classList.contains('ready')) { root.classList.remove('vt'); return fn(); }
  root.dataset.nav = reducedMotion() ? 'fade' : dir;   // reduced motion keeps the crossfade, drops the movement
  root.classList.add('vt');
  // the data is loaded, so the page is fully built before the new snapshot is taken: never half-drawn
  const t = document.startViewTransition(fn);
  activeVT = t;
  t.ready.catch(() => {}); t.updateCallbackDone.catch(() => {});   // skipped when a newer navigation starts
  try { await t.finished; } catch {}
  if (my === navSeq) root.classList.remove('vt');
}
// replace the current page (used by the prev/next result arrows)
async function go(hash, dir, replace = false) {
  scrollMem.set(lastHash, scrollY);
  if (replace) { history.replaceState(null, '', hash); navStack[navStack.length - 1] = hash; }
  else { history[OWN_HISTORY ? 'replaceState' : 'pushState'](null, '', hash); navStack.push(hash); }
  lastHash = hash;
  await transition(dir, hash, async () => { await route(); window.scrollTo(0, 0); });
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
      if (isSearchHash(location.hash || '#/')) { history.replaceState(null, '', target); navStack[navStack.length - 1] = target; lastHash = target; route(); }
      else nav(target);
    }, 120);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); store.addSearch(q.value); hideSuggest(); q.blur(); }
    if (e.key === 'Escape') { q.value = ''; q.dispatchEvent(new Event('input')); }
    if (e.key === 'ArrowDown') { const s = $('#suggest li'); if (s) { e.preventDefault(); s.focus(); } }
  });
  q.addEventListener('focus', () => { document.body.classList.add('typing'); showSuggest(q.value); });
  q.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== q) { document.body.classList.remove('typing'); hideSuggest(); } }, 180));
  $('#clearQ').addEventListener('click', () => { q.value = ''; q.dispatchEvent(new Event('input')); q.focus(); });
  $('#pasteBtn').addEventListener('click', async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return toast('Clipboard is empty');
      if (t.split(/\s+/).length > 3) { sessionStorage.setItem('reader', t); nav('#/reader'); return; }
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
  const items = v.trim() ? db.suggest(v, 6) : store.S().searches.slice(0, 6);
  if (document.activeElement !== qInput() || !items.length || (items.length === 1 && items[0] === v)) return hideSuggest();
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

// ------------------------------------------------------------------ rows
function artOf(r) { return r.pos === 'n' && r.g ? articleFor(r.g) : r.pos === 'v' ? 'å' : ''; }
function resultRow(id, extra = '', href = null) {
  const r = db.row(id);
  if (!r) return '';
  const art = artOf(r);
  const gloss = r.en ? h(r.en) : r.no ? `<span class="nogloss">${h(r.no)}</span>` : '';
  const short = POS_SHORT[r.pos];
  return `<a class="res" href="${href || '#/w/' + id}" data-id="${id}">
    <div class="res-head">${art ? `<span class="art">${art}</span>` : ''}<span class="lem">${h(r.lemmas.join(' / '))}</span>${r.hg ? `<sup class="hg">${r.hg}</sup>` : ''}${r.ipa ? `<span class="ipa-s">/${h(r.ipa)}/</span>` : ''}</div>
    <div class="res-gloss">${short ? `<span class="res-pos">${short}</span> ` : ''}${gloss}</div>${extra}</a>`;
}
function rowsHTML(ids) { return ids.map(id => resultRow(id)).join(''); }

// Example sentences can be saved like words. In lists and decks they are stored as "x<sentence id>".
const isSent = (id) => typeof id === 'string' && id[0] === 'x';
let SENTS = null;
async function sents() { return SENTS ||= await db.sentences(); }
function sentRow(key, extra = '') {
  const sid = key.slice(1), x = SENTS?.[sid];
  if (!x) return '';
  return `<a class="res sres" href="#/x/${sid}"><div class="sres-no" lang="nb">${h(x[0])}</div><div class="res-gloss">${h(x[1][0])}</div>${extra}</a>`;
}
function sentCell(key) {
  const sid = key.slice(1), x = SENTS?.[sid];
  return x ? `<a class="wcell scell" href="#/x/${sid}"><b lang="nb">${h(x[0])}</b><span>${h(x[1][0])}</span></a>` : '';
}
// Shown under example sentences until the reader has opened one by holding it
function holdHint() {
  try { if (localStorage.getItem('oppslag.heldSentence')) return ''; } catch {}
  return '<p class="hold-hint">Press and hold a sentence to open it on its own page, with its words and a save button.</p>';
}
// Split Norwegian text into dictionary words, preferring two- and three-word expressions
function analyse(text) {
  const toks = [...text.matchAll(/[A-Za-zÆØÅæøåÉéÈèÊêÓóÒòÔôÜüÄäÖö]+(?:[-'][A-Za-zÆØÅæøå]+)*/g)];
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    let m = null;
    for (const len of [3, 2]) {
      if (k + len > toks.length) continue;
      const phrase = toks.slice(k, k + len).map(t => t[0]).join(' ');
      const ids = db.byLemma(phrase);
      if (ids.length) { m = { tok: phrase, ids, len, at: k }; break; }
    }
    if (!m) m = { tok: toks[k][0], ids: db.lookupToken(toks[k][0]), len: 1, at: k };
    out.push(m); k += m.len - 1;
  }
  return { toks, groups: out };
}
function rememberResults(ids) { try { sessionStorage.setItem('results', JSON.stringify(ids.slice(0, 300))); } catch {} }
const pageTitle = (t) => `<h1 class="page-title">${h(t)}</h1>`;
// iOS large-title behaviour: the bar shows the page's title only once the big one has scrolled away
let titleObserver = null;
function watchLargeTitle() {
  titleObserver?.disconnect(); titleObserver = null;
  const el = $('.page-title, .home-title, .w-word');
  document.body.classList.toggle('hero-visible', !!el);
  if (!el) return;
  titleObserver = new IntersectionObserver(([en]) => document.body.classList.toggle('hero-visible', en.isIntersecting), { rootMargin: '-60px 0px 0px 0px' });
  titleObserver.observe(el);
}
function bandHTML(title, no = '', extra = '') { return `<div class="band"><span>${h(title)}${no ? ` <span class="no">${h(no)}</span>` : ''}</span>${extra}</div>`; }

// render long lists progressively so typing stays smooth
function progressive(container, ids, renderFn, first = 40, step = 80) {
  container.innerHTML = ids.slice(0, first).map(renderFn).join('');
  let shown = first;
  // coming back to a long list: render enough rows to reach the saved scroll position
  while (restoreY && shown < ids.length && container.getBoundingClientRect().bottom + scrollY < restoreY + innerHeight) {
    container.insertAdjacentHTML('beforeend', ids.slice(shown, shown + step).map(renderFn).join(''));
    shown += step;
  }
  if (shown >= ids.length) return;
  const sentinel = document.createElement('div');
  container.after(sentinel);
  const io = new IntersectionObserver((ents) => {
    if (!ents[0].isIntersecting) return;
    container.insertAdjacentHTML('beforeend', ids.slice(shown, shown + step).map(renderFn).join(''));
    shown += step;
    if (shown >= ids.length) { io.disconnect(); sentinel.remove(); }
  }, { rootMargin: '600px' });
  io.observe(sentinel);
  const prev = currentCleanup; currentCleanup = () => { prev?.(); io.disconnect(); };
}

// ------------------------------------------------------------------ HOME / SEARCH
const GROUP_LABEL = { exact: 'Exact matches', exact2: 'Also spelled this way', form: 'Inflected forms', en: 'English → Norwegian', prefix: 'Starting with', contains: 'Containing', wild: 'Wildcard matches' };
async function viewHome(q) {
  setNav({ title: 'Ordbok', search: true, right: `<button class="pill-btn" id="toLists">Lists</button>` });
  $('#toLists').onclick = () => { nav('#/builtin'); };
  if (qInput().value !== q && document.activeElement !== qInput()) qInput().value = q;
  $('#clearQ').hidden = !qInput().value;
  document.title = q ? `${q} – Oppslag` : 'Oppslag';
  if (!q.trim()) return viewHomeEmpty();
  if (!db.formsLoaded()) {
    const my = routeSeq;
    await db.formsReady().catch(() => {});
    if (my !== routeSeq) return;
  }
  const t0 = performance.now();
  const res = db.search(q);
  const ms = Math.round(performance.now() - t0);
  if (!res.length) {
    view().innerHTML = `<div class="empty"><p>No results for <b>${h(q)}</b>.</p>
      <p class="small">Type <kbd>aa</kbd> <kbd>ae</kbd> <kbd>oe</kbd> for å æ ø · use <kbd>*</kbd> and <kbd>?</kbd> as wildcards · search in English to find Norwegian words.</p>
      <p><a class="btn" href="#/examples/${encodeURIComponent(q)}">${ICON.quote} Search example sentences</a></p></div>`;
    return;
  }
  // group rows; each group gets a quiet band like Shirabe's section headers
  const items = []; let last = '';
  for (const r of res) {
    if (r.kind !== last) { items.push({ band: GROUP_LABEL[r.kind] }); last = r.kind; }
    items.push(r);
  }
  const render = (it) => {
    if (it.band) return bandHTML(it.band);
    const extra = it.kind === 'form' ? `<div class="res-note" data-form="${h(it.form)}" data-id="${it.id}">${ICON.arrow}<span><b>${h(it.form)}</b></span></div>` : '';
    return resultRow(it.id, extra, `#/w/${it.id}${it.kind === 'form' ? '?f=' + encodeURIComponent(it.form) : ''}`);
  };
  const words = q.trim().split(/\s+/);
  view().innerHTML = `${words.length > 2 ? `<a class="banner" href="#/reader" id="toReader">${ICON.reader} Break this sentence into words</a>` : ''}
    <div class="results" id="results"></div><div class="foot">${res.length} results · ${ms} ms</div>`;
  progressive($('#results'), items, render, 45, 80);
  rememberResults(res.map(r => r.id));
  $('#toReader')?.addEventListener('click', () => sessionStorage.setItem('reader', q));
  for (const el of $$('.res-note[data-form]')) {
    db.entry(+el.dataset.id).then(e => {
      const sl = e && slotsOf(e, el.dataset.form);
      if (sl?.length) el.innerHTML = `${ICON.arrow}<span><b>${h(el.dataset.form)}</b> · ${h(sl.join(', '))}</span>`;
    }).catch(() => {});
  }
  view().onclick = (ev) => { if (ev.target.closest('.res')) store.addSearch(q); };
}

function viewHomeEmpty() {
  const day = new Date().toISOString().slice(0, 10);
  const wotd = db.randomCommon(day);
  const w = db.row(wotd);
  const hist = store.S().history.slice(0, 5);
  const m = db.meta();
  const tile = (href, cls, icon, title, sub) => `<a class="tile4 ${cls}" href="${href}">${ICON[icon]}<div><b>${title}</b><span>${sub}</span></div></a>`;
  view().innerHTML = `
    <h1 class="home-title">Ordbok.<span class="sub">Slå opp et ord.</span></h1>
    ${w ? `<a class="wotd" href="#/w/${wotd}"><div class="wotd-label">Word of the day</div>
      <div class="wotd-word">${artOf(w) ? `<span class="art">${h(artOf(w))}</span>` : ''}${h(w.lemmas[0])}</div>
      ${w.ipa ? `<div class="wotd-ipa">/${h(w.ipa)}/</div>` : ''}<div class="wotd-gloss">${h((w.en || w.no).split('; ').slice(0, 2).join('; '))}</div>
      <div class="wotd-foot"><span>${h(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>${ICON.arrow}</div></a>` : ''}
    <div class="tiles4">
      ${tile('#/builtin', 't-sage', 'list', 'Word lists', 'Curated sets')}
      ${tile('#/cards', 't-mustard', 'cards', 'Flashcards', 'Spaced repetition')}
      ${tile('#/reader', 't-plum', 'reader', 'Reader', 'Whole sentences')}
      ${tile('#/lists', 't-rose', 'bookmark', 'Bookmarks', 'Saved words')}
    </div>
    ${hist.length ? bandHTML('Recently viewed', '', '<a href="#/history" class="more">See all</a>') + rowsHTML(hist.map(x => x.id)) : ''}
    ${bandHTML('Ways to search')}
    <ul class="tips">
      <li>Norwegian or English: <a href="#/s/hus">hus</a>, <a href="#/s/house">house</a></li>
      <li>Any form finds its word: <a href="#/s/gikk">gikk</a> → gå, <a href="#/s/bøkene">bøkene</a> → bok</li>
      <li>No æ ø å keys? Type <kbd>ae</kbd> <kbd>oe</kbd> <kbd>aa</kbd>: <a href="#/s/blaabaer">blaabaer</a></li>
      <li>Wildcards: <a href="#/s/*hus">*hus</a>, <a href="#/s/b%3Fk">b?k</a>. Paste a sentence to break it into words.</li>
    </ul>
    <div class="foot">${m.entries.toLocaleString()} entries · ${m.withEnglish.toLocaleString()} with English · ${m.sentences.toLocaleString()} example sentences</div>`;
  rememberResults([wotd, ...hist.map(x => x.id)]);
}

// ------------------------------------------------------------------ ENTRY (word page; design tokens in CLAUDE.md)
// Sections that sit in the side column on desktop. On phones everything is one column in the user's order.
const ASIDE = new Set(['pron', 'inf']);   // desktop reference panel, kept in view while reading
const GENDER_WORD = { m: 'masculine', f: 'feminine', n: 'neuter' };

async function viewEntry(id, fromForm) {
  const my = routeSeq;
  const r = db.row(id);
  const e = await db.entry(id);
  if (my !== routeSeq) return;
  if (!e || !r) { setNav({ title: '', back: '#/' }); view().innerHTML = '<div class="empty">Entry not found.</div>'; return; }
  store.addHistory(id);
  const lemma = e.l[0];
  document.title = `${lemma} – Oppslag`;
  document.body.dataset.page = 'word';
  const fav = store.inList('fav', id);
  setNav({ title: lemma, back: '#/', right: `<button class="round ${fav ? 'on' : ''}" id="favBtn" aria-label="${fav ? 'Remove from Favourites' : 'Add to Favourites'}">${fav ? ICON.starFill : ICON.star}</button><button class="round" id="listBtn" aria-label="Save to a list">${ICON.bookmark}</button>` });
  const s = store.settings();
  const order = s.sections.filter(k => !s.hidden.includes(k));
  const sections = { pron: wPron, en: wEnglishSection, no: wDefinition, fx: wExpressions, inf: wForms, cmp: wCompound, ex: wExamples, ety: wOrigin, rel: wRelated, note: wNote, src: wSources };
  // English meanings belong under the headword unless the user moved them further down
  const enInHero = order.indexOf('en') !== -1 && order.indexOf('en') <= 1;
  const main = [], aside = [];
  let n = 0;
  for (const k of order) {
    if (!sections[k] || (k === 'en' && enInHero)) continue;
    const html = await sections[k](e, r);
    if (!html) continue;
    (ASIDE.has(k) ? aside : main).push(`<section class="w-sec" data-sec="${k}" style="order:${n++}">${html}</section>`);
  }
  if (my !== routeSeq) return;
  view().innerHTML = `<article class="wpage">${wHero(e, r, fromForm, enInHero)}
    <div class="w-cols"><div class="w-main">${main.join('')}</div><aside class="w-aside">${aside.join('')}</aside></div></article>`;
  wireEntry(e, r);
  setupPager(id);
}

function wKicker(r, e) {
  const bits = [];
  if (POS[r.pos]) bits.push(POS[r.pos]);
  if (r.pos === 'n' && r.g) bits.push([...r.g].map(c => GENDER_WORD[c]).join(' or '));
  const no = POS_NO[r.pos];
  return `${h(bits.join(', ') || 'word')}${no && no !== POS[r.pos] ? ` <span class="w-kicker-no">· ${h(no)}</span>` : ''}`;
}

// Each word class gets one of the four colour fields (noun mustard, verb sage, adjective plum, other rose)
const fieldOf = (pos) => pos === 'n' ? 'f-mustard' : pos === 'v' ? 'f-sage' : pos === 'a' ? 'f-plum' : 'f-rose';
function wHero(e, r, fromForm, enInHero) {
  const lemma = e.l[0];
  const art = artOf(r);
  const slots = fromForm ? slotsOf(e, fromForm) : [];
  const formNote = fromForm && fromForm.toLowerCase() !== lemma.toLowerCase()
    ? `<p class="w-from">You searched <b>${h(fromForm)}</b>${slots.length ? `, the ${h(slots.join(' / ').toLowerCase())} of` : ', a form of'}</p>` : '';
  const meta = [];
  if (r.rank && r.rank <= COMMON_RANK) meta.push('Common word');
  if (r.rank) meta.push(`Frequency rank ${r.rank.toLocaleString()}`);
  if (e.cls?.includes('strong')) meta.push('Irregular verb');
  if (e.cls?.includes('sverb')) meta.push('S-verb');
  if (e.cls?.includes('irrplural')) meta.push('Irregular plural');
  if (r.wk) meta.push('From Wiktionary only');
  const tone = e.tone ? `<a class="w-tone" href="#tone" data-jump="pron" title="Norwegian pitch accent">Tone ${e.tone}</a>` : '';
  return `<header class="w-hero ${fieldOf(r.pos)}">
    ${formNote}
    <p class="w-kicker">${wKicker(r, e)}</p>
    <div class="w-hero-body">
      <h1 class="w-word">${art ? `<span class="w-art">${h(art)}</span>` : ''}${h(e.l.join(' / '))}${e.hg ? `<sup class="w-hg" title="Homograph ${e.hg}: one of several words spelled ${h(lemma)}">${e.hg}</sup>` : ''}</h1>
      ${e.ipa || tone ? `<div class="w-say">${e.ipa ? `<span class="w-ipa">/${h(e.ipa)}/</span>` : ''}${e.ipa && tone ? '<span class="sep">·</span>' : ''}${tone}</div>` : ''}
      ${ttsAvailable() ? `<button class="pill-out w-listen" data-say="${h(lemma)}" aria-label="Listen to ${h(lemma)}"><span>Listen</span>${ICON.arrow}</button>` : ''}
    </div>
  </header>
  ${meta.length ? `<p class="w-meta">${meta.map(h).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
  ${enInHero ? `<div class="w-meanings">${wEnglishBody(e, r)}</div>` : ''}`;
}

const eyebrow = (label, source = '') => `<h2 class="w-eyebrow">${h(label)}${source ? `<span class="w-src"> · ${h(source)}</span>` : ''}</h2>`;

function wEnglishBody(e, r) {
  if (e.en?.length) {
    let html = '<ol class="w-senses">' + e.en.map(s => `<li><span class="w-gl">${h(s.g)}</span>${s.t ? ` <span class="w-lab">${s.t.map(h).join(', ')}</span>` : ''}
      ${(s.x || []).map(x => `<p class="w-ex"><span class="w-ex-no" lang="nb">${h(x[0])}</span>${ttsAvailable() ? `<button class="w-speak small" data-say="${h(x[0])}" aria-label="Listen">${ICON.speaker}</button>` : ''}<span class="w-ex-en">${h(x[1])}</span></p>`).join('')}</li>`).join('') + '</ol>';
    if (e.ens) html += `<p class="w-aside-note">These English meanings cover every ${h(POS[r.pos] || 'word')} spelled “${h(e.l[0])}”; Wiktionary doesn’t separate them. The definition below is specific to this one.</p>`;
    if (e.ensrc === 'tr') html += '<p class="w-aside-note">From English Wiktionary entries that give this word as their Norwegian translation.</p>';
    return html;
  }
  if (e.cmp) {
    const parts = [e.cmp[0], e.cmp[2]].map(p => {
      const ids = db.byLemma(p); const pr = ids.length ? db.row(ids[0]) : null;
      return `<a href="${ids.length ? '#/w/' + ids[0] : '#/s/' + encodeURIComponent(p)}">${h(p)}</a>${pr?.en ? ` (${h(pr.en.split('; ')[0])})` : ''}`;
    });
    return `<p class="w-aside-note">No English entry yet. It’s a compound of ${parts.join(' + ')}.</p>`;
  }
  return '<p class="w-aside-note">No English translation in the open dictionaries. The Norwegian definition is below.</p>';
}
function wEnglishSection(e, r) { return eyebrow('Meanings') + wEnglishBody(e, r); }

function wDefs(defs, depth = 0) {
  return `<ol class="w-defs d${depth}">` + defs.map(d => {
    let li = '';
    if (d.e) li += `<p class="w-def">${d.e.map(rich).join('; ')}</p>`;
    if (d.x) li += `<ul class="w-uses">${d.x.map(x => `<li lang="nb">${rich(x[0])}${x[1] ? ` <span class="w-use-gloss">– ${rich(x[1])}</span>` : ''}</li>`).join('')}</ul>`;
    if (d.c) li += `<p class="w-also">${d.ci ? rich(d.ci) + ': ' : ''}${d.c.map(c => `<a class="xref" href="#/w/${c[1]}">${h(c[0])}</a>`).join(', ')}</p>`;
    if (d.d) li += wDefs(d.d, depth + 1);
    return `<li>${li}</li>`;
  }).join('') + '</ol>';
}
function wDefinition(e) {
  if (!e.d?.length) return '';
  return eyebrow('Definition', 'Bokmålsordboka') + `<div lang="nb">${wDefs(e.d)}</div>`;
}
function wExpressions(e) {
  if (!e.fx?.length) return '';
  return eyebrow('Fixed expressions') + '<ul class="w-fx">' + e.fx.map(x => `<li><p class="w-fx-l" lang="nb">${h(x.l)}</p>${wDefs(x.d)}</li>`).join('') + '</ul>';
}

function wPron(e) {
  if (!e.ipa && !e.bp) return '';
  const s = store.settings();
  let html = eyebrow('Pronunciation');
  if (e.tone && s.showTone && e.ipa) {
    const name = e.tone === 1 ? 'Tone 1, single tone' : 'Tone 2, double tone';
    html += `<div class="w-tonebox" id="tone"><div class="w-contour">${toneSVG(e.ipa, e.tone)}</div>
      <p class="w-tonename">${name}</p>
      <details class="w-help"><summary>What is tone?</summary><p>${h(TONE_HELP[e.tone])}</p></details></div>`;
  }
  if (e.ipa2?.length) html += `<p class="w-small">Also pronounced ${e.ipa2.map(x => `<span class="w-ipa-s">/${h(x)}/</span>`).join(', ')}</p>`;
  if (e.bp) html += `<p class="w-small">Bokmålsordboka: ${rich(e.bp)}</p>`;
  if (e.ipa) html += '<p class="w-fine">Urban East Norwegian · NB Uttale</p>';
  return html;
}

function wForm(cell, pcell, showIpa, prefix = '', suffix = '') {
  if (!cell) return '<span class="w-none">—</span>';
  const ws = cell.split('/'); const ps = (pcell || '').split('/');
  return ws.map((w, k) => {
    const alt = w.startsWith('~'); const word = w.replace(/^~/, '');
    const [ipa, tone] = (ps[k] || '').split('|');
    return `<button class="w-form ${alt ? 'alt' : ''}" data-say="${h(prefix + word)}" ${alt ? 'title="Registered, but not the standard form"' : ''}><span class="w-form-w" lang="nb">${h(prefix + word + suffix)}</span>${showIpa && ipa ? `<span class="w-form-ipa">/${h(ipa)}/${tone ? `<sup>${tone}</sup>` : ''}</span>` : ''}</button>`;
  }).join('');
}
function wForms(e) {
  if (!e.inf) return '';
  const k = e.inf.k, f = e.inf.f, p = e.infp || [];
  const showIpa = store.settings().showFormIpa;
  const row = (label, cell, pc, pre, suf) => `<div class="w-frow"><span class="w-flabel">${h(label)}</span><span class="w-fval">${wForm(cell, pc, showIpa, pre, suf)}</span></div>`;
  let html = eyebrow(k === 'v' || k === 'vs' ? 'Conjugation' : 'Forms');
  if (k === 'n') {
    html += `<div class="w-ngrid">
      <span></span><span class="w-flabel">Indefinite</span><span class="w-flabel">Definite</span>
      <span class="w-flabel">Singular</span><span>${wForm(f[0], p[0], showIpa)}</span><span>${wForm(f[1], p[1], showIpa)}</span>
      <span class="w-flabel">Plural</span><span>${wForm(f[2], p[2], showIpa)}</span><span>${wForm(f[3], p[3], showIpa)}</span></div>`;
  } else if (k === 'v' || k === 'vs') {
    html += '<div class="w-flist">' + row('Infinitive', f[0], p[0], 'å ') + row('Present', f[1], p[1]) + row('Past', f[2], p[2]) +
      row('Perfect', f[3], p[3], 'har ') + row('Imperative', f[4], p[4], '', '!') + '</div>';
    if (k === 'v') {
      const L = SLOT_LABELS.v;
      const more = [5, 6, 7, 8, 9, 10, 11].filter(j => f[j]).map(j => row(L[j][0] + (L[j][1] ? ', ' + L[j][1] : ''), f[j], p[j])).join('');
      if (more) html += `<details class="w-more"><summary>Passive and participles</summary><div class="w-flist">${more}</div></details>`;
    }
  } else {
    html += '<div class="w-flist">' + SLOT_LABELS[k].map((l, j) => f[j] ? row(l[0] + (l[1] ? ', ' + l[1] : ''), f[j], p[j]) : '').join('') + '</div>';
  }
  const notes = [];
  if (showIpa && (e.infp || []).some(x => x && x.includes('|'))) notes.push('Small numbers mark tone 1 or tone 2.');
  if (f.some(c => c && c.includes('~'))) notes.push('Faded forms are registered but not standard.');
  notes.push('Tap a form to hear it.');
  return html + `<p class="w-fine">${notes.join(' ')}</p>`;
}

function wCompound(e) {
  let html = '';
  if (e.cmp) {
    const [a, joint, b] = e.cmp;
    const part = (p) => { const ids = db.byLemma(p); const r = ids.length ? db.row(ids[0]) : null;
      return `<a class="w-part" href="${ids.length ? '#/w/' + ids[0] : '#/s/' + encodeURIComponent(p)}"><span class="w-part-w" lang="nb">${h(p)}</span>${r?.en || r?.no ? `<span class="w-part-g">${h((r.en || r.no).split('; ')[0])}</span>` : ''}</a>`; };
    html += `<div class="w-parts">${part(a)}<span class="w-plus" ${joint ? 'title="Linking letter between the parts (fuge)"' : ''}>+${joint ? ` ${h(joint)} +` : ''}</span>${part(b)}</div>`;
  }
  const c = db.compoundsOf(e.l[0], 12);
  const links = (ids) => ids.map(id => `<a href="#/w/${id}" lang="nb">${h(db.row(id).lemmas[0])}</a>`).join(', ');
  if (!e.l[0].includes(' ')) {
    if (c.first.length) html += `<p class="w-small"><span class="w-label">Starting with ${h(e.l[0])}:</span> ${links(c.first)}</p>`;
    if (c.last.length) html += `<p class="w-small"><span class="w-label">Ending with ${h(e.l[0])}:</span> ${links(c.last)}</p>`;
  }
  return html ? eyebrow(e.cmp ? 'Made from' : 'Compounds') + html : '';
}

async function wExamples(e) {
  if (!e.ts?.length) return '';
  const S = await db.sentences();
  const forms = new Set(e.l.map(x => x.toLowerCase()));
  (e.inf?.f || []).forEach(c => c && c.split('/').forEach(w => forms.add(w.replace(/^~/, '').toLowerCase())));
  const mark = (t) => h(t).replace(/[A-Za-zÆØÅæøåéèêóòôüäö'-]+/g, (w) => forms.has(w.toLowerCase()) ? `<b>${w}</b>` : w);
  const items = e.ts.filter(id => S[id]).map(id => `<li data-sent="${id}"><p class="w-ex-no" lang="nb">${mark(S[id][0])}${ttsAvailable() ? `<button class="w-speak small" data-say="${h(S[id][0])}" aria-label="Listen">${ICON.speaker}</button>` : ''}</p><p class="w-ex-en">${h(S[id][1][0])}</p></li>`);
  return eyebrow('Examples', 'Tatoeba') + holdHint() + `<ul class="w-sents">${items.slice(0, 4).join('')}</ul>` +
    (items.length > 4 ? `<details class="w-more"><summary>${items.length - 4} more examples</summary><ul class="w-sents">${items.slice(4).join('')}</ul></details>` : '');
}

function wOrigin(e) {
  if (!e.ety && !e.etyen) return '';
  return eyebrow('Word origin') + (e.ety ? `<p class="w-body" lang="nb">${rich(e.ety)}</p>` : '') + (e.etyen ? `<p class="w-small">${h(e.etyen)}</p>` : '');
}

async function wRelated(e) {
  const bits = [];
  const link = (w) => { const ids = db.byLemma(w); return `<a href="${ids.length ? '#/w/' + ids[0] : '#/s/' + encodeURIComponent(w)}" lang="nb">${h(w)}</a>`; };
  if (e.syn?.length) bits.push(`<p class="w-small"><span class="w-label">Similar:</span> ${e.syn.map(link).join(', ')}</p>`);
  if (e.ant?.length) bits.push(`<p class="w-small"><span class="w-label">Opposite:</span> ${e.ant.map(link).join(', ')}</p>`);
  if (e.top?.length) {
    const L = await db.lists();
    const t = e.top.map(t => { const l = L.find(x => x.group === 'Topics' && x.name === t); return l ? `<a href="#/builtin/${encodeURIComponent(l.id)}">${h(t)}</a>` : ''; }).filter(Boolean).join(', ');
    if (t) bits.push(`<p class="w-small"><span class="w-label">Topic lists:</span> ${t}</p>`);
  }
  const mine = store.listsContaining(e.id);
  if (mine.length) bits.push(`<p class="w-small"><span class="w-label">In your lists:</span> ${mine.map(l => `<a href="#/list/${encodeURIComponent(l.id)}">${h(l.name)}</a>`).join(', ')}</p>`);
  return bits.length ? eyebrow('Related') + bits.join('') : '';
}

function wNote(e) {
  const n = store.note(e.id);
  return eyebrow('Your note') + `${n ? '' : '<button class="w-addnote" id="noteOpen">Add a note</button>'}<textarea id="noteBox" class="w-note" rows="2" placeholder="Write anything that helps you remember this word" ${n ? '' : 'hidden'}>${h(n)}</textarea>`;
}

function wSources(e) {
  const links = [];
  if (e.src === 'bo') links.push(`<a href="https://ordbokene.no/bm/${e.id}" target="_blank" rel="noopener">ordbøkene.no</a>`);
  links.push(`<a href="https://en.wiktionary.org/wiki/${encodeURIComponent(e.l[0])}#Norwegian_Bokm%C3%A5l" target="_blank" rel="noopener">Wiktionary</a>`);
  return eyebrow('Sources') + `<p class="w-fine">${e.src === 'bo' ? 'Definition and forms from Bokmålsordboka, Språkrådet and the University of Bergen (CC BY 4.0).' : 'This word is from Wiktionary only (CC BY-SA 4.0); it isn’t in Bokmålsordboka.'}${e.en ? ' English from Wiktionary (CC BY-SA 4.0).' : ''} Open in ${links.join(' or ')}.</p>`;
}

function setupPager(id) {
  let ids = [];
  try { ids = JSON.parse(sessionStorage.getItem('results') || '[]'); } catch {}
  const k = ids.indexOf(id);
  const pager = $('#pager');
  if (k < 0 || ids.length < 2) { pager.hidden = true; return; }
  pager.hidden = false;
  const prev = $('#prevRes'), next = $('#nextRes');
  prev.innerHTML = ICON.back; next.innerHTML = ICON.fwd;
  prev.disabled = k === 0; next.disabled = k === ids.length - 1;
  prev.onclick = () => k > 0 && go('#/w/' + ids[k - 1], 'back', true);
  next.onclick = () => k < ids.length - 1 && go('#/w/' + ids[k + 1], 'forward', true);
}

function wireEntry(e, r) {
  view().onclick = (ev) => {
    const j = ev.target.closest('[data-jump]');
    if (j) { ev.preventDefault(); const t = $(`[data-sec="${j.dataset.jump}"]`); t?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); t?.querySelector('details')?.setAttribute('open', ''); return; }
    const b = ev.target.closest('[data-say]'); if (b) { ev.preventDefault(); speak(b.dataset.say); }
  };
  wireSave(e.id);
  const nb = $('#noteBox');
  if (nb) {
    const grow = () => { nb.style.height = 'auto'; nb.style.height = nb.scrollHeight + 'px'; };
    if (!nb.hidden) grow();
    $('#noteOpen')?.addEventListener('click', () => { $('#noteOpen').remove(); nb.hidden = false; nb.focus(); grow(); });
    nb.addEventListener('input', () => { store.setNote(e.id, nb.value); grow(); });
  }
}

function saveButtons(key) {
  const fav = store.inList('fav', key);
  return `<button class="round ${fav ? 'on' : ''}" id="favBtn" aria-label="${fav ? 'Remove from Favourites' : 'Add to Favourites'}">${fav ? ICON.starFill : ICON.star}</button><button class="round" id="listBtn" aria-label="Save to a list">${ICON.bookmark}</button>`;
}
function wireSave(key) {
  $('#favBtn').onclick = () => {
    const on = store.toggleInList('fav', key);
    const b = $('#favBtn'); b.classList.toggle('on', on); b.innerHTML = on ? ICON.starFill : ICON.star;
    b.setAttribute('aria-label', on ? 'Remove from Favourites' : 'Add to Favourites');
    toast(on ? 'Added to Favourites' : 'Removed from Favourites');
  };
  $('#listBtn').onclick = () => listPicker(key);
}

// ------------------------------------------------------------------ SENTENCE PAGE (like Shirabe's)
async function viewSentence(sid) {
  const my = routeSeq;
  const S = await sents();
  await db.formsReady().catch(() => {});
  if (my !== routeSeq) return;
  const x = S[sid], key = 'x' + sid;
  if (!x) { setNav({ title: '', back: '#/' }); view().innerHTML = '<div class="empty">Sentence not found.</div>'; return; }
  document.title = `${x[0]} – Oppslag`;
  document.body.dataset.page = 'sentence';
  setNav({ title: 'Example sentence', back: '#/', right: saveButtons(key) });
  const { toks, groups } = analyse(x[0]);
  // the sentence itself, every known word a link to its entry
  const groupAt = new Map(); groups.forEach((g, gi) => { for (let k = 0; k < g.len; k++) groupAt.set(g.at + k, gi); });
  let html = '', pos = 0;
  toks.forEach((t, k) => {
    html += h(x[0].slice(pos, t.index));
    const g = groups[groupAt.get(k)];
    html += g?.ids.length ? `<a class="sx-w" href="#/w/${g.ids[0]}">${h(t[0])}</a>` : h(t[0]);
    pos = t.index + t[0].length;
  });
  html += h(x[0].slice(pos));
  const seen = new Set(), words = [];
  for (const g of groups) { if (!g.ids.length || seen.has(g.ids[0])) continue; seen.add(g.ids[0]); words.push(g.ids[0]); }
  view().innerHTML = `<article class="sx">
    <header class="sx-hero">
      <h1 class="sx-no" lang="nb">${html}</h1>
      <div class="sx-tools">${ttsAvailable() ? `<button class="pill-out" data-say="${h(x[0])}"><span>Listen</span>${ICON.arrow}</button>` : ''}<button class="pill-out" id="sxCopy"><span>Copy</span>${ICON.copy}</button></div>
    </header>
    <div class="sx-en">${x[1].map((t, k) => `<p class="${k ? 'sx-alt' : ''}">${h(t)}</p>`).join('')}</div>
    <section class="sx-words"><h2 class="w-eyebrow">Words in this sentence</h2><div class="results">${rowsHTML(words)}</div></section>
    <p class="w-fine sx-src">Sentence ${h(sid)} from <a href="https://tatoeba.org/en/sentences/show/${h(sid)}" target="_blank" rel="noopener">Tatoeba</a> (CC BY 2.0 FR). Tap a word above to open it.</p>
  </article>`;
  rememberResults(words);
  wireSave(key);
  $('#sxCopy').onclick = async () => { try { await navigator.clipboard.writeText(`${x[0]}\n${x[1][0]}`); toast('Sentence copied'); } catch { toast('Copying was blocked'); } };
  view().onclick = (ev) => { const b = ev.target.closest('[data-say]'); if (b) { ev.preventDefault(); speak(b.dataset.say); } };
}

// After launch, load the rest of the data one file at a time while the first screen sits idle, so no
// page ever has to load (and freeze) in the middle of a transition. Each parse is one long task, so
// it waits for any running transition to finish and leaves gaps for taps in between.
function warmUp() {
  const jobs = [() => db.lists(), () => sents(), () => db.formsReady()];
  const next = () => {
    if (!jobs.length) return;
    if (document.documentElement.classList.contains('vt') || document.body.classList.contains('nav-wait')) return setTimeout(next, 300);
    Promise.resolve().then(jobs.shift()).catch(() => {}).finally(() => setTimeout(next, 200));
  };
  setTimeout(next, 900);
}

// Finger-tracking gestures (phones and tablets), like Shirabe: a short drag to the right from anywhere on
// the page opens the menu on a top-level page or goes back on a deeper one; with the menu open, a drag to
// the left anywhere (or a tap on the page strip) closes it. A release finishes the move on a flick or past
// about a third of the way, taking the rest of the distance at the finger's own speed. Drags that start
// in a text field, a slider or a sideways-scrolling row are theirs, not the page's. In a Safari tab the
// left edge belongs to the browser's own back.
const SWIPE_LOCK = 10;          // px of sideways travel before a drag becomes a swipe
const FLICK = .3;               // px/ms
function ownsSideways(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches?.('input,textarea,select,[contenteditable],.modal-wrap,#suggest,#keybar')) return true;
    if (n.scrollWidth > n.clientWidth + 2) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; }
  }
  return false;
}
function setupGestures() {
  let g = null;
  const onMove = (e) => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.lock) {
      if (Math.abs(dy) > SWIPE_LOCK && Math.abs(dy) > Math.abs(dx)) { stop(); return; }   // a scroll, not a swipe
      if (Math.abs(dx) < SWIPE_LOCK || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (g.mode !== 'close' && dx < 0) { stop(); return; }   // only a drag to the right opens or goes back
      g.lock = true; g.x0 = t.clientX;   // start tracking from here, so the page doesn't jump by the lock distance
      activeVT?.skipTransition();   // a swipe during a page change finishes that change at once and takes over
      window.getSelection?.()?.removeAllRanges();
      if (g.mode === 'open') { const r = document.documentElement; r.style.setProperty('--drawer-w', drawerW() + 'px'); r.classList.add('drawer-on'); hideSuggest(); qInput().blur(); }
      if (g.mode === 'back') { startBackDrag(); document.documentElement.classList.add('back-drag'); }
    }
    e.preventDefault();
    const now = performance.now(), dt = now - g.t;
    if (dt > 0) g.v = .7 * ((t.clientX - g.lastX) / dt) + .3 * g.v;
    g.t = now; g.lastX = t.clientX;
    const max = g.mode === 'back' ? innerWidth : drawerW();
    let x = g.base + (t.clientX - g.x0);
    if (x > max) x = g.mode === 'back' ? max : max + (x - max) * .12;   // the menu stretches a little past open
    placePage(Math.max(0, x), 0);
  };
  const stop = () => { document.removeEventListener('touchmove', onMove); g = null; };
  document.addEventListener('touchstart', (e) => {
    stop();
    if (!MOBILE_NAV() || e.touches.length > 1 || $('.modal-wrap')) return;
    const t = e.touches[0];
    let mode = null, strip = false;
    if (drawerOpen) { mode = 'close'; strip = t.clientX >= pageX - 6; }
    else {
      if (BROWSER_EDGE && t.clientX < 24) { browserSwipeAt = performance.now(); return; }
      if (ownsSideways(e.target)) return;
      mode = backTarget ? 'back' : 'open';
    }
    g = { mode, strip, x0: t.clientX, y0: t.clientY, base: pageX, lock: false, t: performance.now(), lastX: t.clientX, v: 0 };
    document.addEventListener('touchmove', onMove, { passive: false });
  }, { passive: true });
  // release: finish or spring back. A cancelled touch (the system took the gesture) always springs back.
  const end = (cancelled) => {
    if (!g) return;
    const m = g; stop();
    if (performance.now() - m.t > 90) m.v = 0;   // the finger stopped before lifting: no flick
    if (!m.lock) { if (m.strip) closeDrawer(); return; }   // a tap on the page strip closes the menu
    const x = pageX;
    if (m.mode === 'back') {
      const done = !cancelled && (m.v > FLICK || (m.v > -.15 && x > innerWidth * .33));
      const ms = releaseMs((done ? innerWidth : 0) - x, m.v, 380);
      placePage(done ? innerWidth : 0, ms);
      settleTimer = setTimeout(() => { if (done) goBack(true); else endBackDrag(); }, (reducedMotion() ? 0 : ms) + 20);
      return;
    }
    const W = drawerW(), wasOpen = m.base > 0;
    const open = cancelled ? wasOpen : m.v > FLICK ? true : m.v < -FLICK ? false : x > W * (wasOpen ? .65 : .35);
    const ms = releaseMs((open ? W : 0) - x, m.v, open ? EASE_MS.open : EASE_MS.close);
    if (open) { drawerOpen = true; document.documentElement.classList.add('drawer-open'); settlePage(W, ms); }
    else { drawerOpen = false; document.documentElement.classList.remove('drawer-open'); settlePage(0, ms); }
  };
  document.addEventListener('touchend', () => end(false), { passive: true });
  document.addEventListener('touchcancel', () => end(true), { passive: true });
  addEventListener('resize', () => { if (drawerOpen && !MOBILE_NAV()) { drawerOpen = false; endBackDrag(); document.documentElement.classList.remove('drawer-open', 'drawer-on'); } });
}

// Press-and-hold: sentences open on their own page; decks open their options
function setupHold() {
  let timer = null, el = null, sx = 0, sy = 0, swallow = 0;
  const cancel = () => { clearTimeout(timer); timer = null; el?.classList.remove('holding'); el = null; };
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    const t = ev.target.closest('[data-sent],[data-deck]');
    if (!t) return;
    const ctl = ev.target.closest('button,a,input,select,textarea');
    if (ctl && ctl !== t) return;
    cancel();
    el = t; sx = ev.clientX; sy = ev.clientY;
    el.classList.add('holding');
    timer = setTimeout(() => {
      const target = el; cancel(); swallow = Date.now();
      navigator.vibrate?.(8);
      if (target.dataset.sent) {
        try { localStorage.setItem('oppslag.heldSentence', '1'); } catch {}
        nav('#/x/' + target.dataset.sent);
      } else deckSheet(target.dataset.deck);
    }, 460);
  });
  document.addEventListener('pointermove', (ev) => { if (el && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cancel(); }, { passive: true });
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, cancel);
  addEventListener('scroll', cancel, { passive: true });
  // the click that ends a hold shouldn't also tap whatever is underneath
  document.addEventListener('click', (ev) => { if (Date.now() - swallow < 700) { ev.preventDefault(); ev.stopPropagation(); } }, true);
  document.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-sent],[data-deck]')) ev.preventDefault(); });
}

// Definitions in the older compact style, used on flashcard backs
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
  modal(`<h3>Save to list</h3><div class="picks">${render()}</div>
    <form class="row" id="nl"><input placeholder="New list name" id="nlName"><button class="btn">Create</button></form>
    <div class="modal-actions"><button class="btn primary" data-close>Done</button></div>`, (w) => {
    const bind = () => $$('input[data-l]', w).forEach(c => c.addEventListener('change', () => {
      store.toggleInList(c.dataset.l, id);
      if (c.dataset.l === 'fav') { const b = $('#favBtn'); if (b) { b.classList.toggle('on', c.checked); b.innerHTML = c.checked ? ICON.starFill : ICON.star; } }
    }));
    bind();
    $('#nl', w).addEventListener('submit', (ev) => {
      ev.preventDefault(); const n = $('#nlName', w).value.trim(); if (!n) return;
      const l = store.newList(n); store.toggleInList(l.id, id); $('.picks', w).innerHTML = render(); bind(); $('#nlName', w).value = '';
    });
  });
}
function askText(title, value = '', ok = 'Save') {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(`<h3>${h(title)}</h3><form id="askF"><input id="askI" value="${h(value)}" style="width:100%"><div class="modal-actions" style="gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${h(ok)}</button></div></form>`, (w) => {
      setTimeout(() => $('#askI', w).focus(), 50);
      $('#askF', w).addEventListener('submit', (ev) => { ev.preventDefault(); done = true; resolve($('#askI', w).value.trim()); close(); });
      w.addEventListener('click', (ev) => { if (!done && (ev.target === w || ev.target.closest('[data-close]'))) resolve(null); });
    });
  });
}

// ------------------------------------------------------------------ HISTORY
function viewHistory() {
  const hs = store.S().history;
  document.title = 'History – Oppslag';
  setNav({ title: 'History', right: hs.length ? '<button class="pill-btn" id="clr">Clear</button>' : '' });
  if (!hs.length) { view().innerHTML = pageTitle('History') + '<div class="empty">Words you look up appear here.</div>'; return; }
  const today = new Date().toDateString();
  const groups = [['Today', hs.filter(x => new Date(x.t).toDateString() === today)], ['Earlier', hs.filter(x => new Date(x.t).toDateString() !== today)]];
  view().innerHTML = pageTitle('History') + groups.filter(g => g[1].length).map(([t, xs]) => bandHTML(t) + xs.map(x => resultRow(x.id)).join('')).join('');
  rememberResults(hs.map(x => x.id));
  $('#clr')?.addEventListener('click', () => { if (confirm('Clear your history?')) { store.clearHistory(); viewHistory(); } });
}

// ------------------------------------------------------------------ MY LISTS
function viewMyLists() {
  document.title = 'Bookmarks – Oppslag';
  setNav({ title: 'Bookmarks', right: `<button class="round" id="newL" aria-label="New list">${ICON.plus}</button>` });
  const ls = store.lists();
  view().innerHTML = pageTitle('Bookmarks') + '<div class="group">' + ls.map(l => `<a class="lrow" href="#/list/${encodeURIComponent(l.id)}">${l.id === 'fav' ? ICON.starFill : ICON.folder}<div class="lt">${h(l.name)}</div><span class="cnt">${l.ids.length}</span><span class="chev">${ICON.chev}</span></a>`).join('') + '</div>' +
    `<p class="page-intro">Tap ☆ on any word or example sentence to add it to Favourites, or the bookmark button to file it into a list of your own. Lists become flashcard decks.</p>`;
  $('#newL').onclick = async () => { const n = await askText('New list'); if (n) { store.newList(n); viewMyLists(); } };
}

function listToolbar(withView = false) {
  const mode = store.settings().listView || 'rows';
  return `<div class="toolbar">
    <button class="btn small" data-act="study">${ICON.cards} Study</button>
    <button class="btn small" data-act="anki">${ICON.download} Anki</button>
    <button class="btn small" data-act="share">${ICON.share} Share</button>
    ${withView ? `<span style="flex:1"></span><span class="seg"><button data-view="rows" class="${mode === 'rows' ? 'on' : ''}" aria-label="List view">${ICON.rows}</button><button data-view="grid" class="${mode === 'grid' ? 'on' : ''}" aria-label="Grid view">${ICON.grid}</button></span>` : ''}
  </div>`;
}
function wireToolbar(ids, name, source, rerender) {
  $$('.toolbar [data-view]').forEach(b => b.addEventListener('click', () => { store.setSetting('listView', b.dataset.view); rerender?.(); }));
  $$('.toolbar [data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'study') {
      const existing = store.decks().find(d => d.source.type === source.type && d.source.id === source.id);
      const d = existing || store.newDeck(name, source, 'no');
      nav('#/review/' + encodeURIComponent(d.id));
    }
    if (act === 'anki') {
      const rows = [];
      if (ids.some(isSent)) await sents();
      for (const id of ids) {
        if (isSent(id)) { const x = SENTS[id.slice(1)]; if (x) rows.push(`${x[0].replace(/\t/g, ' ')}\t${x[1][0].replace(/\t/g, ' ')}\tsentence`); continue; }
        const e = await db.entry(id); const r = db.row(id); if (!e) continue;
        const front = (artOf(r) ? artOf(r) + ' ' : '') + e.l.join(' / ');
        const back = [r.en || r.no, e.ipa ? `/${e.ipa}/` + (e.tone ? ` (tonelag ${e.tone})` : '') : '', e.inf ? e.inf.f.filter(Boolean).slice(0, 5).join(', ').replace(/~/g, '') : ''].filter(Boolean).join('<br>');
        rows.push(`${front.replace(/\t/g, ' ')}\t${back.replace(/\t/g, ' ')}\t${POS[r.pos] || ''}`);
      }
      download(`${name.replace(/[^\wæøå-]+/gi, '_')}.tsv`, '#separator:tab\n#html:true\n#columns:Front\tBack\tTags\n' + rows.join('\n'), 'text/tab-separated-values');
    }
    if (act === 'share') {
      if (ids.some(isSent)) await sents();
      const text = `${name}\n` + ids.map(id => { if (isSent(id)) { const x = SENTS[id.slice(1)]; return x ? `${x[0]} — ${x[1][0]}` : ''; } const r = db.row(id); return r ? `${r.lemmas[0]} — ${(r.en || r.no).split('; ')[0]}` : ''; }).join('\n');
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
function gridCell(id) {
  const r = db.row(id); if (!r) return '';
  return `<a class="wcell" href="#/w/${id}"><b>${h(r.lemmas[0])}</b>${r.ipa ? `<span class="ipa-s">/${h(r.ipa)}/</span>` : ''}<span>${h((r.en || r.no).split('; ')[0])}</span></a>`;
}
function renderWordList(container, ids, extraFn) {
  const grid = (store.settings().listView || 'rows') === 'grid';
  container.className = grid ? 'wgrid' : 'results';
  const one = (id) => isSent(id) ? (grid ? sentCell(id) : sentRow(id, extraFn ? extraFn(id) : ''))
    : grid ? gridCell(id) : resultRow(id, extraFn ? extraFn(id) : '');
  progressive(container, ids, one, 60, 120);
  rememberResults(ids.filter(x => !isSent(x)));
}

async function viewMyList(id) {
  const l = store.list(id);
  if (!l) { nav('#/lists'); return; }
  if (l.ids.some(isSent)) { const my = routeSeq; await sents(); if (my !== routeSeq) return; }
  document.title = `${l.name} – Oppslag`;
  setNav({ title: l.name, back: '#/lists', right: l.id !== 'fav' ? `<button class="round" id="ren" aria-label="Rename">${ICON.edit}</button><button class="round" id="del" aria-label="Delete list">${ICON.trash}</button>` : '' });
  const render = () => {
    view().innerHTML = pageTitle(l.name) + (l.ids.length ? `${listToolbar(true)}<div id="lr"></div>` : '<div class="empty">Tap ☆ on a word or a sentence, or the bookmark button, to save it here.</div>');
    if (!l.ids.length) return;
    renderWordList($('#lr'), l.ids, (x) => `<button class="rm" data-rm="${h(x)}" aria-label="Remove">${ICON.close}</button>`);
    wireToolbar(l.ids, l.name, { type: 'user', id: l.id }, render);
  };
  render();
  view().onclick = (ev) => { const b = ev.target.closest('[data-rm]'); if (b) { ev.preventDefault(); ev.stopPropagation(); store.toggleInList(id, isSent(b.dataset.rm) ? b.dataset.rm : +b.dataset.rm); render(); } };
  $('#ren') && ($('#ren').onclick = async () => { const n = await askText('Rename list', l.name); if (n) { store.renameList(id, n); setNav({ title: n, back: '#/lists' }); viewMyList(id); } });
  $('#del') && ($('#del').onclick = () => { if (confirm(`Delete “${l.name}”?`)) { store.deleteList(id); nav('#/lists'); } });
}

// ------------------------------------------------------------------ BUILT-IN LISTS
async function viewBuiltins() {
  const my = routeSeq;
  document.title = 'Word lists – Oppslag';
  setNav({ title: 'Word lists' });
  const L = await db.lists();
  if (my !== routeSeq) return;
  const groups = {};
  for (const l of L) if (l.ids.length) (groups[l.group] ||= []).push(l);
  const desc = { Frequency: 'The most-used words, from Norwegian film and TV subtitles.', Grammar: 'Word classes and irregular patterns, from the official inflection data.', Pronunciation: 'Practise the two Norwegian tones.', Topics: 'Subject lists from Wiktionary categories.' };
  const icon = { Frequency: ICON.list, Grammar: ICON.book, Pronunciation: ICON.speaker, Topics: ICON.folder };
  view().innerHTML = `${pageTitle('Word lists')}<input class="filter" id="lf" placeholder="Filter lists" type="search">
    ${Object.entries(groups).map(([g, ls]) => `<section class="lgroup">${bandHTML(g)}<p class="page-intro">${h(desc[g] || '')}</p>
      <div class="group">${ls.map(l => `<a class="lrow" data-name="${h(l.name.toLowerCase())}" href="#/builtin/${encodeURIComponent(l.id)}">${icon[g] || ICON.list}<div class="lt">${h(l.name)}</div><span class="cnt">${(l.pairs || l.ids).length}</span><span class="chev">${ICON.chev}</span></a>`).join('')}</div></section>`).join('')}`;
  $('#lf').addEventListener('input', (ev) => {
    const v = ev.target.value.toLowerCase();
    $$('.lrow[data-name]').forEach(t => t.hidden = !t.dataset.name.includes(v));
    $$('.lgroup').forEach(s => s.hidden = !$$('.lrow[data-name]', s).some(t => !t.hidden));
  });
}
async function viewBuiltin(id) {
  const my = routeSeq;
  const L = await db.lists();
  if (my !== routeSeq) return;
  const l = L.find(x => x.id === id);
  if (!l) { nav('#/builtin'); return; }
  document.title = `${l.name} – Oppslag`;
  setNav({ title: l.name, back: '#/builtin', right: l.type === 'pairs' ? '' : `<button class="round" id="copyL" aria-label="Save a copy to Bookmarks">${ICON.bookmark}</button>` });
  const ids = l.ids.filter(x => db.row(x));
  if (l.type === 'pairs') {
    const side = (id, t) => { const r = db.row(id); return r ? `<a class="pairside" href="#/w/${id}"><span class="chip-s">Tone ${t}</span><b>${h(r.lemmas[0])}</b><span class="muted">${h((r.en || r.no).split('; ')[0])}</span></a>` : ''; };
    view().innerHTML = `${pageTitle(l.name)}<p class="page-intro">Each form is spelled the same but takes tonelag 1 in one word and tonelag 2 in the other. Tap the speaker to hear it.</p>
      ${listToolbar()}
      ${l.pairs.map(([f, a, b]) => `<div class="pair"><div class="pairform">${h(f)}${ttsAvailable() ? `<button class="speak tiny" data-say="${h(f)}" aria-label="Listen">${ICON.speaker}</button>` : ''}</div>${side(a, 1)}${side(b, 2)}</div>`).join('')}`;
    wireToolbar(ids, l.name, { type: 'builtin', id: l.id });
    view().onclick = (ev) => { const b = ev.target.closest('[data-say]'); if (b) speak(b.dataset.say); };
    return;
  }
  const render = () => {
    view().innerHTML = `${pageTitle(l.name)}${listToolbar(true)}<div id="lr"></div>`;
    renderWordList($('#lr'), ids);
    wireToolbar(ids, l.name, { type: 'builtin', id: l.id }, render);
  };
  render();
  $('#copyL').onclick = () => { const n = store.newList(l.name); n.ids = [...ids]; store.save(); toast('Saved to Bookmarks'); };
}

// ------------------------------------------------------------------ FLASHCARDS
async function deckIds(d) {
  if (d.source.type === 'user') return store.list(d.source.id)?.ids.filter(x => isSent(x) || db.row(x)) || [];
  const L = await db.lists(); return (L.find(x => x.id === d.source.id)?.ids || []).filter(x => db.row(x));
}
const dirsOf = (d) => d.dir === 'both' ? ['no', 'en'] : [d.dir];
const FOLDER_COLORS = ['mustard', 'sage', 'plum', 'rose'];
const DIR_LABEL = { no: 'Norwegian → English', en: 'English → Norwegian', both: 'Both directions' };
const deckColor = (d) => d.color || FOLDER_COLORS[Math.max(0, store.decks().indexOf(d)) % 4];
function deckIcon(d, L) {
  if (d.source.type === 'user') return d.source.id === 'fav' ? ICON.starFill : ICON.bookmark;
  const g = L.find(x => x.id === d.source.id)?.group;
  return { Frequency: ICON.list, Grammar: ICON.book, Pronunciation: ICON.speaker, Topics: ICON.folder }[g] || ICON.cards;
}

async function viewDecks() {
  const my = routeSeq;
  document.title = 'Flashcards – Oppslag';
  setNav({ title: 'Flashcards', right: `<button class="round" id="newDeck" aria-label="New deck">${ICON.plus}</button>` });
  const ds = store.decks();
  const L = await db.lists();
  let due = 0;
  const folders = [];
  for (const d of ds) {
    const ids = await deckIds(d); const st = srs.stats(d.id, ids, dirsOf(d));
    due += st.due;
    const status = st.due ? `<b>${st.due} due</b>` : st.new ? `${st.new} new` : ids.length ? 'All caught up' : 'Empty';
    folders.push(`<a class="folder c-${deckColor(d)}" href="#/review/${encodeURIComponent(d.id)}" data-deck="${h(d.id)}" aria-label="${h(d.name)}: ${ids.length} cards, ${st.due} due. Press and hold for options.">
      <span class="folder-tab" aria-hidden="true"></span>${ids.length ? '<span class="folder-sheet" aria-hidden="true"></span><span class="folder-sheet s2" aria-hidden="true"></span>' : ''}
      <span class="folder-front">
        <span class="folder-top"><span class="folder-icon">${deckIcon(d, L)}</span><span class="folder-count">${ids.length} ${ids.length === 1 ? 'card' : 'cards'}<br>${status}</span></span>
        <span class="folder-name">${h(d.name)}<span class="folder-dir">${DIR_LABEL[d.dir]}</span></span>
      </span></a>`);
  }
  if (my !== routeSeq) return;
  folders.push(`<button class="folder folder-new" id="newDeck2"><span class="folder-tab" aria-hidden="true"></span><span class="folder-front">${ICON.plus}<span>New deck</span></span></button>`);
  view().innerHTML = `<h1 class="home-title">Flashcards.<span class="sub">${!ds.length ? 'Turn any list into a deck.' : due ? `${due} ${due === 1 ? 'card' : 'cards'} due today.` : 'Nothing due right now.'}</span></h1>
    <div class="folders">${folders.join('')}</div>
    <p class="page-intro">${ds.length ? 'Press and hold a deck to change its name, colour or direction. ' : ''}Cards you know well come back less often. ${store.settings().newPerDay} new cards a day (change in Settings).</p>`;
  $('#newDeck').onclick = $('#newDeck2').onclick = () => newDeckSheet(L);
}

function newDeckSheet(L) {
  const opts = [...store.lists().map(l => `<option value="user:${h(l.id)}">${h(l.name)} (${l.ids.length})</option>`),
    ...L.filter(l => l.ids.length && l.group !== 'Topics').map(l => `<option value="builtin:${h(l.id)}">${h(l.group)} · ${h(l.name)}</option>`),
    ...L.filter(l => l.ids.length && l.group === 'Topics').map(l => `<option value="builtin:${h(l.id)}">Topic · ${h(l.name)}</option>`)].join('');
  const used = new Set(store.decks().map(deckColor));
  modal(`<h3>New deck</h3><form id="nd" class="sheet-form">
      <label class="sheet-field"><span>Cards from</span><select id="ndSrc">${opts}</select></label>
      <label class="sheet-field"><span>Direction</span><select id="ndDir">${Object.entries(DIR_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      ${swatches(FOLDER_COLORS.find(c => !used.has(c)) || FOLDER_COLORS[store.decks().length % 4])}
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create deck</button></div></form>`, (w, close) => {
    $('#nd', w).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const [type, ...rest] = $('#ndSrc', w).value.split(':'); const id = rest.join(':');
      const name = type === 'user' ? store.list(id).name : L.find(x => x.id === id).name;
      const d = store.newDeck(name, { type, id }, $('#ndDir', w).value);
      store.updateDeck(d.id, { color: $('input[name="fc"]:checked', w).value });
      close(); viewDecks();
    });
  });
}
function swatches(cur) {
  const names = { mustard: 'Mustard', sage: 'Sage', plum: 'Plum', rose: 'Rose' };
  return `<fieldset class="sheet-field swatches"><legend>Colour</legend><div>${FOLDER_COLORS.map(c => `<label class="sw c-${c}"><input type="radio" name="fc" value="${c}" ${c === cur ? 'checked' : ''}><span>${names[c]}</span></label>`).join('')}</div></fieldset>`;
}
async function deckSheet(deckId) {
  const d = store.deck(deckId); if (!d) return;
  const ids = await deckIds(d); const st = srs.stats(d.id, ids, dirsOf(d));
  modal(`<h3>${h(d.name)}</h3><p class="sheet-stats">${ids.length} cards · ${st.mature} learned · ${st.learning} learning · ${st.new} new</p>
    <form id="ds" class="sheet-form">
      <label class="sheet-field"><span>Name</span><input id="dsName" value="${h(d.name)}"></label>
      <label class="sheet-field"><span>Direction</span><select id="dsDir">${Object.entries(DIR_LABEL).map(([k, v]) => `<option value="${k}" ${d.dir === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${swatches(deckColor(d))}
      <div class="modal-actions"><button type="button" class="btn danger" id="dsDel">${ICON.trash} Delete</button><span style="flex:1"></span><button class="btn primary">Done</button></div></form>`, (w, close) => {
    $('#ds', w).addEventListener('submit', (ev) => {
      ev.preventDefault();
      store.updateDeck(d.id, { name: $('#dsName', w).value.trim() || d.name, dir: $('#dsDir', w).value, color: $('input[name="fc"]:checked', w).value });
      close(); if (location.hash === '#/cards') viewDecks();
    });
    $('#dsDel', w).addEventListener('click', () => {
      if (!confirm(`Delete “${d.name}” and its review progress? The list itself stays in Bookmarks.`)) return;
      store.deleteDeck(d.id); close(); if (location.hash === '#/cards') viewDecks();
    });
  });
}

async function viewReview(deckId) {
  const d = store.deck(deckId);
  if (!d) { nav('#/cards'); return; }
  document.title = `${d.name} – Flashcards`;
  const my = routeSeq;
  const ids = await deckIds(d);
  const s = store.settings();
  const q = srs.queue(d.id, ids, dirsOf(d), s.newPerDay);
  const items = [...q.due, ...q.fresh];
  const total = items.length;
  let done = 0;
  const again = [];
  const wordCard = async (id, dir) => {
    const e = await db.entry(id); const r = db.row(id);
    if (!e || !r) return null;
    const art = artOf(r) ? artOf(r) + ' ' : '';
    const noWord = `${art}${e.l.join(' / ')}`;
    const enText = r.en ? r.en.split('; ').slice(0, 3).join('; ') : r.no;
    const front = dir === 'no' ? `<div class="cf-word">${h(noWord)}</div><div class="muted">${h(POS[r.pos] || '')}</div>`
      : `<div class="cf-en">${h(enText)}</div><div class="muted">${h(POS[r.pos] || '')}${r.pos === 'n' && r.g ? ' · ' + articleFor(r.g) : ''}</div>`;
    const backParts = [];
    if (dir === 'en') backParts.push(`<div class="cf-word">${h(noWord)}</div>`);
    for (const f of s.cardBack) {
      if (f === 'en' && dir === 'no') backParts.push(`<div class="cb-en">${e.en ? e.en.slice(0, 4).map(x => h(x.g)).join('<br>') : h(r.no)}</div>`);
      if (f === 'pron' && e.ipa) backParts.push(`<div class="cb-pron"><span class="ipa">/${h(e.ipa)}/</span>${e.tone ? `<span class="chip-s">Tone ${e.tone}</span>` : ''}</div>`);
      if (f === 'inf' && e.inf) backParts.push(`<div class="cb-inf">${e.inf.f.slice(0, e.inf.k === 'v' ? 5 : 4).filter(Boolean).map(c => h(c.split('/').filter(w => w[0] !== '~').join('/'))).join(' · ')}</div>`);
      if (f === 'no' && e.d) backParts.push(`<div class="cb-no">${renderDefs(e.d.slice(0, 2))}</div>`);
      if (f === 'ex' && e.ts?.length) { const S = await sents(); const x = S[e.ts[0]]; if (x) backParts.push(`<div class="cb-ex" data-sent="${e.ts[0]}"><div>${h(x[0])}</div><div class="muted">${h(x[1][0])}</div></div>`); }
      if (f === 'cmp' && e.cmp) backParts.push(`<div class="cb-cmp">${h(e.cmp[0])} + ${e.cmp[1] ? h(e.cmp[1]) + ' + ' : ''}${h(e.cmp[2])}</div>`);
      if (f === 'note' && store.note(id)) backParts.push(`<div class="cb-note">${h(store.note(id))}</div>`);
    }
    return {
      field: fieldOf(r.pos), front, back: backParts.join(''), say: e.l[0], href: `#/w/${id}`, open: 'Open entry',
      placeholder: dir === 'no' ? 'Type the meaning…' : 'Type the Norwegian word…',
      check: (v) => dir === 'no'
        ? (r.en || '').toLowerCase().split(/[;,]\s*/).some(t => t.replace(/^(to|a|an|the) /, '').trim() === v.replace(/^(to|a|an|the) /, ''))
        : e.l.map(x => x.toLowerCase()).includes(v),
    };
  };
  const sentenceCard = async (sid, dir) => {
    const S = await sents(); const x = S[sid];
    if (!x) return null;
    await db.formsReady().catch(() => {});
    const { groups } = analyse(x[0]);
    const seen = new Set(), words = [];
    for (const g of groups) {
      const r = g.ids.length && db.row(g.ids[0]);
      if (!r || seen.has(r.id)) continue; seen.add(r.id);
      words.push(`<li><b lang="nb">${h(r.lemmas[0])}</b> <span>${h((r.en || r.no).split('; ')[0])}</span></li>`);
    }
    const front = dir === 'no' ? `<div class="cf-sent" lang="nb">${h(x[0])}</div><div class="muted">sentence</div>`
      : `<div class="cf-sent">${h(x[1][0])}</div><div class="muted">say it in Norwegian</div>`;
    const back = (dir === 'en' ? `<div class="cf-sent" lang="nb">${h(x[0])}</div>` : `<div class="cb-en">${x[1].slice(0, 2).map(h).join('<br>')}</div>`) +
      (words.length ? `<ul class="cb-words">${words.join('')}</ul>` : '');
    const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
    return {
      field: 'f-page', sid, front, back, say: x[0], href: `#/x/${sid}`, open: 'Open sentence',
      placeholder: dir === 'no' ? 'Type the meaning…' : 'Type the Norwegian sentence…',
      check: (v) => dir === 'no' ? x[1].some(t => norm(t) === norm(v)) : norm(x[0]) === norm(v),
    };
  };
  const next = async () => {
    if (my !== routeSeq) return;
    if (!items.length && again.length) {
      again.sort((a, b) => srs.state(a).due - srs.state(b).due);
      items.push(again.shift());
    }
    if (!items.length) {
      const st = srs.stats(d.id, ids, dirsOf(d));
      setNav({ title: d.name, back: '#/cards' });
      view().innerHTML = `<div class="empty"><div class="big-check">✓</div><p><b>All done for now.</b><br>${done} cards reviewed.</p>
        <p class="small">${st.new} new cards left · ${s.newPerDay} new per day</p><a class="btn" href="#/cards">Back to decks</a></div>`;
      return;
    }
    const key = items.shift();
    const [, idStr, dir] = key.split(':');
    const card = isSent(idStr) ? await sentenceCard(idStr.slice(1), dir) : await wordCard(+idStr, dir);
    if (my !== routeSeq) return;
    if (!card) return next();
    const remaining = items.length + 1 + again.length;
    setNav({ title: d.name, back: '#/cards', right: `<span class="muted small" style="padding-right:6px">${remaining} left</span>` });
    view().innerHTML = `<div class="study-progress"><div style="width:${total ? Math.min(100, done / Math.max(total, done + remaining) * 100) : 0}%"></div></div>
      <div class="flash ${card.field}" id="flash" ${card.sid ? `data-sent="${card.sid}"` : ''}>
        <div class="front">${card.front}</div>
        ${s.typeAnswer ? `<input id="typed" class="typed" placeholder="${card.placeholder}" autocapitalize="off" autocomplete="off" spellcheck="false">` : ''}
        <div class="cardback" hidden>${card.back}<div id="typedResult"></div>
          <div class="cardlinks">${ttsAvailable() ? `<button class="btn small" data-say="${h(card.say)}">${ICON.speaker} Listen</button>` : ''}<a class="btn small" href="${card.href}">${card.open}</a></div></div>
      </div>
      <div class="answer" id="ans"><button class="btn primary" style="width:100%" id="show">Show answer</button></div>`;
    if (dir === 'no' && ttsAvailable() && s.autoSpeak) speak(card.say);
    const show = () => {
      $('.cardback').hidden = false;
      const typed = $('#typed');
      if (typed) {
        const v = typed.value.trim().toLowerCase(); typed.disabled = true;
        if (v) {
          const ok = card.check(v);
          $('#typedResult').innerHTML = `<div class="typed-res ${ok ? 'ok' : 'bad'}">${ok ? '✓ Correct' : '✗ You typed: ' + h(typed.value)}</div>`;
        }
      }
      $('#ans').innerHTML = `<div class="grades">${['Again', 'Hard', 'Good', 'Easy'].map((g, k) => `<button class="grade g${k}" data-g="${k}"><b>${g}</b><span>${srs.preview(key, k)}</span><kbd>${k + 1}</kbd></button>`).join('')}</div>`;
      $$('.grade').forEach(b => b.addEventListener('click', () => answer(+b.dataset.g)));
      $$('[data-say]', view()).forEach(b => b.addEventListener('click', () => speak(b.dataset.say)));
      if (dir === 'en' && ttsAvailable() && s.autoSpeak) speak(card.say);
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
  setNav({ title: d.name, back: '#/cards' });
  next();
}

// ------------------------------------------------------------------ READER (multi-word lookup)
function viewReader() {
  document.title = 'Reader – Oppslag';
  setNav({ title: 'Reader' });
  const text = sessionStorage.getItem('reader') || '';
  view().innerHTML = `${pageTitle('Reader')}<p class="page-intro">Paste Norwegian text. Every word is looked up, including inflected forms and fixed expressions.</p>
    <div class="pad"><textarea id="rt" rows="4" placeholder="F.eks.: Jeg har bodd i Norge i tre år, og jeg snakker fortsatt ikke flytende norsk.">${h(text)}</textarea></div>
    <div class="row"><button class="btn primary" id="go">Look up words</button><button class="btn" id="paste">${ICON.paste} Paste</button>${ttsAvailable() ? `<button class="btn" id="say">${ICON.speaker} Read aloud</button>` : ''}</div>
    <div id="rout"></div>`;
  const run = async () => {
    await db.formsReady().catch(() => {});
    const t = $('#rt').value; sessionStorage.setItem('reader', t);
    const out = analyse(t).groups;
    const seen = new Set();
    const all = [];
    $('#rout').innerHTML = `<div class="reader-line">${out.map((o, i) => `<button class="rtok ${o.ids.length ? '' : 'unk'} ${o.len > 1 ? 'mwe' : ''}" data-i="${i}">${h(o.tok)}</button>`).join(' ')}</div>
      ${out.map((o) => {
        const key = o.tok.toLowerCase(); if (seen.has(key)) return ''; seen.add(key);
        all.push(...o.ids.slice(0, 3));
        return `<div class="rword" data-tok="${h(key)}">${bandHTML(o.tok)}${o.ids.length ? o.ids.slice(0, 3).map(id => resultRow(id)).join('') : '<div class="page-intro" style="padding-top:8px">Not found</div>'}</div>`;
      }).join('')}`;
    rememberResults(all);
    $$('.rtok').forEach(b => b.addEventListener('click', () => {
      const tok = out[+b.dataset.i].tok.toLowerCase();
      const target = $$('.rword').find(x => x.dataset.tok === tok);
      target?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      target?.classList.add('flash-hl'); setTimeout(() => target?.classList.remove('flash-hl'), 900);
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
  setNav({ title: 'Example sentences' });
  view().innerHTML = `${pageTitle('Example sentences')}<form id="exf" class="row"><input id="exq" value="${h(q)}" placeholder="Search Norwegian or English sentences" autocapitalize="off"><button class="btn primary">Search</button></form><div id="exr" class="loading">Loading…</div>`;
  $('#exf').addEventListener('submit', (ev) => { ev.preventDefault(); nav('#/examples/' + encodeURIComponent($('#exq').value)); });
  const my = routeSeq;
  const S = await db.sentences();
  if (my !== routeSeq) return;
  const out = $('#exr'); out.className = '';
  if (!q.trim()) { out.innerHTML = `<p class="page-intro">${Object.keys(S).length.toLocaleString()} Norwegian sentences with English translations, from Tatoeba.</p>`; return; }
  const ql = q.toLowerCase();
  const re = new RegExp('(^|[^\\p{L}])(' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'iu');
  const hits = Object.entries(S).filter(([, [no, en]]) => re.test(no) || en.some(x => re.test(x))).sort((a, b) => a[1][0].length - b[1][0].length).slice(0, 200);
  const mk = (t) => h(t).replace(new RegExp('(' + h(ql).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
  out.innerHTML = hits.length ? `${holdHint()}<div class="pad"><ul class="sents">${hits.map(([sid, [no, en]]) => `<li data-sent="${sid}"><div class="sno"><span>${mk(no)}</span>${ttsAvailable() ? `<button class="speak tiny" data-say="${h(no)}" aria-label="Listen">${ICON.speaker}</button>` : ''}</div><div class="sen">${mk(en[0])}</div></li>`).join('')}</ul></div><div class="foot">${hits.length}${hits.length === 200 ? '+' : ''} sentences</div>` : '<div class="empty">No sentences found.</div>';
  view().onclick = (ev) => { const b = ev.target.closest('[data-say]'); if (b) speak(b.dataset.say); };
}

// ------------------------------------------------------------------ SETTINGS
const SECTION_NAMES = { pron: 'Pronunciation & tonelag', en: 'English meanings', no: 'Norwegian definition', fx: 'Fixed expressions', inf: 'Inflection / conjugation', cmp: 'Compounds', ex: 'Example sentences', ety: 'Word origin', rel: 'Related words & topics', note: 'Note', src: 'Sources' };
const BACK_FIELDS = { en: 'English meaning', pron: 'IPA & tonelag', inf: 'Inflection', no: 'Norwegian definition', ex: 'Example sentence', cmp: 'Compound parts', note: 'My note' };

function viewSettings() {
  document.title = 'Settings – Oppslag';
  setNav({ title: 'Settings' });
  const s = store.settings();
  const voices = norwegianVoices();
  view().innerHTML = `${pageTitle('Settings')}
  ${bandHTML('Appearance')}<div class="group">
    <label class="field"><span>Theme</span><select id="theme"><option value="auto">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>

    <label class="field"><span>Text size</span><input type="range" id="fs" min="0.85" max="1.4" step="0.05" value="${s.fontScale}"></label></div>
  ${bandHTML('Word page')}<div class="group">
    <ul class="reorder" id="ro">${s.sections.map(k => `<li data-k="${k}"><label class="check"><input type="checkbox" ${s.hidden.includes(k) ? '' : 'checked'}><span>${SECTION_NAMES[k]}</span></label><button data-up aria-label="Move up">${ICON.up}</button><button data-down aria-label="Move down">${ICON.down}</button></li>`).join('')}</ul>
    <div class="check-row"><label class="check"><input type="checkbox" id="showTone" ${s.showTone ? 'checked' : ''}><span>Show the tonelag pitch graph</span></label></div>
    <div class="check-row"><label class="check"><input type="checkbox" id="showFormIpa" ${s.showFormIpa ? 'checked' : ''}><span>Show pronunciation of every inflected form</span></label></div></div>
  ${bandHTML('Speech')}<div class="group">
    ${ttsAvailable() ? `<label class="field"><span>Voice</span><select id="voice"><option value="">Automatic</option>${voices.map(v => `<option value="${h(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${h(v.name)} (${h(v.lang)})</option>`).join('')}</select></label>
    ${voices.length ? '' : '<p class="page-intro">No Norwegian voice found. On iPhone: Settings → Accessibility → Spoken Content → Voices → Norwegian.</p>'}
    <label class="field"><span>Speed</span><input type="range" id="rate" min="0.5" max="1.3" step="0.05" value="${s.rate}"></label>
    <div class="check-row"><label class="check"><input type="checkbox" id="autoSpeak" ${s.autoSpeak ? 'checked' : ''}><span>Speak flashcards automatically</span></label></div>
    <div class="row"><button class="btn small" id="testVoice">${ICON.speaker} “Hei, hvordan har du det?”</button></div>` : '<p class="page-intro">Speech isn’t available in this browser.</p>'}</div>
  ${bandHTML('Flashcards')}<div class="group">
    <label class="field"><span>New cards per day</span><input type="number" id="npd" min="0" max="200" value="${s.newPerDay}" style="width:90px"></label>
    <div class="field" style="align-items:flex-start"><span>Card back shows</span><div>${Object.entries(BACK_FIELDS).map(([k, v]) => `<label class="check" style="padding:5px 0"><input type="checkbox" data-back="${k}" ${s.cardBack.includes(k) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
    <div class="check-row"><label class="check"><input type="checkbox" id="typeAnswer" ${s.typeAnswer ? 'checked' : ''}><span>Type the answer before revealing</span></label></div></div>
  ${bandHTML('History')}<div class="group">
    <label class="field"><span>Keep the last</span><select id="hl">${[50, 100, 200, 500, 1000].map(n => `<option ${n === s.historyLimit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="row"><button class="btn small" id="clrH">Clear history</button></div></div>
  ${bandHTML('Backup')}<div class="group">
    <p class="page-intro">Bookmarks, notes and flashcard progress stay on this device. Export a backup to move them to another one.</p>
    <div class="row"><button class="btn" id="exp">${ICON.download} Export</button><label class="btn">${ICON.upload} Import<input type="file" id="imp" accept="application/json,.json" hidden></label></div></div>
  ${bandHTML('Offline')}<div class="group">
    <p class="page-intro" id="offStat">Checking…</p>
    <div class="row"><button class="btn" id="offBtn">${ICON.download} Download full dictionary</button></div></div>`;
  $('#theme').value = s.theme;
  $('#theme').addEventListener('change', (ev) => { store.setSetting('theme', ev.target.value); applyTheme(); });
  $('#fs').addEventListener('input', (ev) => { store.setSetting('fontScale', +ev.target.value); applyTheme(); });
  const saveOrder = () => {
    store.setSetting('sections', $$('#ro li').map(li => li.dataset.k));
    store.setSetting('hidden', $$('#ro li').filter(li => !$('input', li).checked).map(li => li.dataset.k));
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
  setNav({ title: 'About' });
  view().innerHTML = `${pageTitle('About')}
  <div class="about-p"><p><b>Oppslag</b> (“look-up”) is an offline Norwegian Bokmål ⇄ English study dictionary, modelled on Shirabe Jisho.</p>
   <p class="muted small">Data built ${h(m.built)} · ${m.entries.toLocaleString()} entries (${m.bo.toLocaleString()} from Bokmålsordboka, ${m.wk.toLocaleString()} Wiktionary-only) · ${m.withEnglish.toLocaleString()} with English · ${m.withPron.toLocaleString()} with pronunciation · ${m.forms.toLocaleString()} word forms · ${m.sentences.toLocaleString()} example sentences.</p></div>
  ${bandHTML('Sources & licences')}
   <div class="group"><ul class="sources">
    <li><b>Bokmålsordboka</b>: definitions, examples, fixed expressions, etymology, official spelling and inflection. © Språkrådet og Universitetet i Bergen, <a href="https://ordbokene.no" target="_blank" rel="noopener">ordbøkene.no</a>. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</li>
    <li><b>Norsk ordbank bokmål</b>: compound analysis. Språkbanken, Nasjonalbiblioteket / UiB. CC BY 4.0.</li>
    <li><b>NB Uttale</b>: IPA and tonelag (Urban East Norwegian). Språkbanken, Nasjonalbiblioteket. CC0.</li>
    <li><b>Wiktionary</b>: English meanings, English etymology, topics, synonyms. Extracted by <a href="https://kaikki.org" target="_blank" rel="noopener">kaikki.org</a>. CC BY-SA 4.0.</li>
    <li><b>Tatoeba</b>: example sentences with English translations. <a href="https://tatoeba.org" target="_blank" rel="noopener">tatoeba.org</a>. CC BY 2.0 FR.</li>
    <li><b>Type</b>: Schibsted Grotesk (Schibsted Media), Newsreader (Production Type), Gentium Book Plus (SIL). SIL Open Font Licence. <b>Icons</b>: Phosphor (MIT).</li>
    <li><b>FrequencyWords</b> (H. Dave, OpenSubtitles 2018): word frequency for ranking and “common” labels. CC BY-SA 4.0.</li>
   </ul></div>
   <p class="page-intro" style="margin-top:12px">Content has been reformatted and combined. English meanings are matched to Bokmålsordboka entries by spelling, word class and gender; where Wiktionary can’t tell homographs apart, the entry says so.</p>
  ${bandHTML('Keyboard shortcuts')}
   <div class="group"><ul class="kbd-list"><li><kbd>/</kbd> or <kbd>⌘K</kbd> search</li><li><kbd>Esc</kbd> clear search</li><li><kbd>↓</kbd> suggestions</li><li><kbd>←</kbd> <kbd>→</kbd> previous / next result</li><li><kbd>Space</kbd> flip card · <kbd>1</kbd>–<kbd>4</kbd> grade</li></ul></div>`;
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
  } catch { el.textContent = 'Offline storage isn’t available in this browser.'; }
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
    if (manual) { offlineStatus(); toast('Dictionary saved for offline use'); }
  } finally { prefetching = false; }
}

// ------------------------------------------------------------------ boot
async function boot() {
  applyTheme();
  $('.drawer-links').innerHTML = NAV_LINKS.map(x => x ? `<a href="${x[0]}">${ICON[x[2]]}<span>${x[1]}</span></a>` : '<hr>').join('');
  $('#navLeft').addEventListener('click', () => backTarget ? goBack() : openDrawer());
  $('#scrim').addEventListener('click', closeDrawer);
  setupSearch();
  setupHold();
  setupGestures();
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input,textarea,select');
    if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); if (!document.body.classList.contains('has-search')) nav('#/'); setTimeout(() => { qInput().focus(); qInput().select(); }, 30); }
    if (e.key === 'Escape') closeDrawer();
    if (!typing && !$('#pager').hidden) {
      if (e.key === 'ArrowLeft') $('#prevRes').click();
      if (e.key === 'ArrowRight') $('#nextRes').click();
    }
  });
  addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 4), { passive: true });
  try {
    await db.load(() => {});   // the splash keeps its credit line while loading
  } catch (e) {
    const m = $('#splash-msg'); m.hidden = false; m.textContent = 'Could not load the dictionary: ' + e.message; return;
  }
  // dictionary rebuilt since last visit? drop the stale cached data and reload once
  const meta = db.meta();
  const ver = meta.ver || `${meta.built}:${meta.entries}:${meta.forms}`;
  let oldVer = null; try { oldVer = localStorage.getItem('oppslag.dataver'); localStorage.setItem('oppslag.dataver', ver); } catch {}
  if (oldVer && oldVer !== ver && 'caches' in window) { await caches.delete('oppslag-data'); location.reload(); return; }
  window.addEventListener('hashchange', onHashChange);
  await route();
  // A cold start shows the launch logo for at least a moment, then dissolves it; resumes never see it
  const hold = 300 - performance.now();
  if (hold > 0 && !document.documentElement.classList.contains('no-splash')) await new Promise(r => setTimeout(r, hold));
  document.body.classList.add('ready');
  setTimeout(() => $('#splash')?.remove(), 500);
  warmUp();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // A new release installs a new service worker. On a fresh launch the page already came from the
    // network (the shell is network-first), so nothing to do. If the app was resumed and is in use,
    // switch to the new version the next time it goes to the background, without the launch logo.
    const hadController = !!navigator.serviceWorker.controller;
    let pending = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || pending || performance.now() < 8000) return;
      pending = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        try { sessionStorage.setItem('oppslag.quiet', '1'); } catch {}
        location.reload();
      });
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      setTimeout(() => prefetchAll(false), 4000);
      // home-screen apps stay open for days: check for a new release whenever it comes back to the front
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}
boot();

// User data: history, bookmarks/lists, notes, flashcard state, settings. Stored on-device only.
const KEY = 'oppslag.v1';
const DEFAULTS = {
  settings: {
    theme: 'auto', accent: 'fjord', listView: 'rows', fontScale: 1, historyLimit: 200,
    showTone: true, showFormIpa: true, voiceURI: '', rate: 0.9,
    sections: ['pron', 'en', 'no', 'fx', 'inf', 'cmp', 'ex', 'ety', 'rel', 'note', 'src'],
    hidden: [],
    cardFront: 'no', cardBack: ['en', 'pron', 'inf', 'ex'], newPerDay: 15, typeAnswer: false,
  },
  history: [],          // [{id, q, t}]
  searches: [],         // recent search strings
  lists: [{ id: 'fav', name: 'Favourites', ids: [], created: Date.now() }],
  notes: {},            // id -> text
  srs: {},              // `${deck}:${id}:${dir}` -> card state
  decks: [],            // [{id, name, source:{type:'user'|'builtin', id}, dir:'no'|'en'|'both'}]
  daily: {},            // date -> {new: n, reviewed: n}
};
let state;
function load() {
  try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (state[k] === undefined) state[k] = structuredClone(v);
  }
  state.settings = { ...structuredClone(DEFAULTS.settings), ...state.settings };
  // add any new sections introduced by updates
  for (const s of DEFAULTS.settings.sections) if (!state.settings.sections.includes(s)) state.settings.sections.push(s);
}
load();
let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
  }, 150);
}
export const S = () => state;
export const settings = () => state.settings;
export function setSetting(k, v) { state.settings[k] = v; save(); }

// history
export function addHistory(id) {
  state.history = state.history.filter(h => h.id !== id);
  state.history.unshift({ id, t: Date.now() });
  state.history.length = Math.min(state.history.length, state.settings.historyLimit);
  save();
}
export function addSearch(q) {
  q = q.trim(); if (!q) return;
  state.searches = [q, ...state.searches.filter(x => x !== q)].slice(0, 30); save();
}
export function clearHistory() { state.history = []; state.searches = []; save(); }

// lists
export const lists = () => state.lists;
export const list = (id) => state.lists.find(l => l.id === id);
export function newList(name) {
  const l = { id: 'l' + Date.now().toString(36), name, ids: [], created: Date.now() };
  state.lists.push(l); save(); return l;
}
export function renameList(id, name) { const l = list(id); if (l) { l.name = name; save(); } }
export function deleteList(id) { if (id === 'fav') return; state.lists = state.lists.filter(l => l.id !== id); save(); }
export function toggleInList(listId, id) {
  const l = list(listId); if (!l) return false;
  const k = l.ids.indexOf(id);
  if (k >= 0) l.ids.splice(k, 1); else l.ids.unshift(id);
  save(); return k < 0;
}
export const inList = (listId, id) => !!list(listId)?.ids.includes(id);
export const listsContaining = (id) => state.lists.filter(l => l.ids.includes(id));

// notes
export const note = (id) => state.notes[id] || '';
export function setNote(id, text) { if (text.trim()) state.notes[id] = text; else delete state.notes[id]; save(); }

// decks
export const decks = () => state.decks;
export const deck = (id) => state.decks.find(d => d.id === id);
export function newDeck(name, source, dir = 'no') {
  const d = { id: 'd' + Date.now().toString(36), name, source, dir, created: Date.now() };
  state.decks.push(d); save(); return d;
}
export function updateDeck(id, patch) { Object.assign(deck(id), patch); save(); }
export function deleteDeck(id) {
  state.decks = state.decks.filter(d => d.id !== id);
  for (const k of Object.keys(state.srs)) if (k.startsWith(id + ':')) delete state.srs[k];
  save();
}

// backup
export function exportAll() { return JSON.stringify({ app: 'oppslag', version: 1, exported: new Date().toISOString(), data: state }, null, 1); }
export function importAll(text) {
  const j = JSON.parse(text);
  if (j.app !== 'oppslag' || !j.data) throw new Error('Not an Oppslag backup file');
  localStorage.setItem(KEY, JSON.stringify(j.data)); load();
}

"""Build the Oppslag offline dictionary from authoritative open sources.

Sources (all in raw/):
  ordbok/   Bokmålsordboka articles (Språkrådet + UiB, CC-BY 4.0) via ord.uib.no  -> run fetch_ordbok.py
            + raw/ordbok/concepts.json from https://ord.uib.no/bm/concepts.json
  ordbank/  Norsk ordbank bokmål 2005 (Språkbanken, CC-BY 4.0): compound analysis
            https://www.nb.no/sbfil/leksikalske_databaser/ordbank/20220201_norsk_ordbank_nob_2005.tar.gz (extract here)
  kaikki/   English Wiktionary, Norwegian Bokmål section (kaikki.org extract, CC-BY-SA 4.0) -> raw/kaikki/nb.jsonl
            https://kaikki.org/dictionary/Norwegian%20Bokm%C3%A5l/kaikki.org-dictionary-NorwegianBokm%C3%A5l.jsonl
  uttale/   NB Uttale, East Norwegian spoken (Språkbanken, CC0): IPA + tonemes
            https://www.nb.no/sbfil/uttaleleksikon/nb_uttale_leksika.zip (extract e_spoken_pronunciation_lexicon.csv)
  tatoeba/  Tatoeba sentences nob + eng (CC-BY 2.0 FR)
            https://downloads.tatoeba.org/exports/per_language/nob/nob_sentences.tsv.bz2
            https://downloads.tatoeba.org/exports/per_language/nob/nob-eng_links.tsv.bz2
            https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
  freq/     hermitdave FrequencyWords 2018 'no' (OpenSubtitles, CC-BY-SA 4.0) -> raw/freq/no_50k.txt
            https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/no/no_50k.txt

Output: ../app/data/
Run:  python3 -I build.py
"""
import bz2, collections, csv, json, os, re, sys, time, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(HERE, '..', 'app', 'data')
NSHARDS = 256
t0 = time.time()
def log(*a): print(f'[{time.time()-t0:6.1f}s]', *a, flush=True)

csv.field_size_limit(10**8)

# ---------------------------------------------------------------- concepts
concepts = json.load(open(os.path.join(RAW, 'ordbok', 'concepts.json')))['concepts']
def expand(cid):
    c = concepts.get(cid)
    return c['expansion'] if c else cid

# ---------------------------------------------------------------- rich text
# Encoded mini-markup: [[text|articleId]] link, {{text}} usage/mentioned word, ^{text} superscript
def esc(s): return s.replace('[[', '[ [').replace('{{', '{ {')

def item_text(it):
    t = it.get('type_')
    if t == 'article_ref':
        lem = it.get('lemmas') or [{}]
        txt = it.get('word_form') or lem[0].get('lemma', '?')
        if it.get('definition_order'):
            txt += f' ({it["definition_order"]})'
        return f'[[{esc(txt)}|{it.get("article_id")}]]'
    if t == 'usage':
        return '{{' + esc(it.get('text', '')) + '}}'
    if t == 'superscript':
        return '^{' + it.get('text', '') + '}'
    if t == 'subscript':
        return it.get('text', '')
    if t in ('fraction',):
        return f'{it.get("numerator","")}/{it.get("denominator","")}'
    if 'id' in it:
        return expand(it['id'])
    return it.get('text', '')

def render(node):
    if not node: return ''
    content = node.get('content', '') or ''
    items = node.get('items', []) or []
    out, k = [], 0
    for ch in content:
        if ch == '$' and k < len(items):
            out.append(item_text(items[k])); k += 1
        else:
            out.append(ch)
    return re.sub(r'\s+', ' ', ''.join(out)).strip()

def plain(s):
    s = re.sub(r'\[\[(.*?)\|\-?\d+\]\]', r'\1', s)
    s = s.replace('{{', '').replace('}}', '')
    return re.sub(r'\^\{(.*?)\}', r'\1', s)

def conv_def(d):
    """definition node -> {e:[expl], x:[[quote, expl]], d:[children], c:[compound refs], i:intro}"""
    o = {}
    for el in d.get('elements', []):
        t = el.get('type_')
        if t == 'explanation':
            s = render(el)
            if s: o.setdefault('e', []).append(s)
        elif t == 'example':
            q = render(el.get('quote')); ex = render(el.get('explanation'))
            if q: o.setdefault('x', []).append([q, ex] if ex else [q])
        elif t == 'definition':
            c = conv_def(el)
            if c: o.setdefault('d', []).append(c)
        elif t == 'compound_list':
            refs = []
            for r in el.get('elements', []):
                lem = (r.get('lemmas') or [{}])[0].get('lemma')
                if lem: refs.append([lem, r.get('article_id')])
            if refs:
                o['c'] = refs
                intro = render(el.get('intro'))
                if intro: o['ci'] = intro
    return o

def collapse(defs):
    """Bokmålsordboka wraps senses in a top-level definition; unwrap a lone wrapper with no own text."""
    while len(defs) == 1 and set(defs[0].keys()) == {'d'}:
        defs = defs[0]['d']
    return defs

# ---------------------------------------------------------------- Ordbank
log('Ordbank')
def read_tsv_latin1(name):
    with open(os.path.join(RAW, 'ordbank', name), encoding='latin-1', newline='') as f:
        r = csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE)
        head = next(r)
        for row in r: yield dict(zip(head, row))


compounds = {}   # lemma_id -> [[part, joint], [part, '']]
for row in read_tsv_latin1('leddanalyse.txt'):
    if row.get('LEDDANALYSE', '').endswith('simplex') or not row.get('ETTERLEDD'): continue
    try: lid = int(row['LEMMA_ID'])
    except ValueError: continue
    if lid in compounds: continue
    compounds[lid] = [row['FORLEDD'], row['FUGE'], row['ETTERLEDD']]
log(' compounds', len(compounds))

# ---------------------------------------------------------------- Bokmålsordboka
log('Bokmålsordboka articles')
NOUN_SLOTS = [('Sing', 'Ind'), ('Sing', 'Def'), ('Plur', 'Ind'), ('Plur', 'Def')]
VERB_SLOTS = [('Inf',), ('Pres',), ('Past',), ('<PerfPart>',), ('Imp',),
              ('Inf', 'Pass'), ('Pres', 'Pass'),
              ('Adj', '<PerfPart>', 'Masc/Fem', 'Ind', 'Sing'), ('Adj', '<PerfPart>', 'Neuter', 'Ind', 'Sing'),
              ('Adj', '<PerfPart>', 'Def', 'Sing'), ('Adj', '<PerfPart>', 'Plur'), ('Adj', '<PresPart>')]
SVERB_SLOTS = [('Inf', '<SPass>'), ('Pres', '<SPass>'), ('Past', '<SPass>'), ('<PerfPart>', '<SPass>'), ('Imp', '<SPass>')]
ADJ_SLOTS = [('Pos', 'Masc/Fem', 'Ind', 'Sing'), ('Pos', 'Neuter', 'Ind', 'Sing'), ('Pos', 'Def', 'Sing'), ('Pos', 'Plur'),
             ('Cmp',), ('Sup', 'Ind'), ('Sup', 'Def')]
DET_SLOTS = [('Masc', 'Sing'), ('Fem', 'Sing'), ('Neuter', 'Sing'), ('Plur',), ('Cmp',), ('Sup', 'Ind'), ('Sup', 'Def')]
ADV_SLOTS = [('Pos',), ('Cmp',), ('Sup',)]
PRON_SLOTS = [('Nom',), ('Acc',)]
SLOTSETS = {'n': NOUN_SLOTS, 'v': VERB_SLOTS, 'vs': SVERB_SLOTS, 'a': ADJ_SLOTS, 'd': DET_SLOTS, 'r': ADV_SLOTS, 'p': PRON_SLOTS}

def slotkey(tags): return tuple(sorted(tags))
SLOTINDEX = {k: {slotkey(s): i for i, s in enumerate(v)} for k, v in SLOTSETS.items()}

entries = {}           # id -> entry dict (full detail)
by_lemma = collections.defaultdict(list)   # (lemma, coarsepos) -> [ids]
lemma_ids = {}         # ordbank lemma id -> article id
bad = 0
seen_ids = set()
with open(os.path.join(RAW, 'ordbok', 'articles.jsonl')) as f:
    for line in f:
        try: a = json.loads(line)
        except Exception: bad += 1; continue
        aid = a['article_id']
        if aid in seen_ids: continue
        seen_ids.add(aid)
        lemmas = a.get('lemmas') or []
        if not lemmas: continue
        e = {'id': aid, 'src': 'bo'}
        e['l'] = []
        for lm in lemmas:
            if lm['lemma'] not in e['l']: e['l'].append(lm['lemma'])
            lemma_ids[lm['id']] = aid
        e['hg'] = lemmas[0].get('hgno') or 0
        pos, genders, ic, inflgroups, pids = None, [], [], [], []
        tables = {}
        kind = None
        for lm in lemmas:
            if lm.get('inflection_class') and lm['inflection_class'] not in ic: ic.append(lm['inflection_class'])
            for p in lm.get('paradigm_info', []):
                if p.get('to'): continue
                tags = p.get('tags') or []
                if not tags: continue
                pos = pos or tags[0]
                for g in ('Masc', 'Fem', 'Neuter'):
                    if g in tags and g not in genders: genders.append(g)
                if p.get('inflection_group') and p['inflection_group'] not in inflgroups: inflgroups.append(p['inflection_group'])
                if p.get('paradigm_id'): pids.append(p['paradigm_id'])
                k = {'NOUN': 'n', 'VERB': 'v', 'ADJ': 'a', 'DET': 'd', 'ADV': 'r', 'PRON': 'p'}.get(tags[0])
                if k == 'v' and p.get('inflection_group') == 'VERB_sPass': k = 'vs'
                if not k: continue
                kind = kind or k
                if k != kind: continue
                idx = SLOTINDEX[k]
                std = p.get('standardisation') == 'STANDARD'
                for inf in p.get('inflection', []):
                    wf = inf.get('word_form')
                    if not wf: continue
                    i = idx.get(slotkey(inf.get('tags') or []))
                    if i is None: continue
                    lst = tables.setdefault(i, [])
                    if wf not in [x[0] for x in lst]: lst.append((wf, std))
        e['pos'] = pos or 'X'
        if genders: e['g'] = genders
        if ic: e['ic'] = ic
        if kind and tables:
            n = len(SLOTSETS[kind])
            # forms joined with '/', non-standard (REGISTERED) forms prefixed '~'
            e['inf'] = {'k': kind, 'f': ['/'.join(('' if s else '~') + w for w, s in tables.get(i, [])) or None for i in range(n)]}
        # irregularity classes, derived from the official paradigms themselves
        cls = set()
        def first(i):
            c = tables.get(i)
            return c[0][0].lower() if c else None
        if kind == 'v':
            inf_, past = first(0), first(2)
            if inf_ and past:
                stem = inf_[:-1] if inf_.endswith('e') and len(inf_) > 2 else inf_
                stems = {stem, stem[:-1] if len(stem) > 2 and stem[-1] == stem[-2] else stem}
                weak = {st + suf for st in stems for suf in ('et', 'a', 'te', 'de', 'dde', 'ddet')} | {inf_ + 'dde', inf_ + 'de'}
                if past not in weak: cls.add('strong')
        if kind == 'n':
            sg, pl = first(0), first(2)
            if sg and pl and pl != sg:
                st = sg[:-1] if sg.endswith('e') and len(sg) > 2 else sg
                if not pl.startswith(st) and not pl.startswith(sg[:-2] if len(sg) > 4 else sg): cls.add('irrplural')
        if 'VERB_sPass' in inflgroups: cls.add('sverb')
        if cls: e['cls'] = sorted(cls)
        body = a.get('body', {})
        defs, subs = [], []
        for d in body.get('definitions', []):
            # pull sub_articles (fixed expressions) out of the tree, anywhere
            def pull(node):
                keep = []
                for el in node.get('elements', []):
                    if el.get('type_') == 'sub_article':
                        art = el.get('article') or {}
                        sl = [x['lemma'] for x in (art.get('lemmas') or [])] or el.get('lemmas') or []
                        sd = collapse([c for c in (conv_def(x) for x in (art.get('body') or {}).get('definitions', [])) if c])
                        if sl and sd: subs.append({'l': sl[0] if isinstance(sl[0], str) else sl[0].get('lemma'), 'd': sd})
                    else:
                        if el.get('type_') == 'definition': pull(el)
                        keep.append(el)
                node['elements'] = keep
            pull(d)
            c = conv_def(d)
            if c: defs.append(c)
        defs = collapse(defs)
        if defs: e['d'] = defs
        if subs: e['fx'] = subs
        ety = [render(x) for x in body.get('etymology', [])]
        ety = [x for x in ety if x]
        if ety: e['ety'] = '; '.join(ety)
        pr = [render(x) for x in body.get('pronunciation', [])]
        pr = [x for x in pr if x]
        if pr: e['bp'] = '; '.join(pr)
        for lm in lemmas:
            if lm['id'] in compounds and 'cmp' not in e: e['cmp'] = compounds[lm['id']]
        entries[aid] = e
log(' articles', len(entries), 'bad lines', bad)

COARSE = {'NOUN': 'N', 'PROPN': 'PN', 'VERB': 'V', 'ADJ': 'A', 'ADV': 'R', 'ADP': 'P', 'PRON': 'D', 'DET': 'D',
          'CCONJ': 'C', 'SCONJ': 'C', 'INTJ': 'I', 'NUM': 'M', 'EXPR': 'E', 'PFX': 'F', 'COMPPFX': 'F', 'SFX': 'S',
          'ABBR': 'B', 'SYM': 'Y', 'X': 'X'}
for e in entries.values():
    for lem in e['l']:
        by_lemma[(lem.lower(), COARSE.get(e['pos'], 'X'))].append(e['id'])

# ---------------------------------------------------------------- Wiktionary
log('Wiktionary (kaikki)')
WPOS = {'noun': 'NOUN', 'verb': 'VERB', 'adj': 'ADJ', 'adv': 'ADV', 'prep': 'ADP', 'postp': 'ADP', 'pron': 'PRON',
        'det': 'DET', 'article': 'DET', 'conj': 'CCONJ', 'intj': 'INTJ', 'num': 'NUM', 'prefix': 'PFX', 'suffix': 'SFX',
        'phrase': 'EXPR', 'proverb': 'EXPR', 'prep_phrase': 'EXPR', 'name': 'PROPN', 'abbrev': 'ABBR',
        'contraction': 'EXPR', 'character': 'SYM', 'symbol': 'SYM', 'particle': 'ADV'}
KEEP_TAGS = {'transitive', 'intransitive', 'reflexive', 'colloquial', 'informal', 'formal', 'slang', 'vulgar',
             'derogatory', 'dated', 'archaic', 'obsolete', 'rare', 'figuratively', 'literally', 'humorous',
             'uncountable', 'countable', 'plural', 'impersonal', 'ergative', 'passive', 'offensive', 'proscribed',
             'nonstandard', 'euphemistic', 'pejorative', 'poetic', 'dialectal', 'idiomatic', 'Nynorsk'}
FORMOF_TAGS = {'form-of', 'alt-of', 'abbreviation', 'misspelling'}

def wikt_gender(d):
    for h in d.get('head_templates', []):
        m = re.match(r'^\S.*?\s(m|f|n|m or f|f or m|m or n|n or m|m or f or n|c)\b(?: or (m|f|n))?', h.get('expansion', ''))
        if m:
            s = m.group(0)
            gs = []
            if re.search(r'\bm\b', s.split(' ', 1)[1] if ' ' in s else ''): gs.append('Masc')
            if re.search(r'\bf\b', s.split(' ', 1)[1] if ' ' in s else ''): gs.append('Fem')
            if re.search(r'\bn\b', s.split(' ', 1)[1] if ' ' in s else ''): gs.append('Neuter')
            return gs
    return []

wikt = collections.defaultdict(list)   # (lemma lower, coarse) -> [wentry]
wikt_formof = collections.defaultdict(set)  # inflected form -> lemma words (from form-of senses)
nwk = 0
with open(os.path.join(RAW, 'kaikki', 'nb.jsonl')) as f:
    for line in f:
        d = json.loads(line)
        pos = WPOS.get(d.get('pos'))
        if not pos: continue
        senses = []
        topics = set()
        for s in d.get('senses', []):
            tags = set(s.get('tags', []))
            if tags & FORMOF_TAGS or s.get('form_of') or s.get('alt_of'):
                for fo in (s.get('form_of') or []) + (s.get('alt_of') or []):
                    if fo.get('word'): wikt_formof[d['word'].lower()].add(fo['word'])
                continue
            gl = s.get('glosses') or []
            if not gl: continue
            g = gl[-1] if len(gl) == 1 else (gl[0].rstrip(':. ') + ' — ' + gl[-1] if len(gl[0]) < 60 and gl[0] != gl[-1] else gl[-1])
            g = re.sub(r'\.$', '', g.strip())
            sense = {'g': g}
            lab = [t for t in s.get('tags', []) if t in KEEP_TAGS]
            if s.get('qualifier'): lab.append(s['qualifier'])
            if lab: sense['t'] = lab
            exs = []
            for x in s.get('examples', [])[:2]:
                tr = x.get('english') or x.get('translation')
                if x.get('text') and tr and len(x['text']) < 200: exs.append([x['text'], tr])
            if exs: sense['x'] = exs
            senses.append(sense)
            for c in s.get('categories', []):
                nm = c.get('orig', '') if isinstance(c, dict) else ''
                if nm.startswith('nb:') and c.get('kind') in ('topical', 'other', None): topics.add(nm[3:])
        if not senses: continue
        w = {'word': d['word'], 'pos': pos, 'senses': senses, 'g': wikt_gender(d)}
        if d.get('etymology_text'): w['ety'] = d['etymology_text'][:600]
        if topics: w['topics'] = sorted(topics)
        syn = [x['word'] for x in d.get('synonyms', []) if x.get('word')][:8]
        ant = [x['word'] for x in d.get('antonyms', []) if x.get('word')][:8]
        if syn: w['syn'] = syn
        if ant: w['ant'] = ant
        wikt[(d['word'].lower(), COARSE.get(pos, 'X'))].append(w)
        nwk += 1
log(' wiktionary entries with real senses', nwk)

# merge
all_lemmas = {k[0] for k in by_lemma} | {k[0] for k in wikt}
COMPAT = {'D': ['D', 'M', 'A', 'R', 'PN'], 'A': ['A', 'D', 'R'], 'R': ['R', 'A', 'P', 'C', 'D'], 'P': ['P', 'R'],
          'C': ['C', 'R', 'P'], 'I': ['I', 'R'], 'E': ['E', 'R', 'P'], 'M': ['M', 'D', 'A']}
matched_w = set()
shared_n = 0
for key, ids in by_lemma.items():
    lem, cp = key
    ws = wikt.get(key, [])
    if not ws:
        # fallback for function words / tagging differences: unique lemma, compatible POS
        for alt in COMPAT.get(cp, []):
            if alt == cp: continue
            cand = wikt.get((lem, alt), [])
            if cand and not by_lemma.get((lem, alt)):
                ws = cand; break
    if not ws: continue
    assign = {i: [] for i in ids}
    def compatible(w, e):
        wg, eg = set(w['g']), set(e.get('g', []))
        return not wg or not eg or bool(wg & eg)
    for w in ws:
        # homographs: a Wiktionary entry only goes to Bokmålsordboka entries whose noun gender fits
        tgt = [i for i in ids if compatible(w, entries[i])]
        matched_w.add(id(w))
        for i in tgt: assign[i].append(w)
        if len(tgt) > 1:
            for i in tgt:
                if not entries[i].get('ens'):
                    entries[i]['ens'] = 1   # English shared across homographs: cannot tell which sense belongs here
                    shared_n += 1
    for i, wl in assign.items():
        if not wl: continue
        e = entries[i]
        e['en'] = [s for w in wl for s in w['senses']]
        etys = [w['ety'] for w in wl if w.get('ety')]
        if etys: e['etyen'] = etys[0] if len(set(etys)) == 1 else ' / '.join(dict.fromkeys(etys))
        t = sorted({t for w in wl for t in w.get('topics', [])})
        if t: e['top'] = t
        syn = [x for x in dict.fromkeys(x for w in wl for x in w.get('syn', [])) if x.lower() in all_lemmas]
        ant = [x for x in dict.fromkeys(x for w in wl for x in w.get('ant', [])) if x.lower() in all_lemmas]
        if syn: e['syn'] = syn
        if ant: e['ant'] = ant
        for w in wl: matched_w.add(id(w))
log(' entries with English', sum(1 for e in entries.values() if 'en' in e), 'shared-homograph', shared_n)

# ---------------------------------------------------------------- Wiktionary English->Norwegian translation tables
# Human-written, sense-labelled translations on English Wiktionary entries ("house: Norwegian Bokmål: hus").
# Used only for Bokmålsordboka entries that still have no English.
EN_POS = {'noun': 'N', 'verb': 'V', 'adj': 'A', 'adv': 'R', 'prep': 'P', 'pron': 'D', 'det': 'D', 'conj': 'C',
          'intj': 'I', 'num': 'M', 'phrase': 'E', 'prep_phrase': 'E', 'name': 'PN', 'article': 'D', 'particle': 'R'}
TR_CACHE = os.path.join(RAW, 'kaikki_en', 'nb_translations.json')
TR_SRC = os.path.join(RAW, 'kaikki_en', 'en.jsonl.gz')
trans = None
if os.path.exists(TR_CACHE):
    trans = json.load(open(TR_CACHE))
elif os.path.exists(TR_SRC):
    import gzip
    log('extracting Norwegian translations from English Wiktionary (one-off, slow)')
    trans = []
    with gzip.open(TR_SRC, 'rt', encoding='utf-8') as f:
        for line in f:
            if '"nb"' not in line and '"no"' not in line and 'Bokm' not in line: continue
            d = json.loads(line)
            if d.get('lang_code') != 'en': continue
            ep = d.get('pos')
            tl = list(d.get('translations', []))
            for s in d.get('senses', []): tl += s.get('translations', [])
            for t in tl:
                code = t.get('lang_code') or t.get('code')
                if code not in ('nb', 'no') and t.get('lang') not in ('Norwegian Bokmål', 'Norwegian'): continue
                if code == 'nn' or 'Nynorsk' in (t.get('lang') or ''): continue
                w = (t.get('word') or '').strip()
                if not w or len(w) > 60: continue
                trans.append([w, d['word'], ep, (t.get('sense') or '')[:80], [x for x in t.get('tags', []) if x in ('masculine', 'feminine', 'neuter')]])
    json.dump(trans, open(TR_CACHE, 'w'), ensure_ascii=False)
if trans:
    GT = {'masculine': 'Masc', 'feminine': 'Fem', 'neuter': 'Neuter'}
    tr_by = collections.defaultdict(list)
    for nbw, enw, ep, sense, gt in trans:
        cp = EN_POS.get(ep)
        if cp: tr_by[(nbw.lower(), cp)].append((enw, ep, sense, [GT[g] for g in gt]))
    added = 0
    for key, ids in by_lemma.items():
        cand = tr_by.get(key)
        if not cand: continue
        for i in ids:
            e = entries[i]
            if e.get('en'): continue
            eg = set(e.get('g', []))
            senses, seen = [], set()
            for enw, ep, sense, gs in cand:
                if gs and eg and not (set(gs) & eg): continue
                g = ('to ' + enw if ep == 'verb' and not enw.startswith('to ') else enw)
                k = (g.lower(), sense.lower())
                if k in seen: continue
                seen.add(k)
                senses.append({'g': g + (f' ({sense})' if sense else '')})
            if not senses: continue
            senses.sort(key=lambda s: (len(s['g'].split(' (')[0]), s['g']))
            e['en'] = senses[:8]
            e['ensrc'] = 'tr'
            if len(ids) > 1: e['ens'] = 1
            added += 1
    log(' English added from translation tables', added)

# Wiktionary-only entries
next_id = 1_000_000
for key, ws in wikt.items():
    for w in ws:
        if id(w) in matched_w: continue
        e = {'id': next_id, 'src': 'wk', 'l': [w['word']], 'hg': 0, 'pos': w['pos'], 'en': w['senses']}
        if w['g']: e['g'] = w['g']
        if w.get('ety'): e['etyen'] = w['ety']
        if w.get('topics'): e['top'] = w['topics']
        syn = [x for x in w.get('syn', []) if x.lower() in all_lemmas]
        ant = [x for x in w.get('ant', []) if x.lower() in all_lemmas]
        if syn: e['syn'] = syn
        if ant: e['ant'] = ant
        entries[next_id] = e
        next_id += 1
log(' total entries incl. Wiktionary-only', len(entries))

# ---------------------------------------------------------------- forms map
log('forms')
def entry_forms(e):
    fs = set(x.lower() for x in e['l'])
    if 'inf' in e:
        for cell in e['inf']['f']:
            if cell:
                for w in cell.split('/'): fs.add(w.lstrip('~').lower())
    return fs

form_to = collections.defaultdict(set)
for e in entries.values():
    for fm in entry_forms(e): form_to[fm].add(e['id'])
# Wiktionary form-of senses (covers irregulars/wikt-only entries)
lem_to_ids = collections.defaultdict(set)
for e in entries.values():
    for l in e['l']: lem_to_ids[l.lower()].add(e['id'])
for fm, lems in wikt_formof.items():
    if fm in form_to: continue
    for l in lems:
        for i in lem_to_ids.get(l.lower(), ()): form_to[fm].add(i)
log(' forms', len(form_to))

# ---------------------------------------------------------------- frequency
log('frequency')
freq = {}
for line in open(os.path.join(RAW, 'freq', 'no_50k.txt'), encoding='utf-8'):
    p = line.split()
    if len(p) == 2: freq[p[0]] = int(p[1])
# Each surface form's corpus count is shared among the entries that can produce it, weighted by
# (a) a word-class prior (function words are far more frequent than nouns spelled the same way) and
# (b) how frequent the entry's *unambiguous* forms are (so "tok" goes to "ta", not the noun "tok").
PRIOR = {'ADP': 50, 'CCONJ': 50, 'SCONJ': 50, 'PRON': 50, 'DET': 40, 'ADV': 20, 'INTJ': 15, 'VERB': 5,
         'ADJ': 3, 'NUM': 3, 'NOUN': 2, 'EXPR': 1, 'PROPN': 0.5, 'ABBR': 0.05, 'SYM': 0.02, 'PFX': 0.02, 'COMPPFX': 0.02, 'SFX': 0.02}
eforms = {i: entry_forms(e) for i, e in entries.items()}
lemma_owner = collections.defaultdict(set)
for i, e in entries.items():
    for l in e['l']: lemma_owner[l.lower()].add(i)
pri = {i: PRIOR.get(e['pos'], 1) * (0.02 if any(c.isupper() for c in e['l'][0]) else 1) for i, e in entries.items()}
weight = {}
for i, e in entries.items():
    unamb = sum(freq.get(f, 0) for f in eforms[i] if len(form_to.get(f, ())) == 1)
    # citation-form count, shared by prior among entries with the same headword
    lshare = sum(freq.get(l, 0) * pri[i] / sum(pri[o] for o in lemma_owner[l]) for l in {x.lower() for x in e['l']})
    w = PRIOR.get(e['pos'], 1) * (1 + unamb + lshare)
    if any(c.isupper() for c in e['l'][0]): w *= 0.02      # abbreviations / names vs lowercase words
    if e.get('en') and not e.get('ensrc'): w *= 3          # documented in Wiktionary's Norwegian section
    if e['src'] == 'wk': w *= 0.5
    # headword that is also an inflected form of a different word (noun "kan" vs verb kunne -> kan)
    if any(o != i and l not in {x.lower() for x in entries[o]['l']} for l in {x.lower() for x in e['l']} for o in form_to.get(l, ())):
        w *= 0.1
    weight[i] = w
score = collections.defaultdict(float)
for f, owners in form_to.items():
    c = freq.get(f, 0)
    if not c: continue
    tot = sum(weight[o] for o in owners) or 1
    for o in owners: score[o] += c * weight[o] / tot
for i in entries: score[i] = score.get(i, 0.0)
ranked = sorted((i for i in entries if score[i] > 0), key=lambda i: -score[i])
rank = {i: r + 1 for r, i in enumerate(ranked)}
log(' ranked', len(rank))

# ---------------------------------------------------------------- pronunciation (NB Uttale, East Norwegian spoken)
log('NB Uttale')
UPOS = {'NN': 'N', 'VB': 'V', 'JJ': 'A', 'AB': 'R', 'PP': 'P', 'PN': 'D', 'DT': 'D', 'KN': 'C', 'SN': 'C', 'IN': 'I', 'RG': 'M', 'RO': 'A'}
needed = set(form_to.keys())
pron = collections.defaultdict(list)   # wordform lower -> [(coarsepos, feats, nofabet, ipa)]
with open(os.path.join(RAW, 'uttale', 'nb_uttale_leksika', 'e_spoken_pronunciation_lexicon.csv'), encoding='utf-8', newline='') as f:
    r = csv.reader(f); next(r)
    for row in r:
        wf = row[0].lower()
        if wf not in needed: continue
        cp = UPOS.get(row[1].split('|')[0], 'X')
        pron[wf].append((cp, row[2], row[5], row[6]))
log(' pronounced forms', len(pron))

def tone_of(nof):
    m = re.search(r'[A-Z]+([12])\b', nof)
    return int(m.group(1)) if m else 0

def common_prefix(a, b):
    a, b = a.split(), b.split(); n = 0
    for x, y in zip(a, b):
        if x != y: break
        n += 1
    return n

def pick(form, cp, ref=None):
    rows = pron.get(form.lower())
    if not rows: return None
    cand = [x for x in rows if x[0] == cp] or rows
    if ref:
        cand = sorted(cand, key=lambda x: -common_prefix(x[2], ref))
    return cand[0]

def ipa_fmt(s):
    # NST-style: ' = toneme 1 primary stress, " = toneme 2 primary stress
    return s.replace('"', 'ˈ').replace("'", 'ˈ')

npron = 0
for e in entries.values():
    cp = COARSE.get(e['pos'], 'X')
    lemma = e['l'][0]
    p = pick(lemma, cp)
    if not p: continue
    npron += 1
    e['ipa'] = ipa_fmt(p[3]); t = tone_of(p[2])
    if t: e['tone'] = t
    alts = []
    for x in pron.get(lemma.lower(), []):
        if x[0] == cp and x[3] != p[3] and ipa_fmt(x[3]) not in alts and len(alts) < 2: alts.append(ipa_fmt(x[3]))
    if alts: e['ipa2'] = alts
    if 'inf' in e:
        pf = []
        for cell in e['inf']['f']:
            if not cell: pf.append(None); continue
            out = []
            for w in cell.split('/'):
                q = pick(w.lstrip('~'), cp, p[2])
                out.append(f'{ipa_fmt(q[3])}' + (f'|{tone_of(q[2])}' if tone_of(q[2]) else '') if q else '')
            pf.append('/'.join(out) if any(out) else None)
        if any(pf): e['infp'] = pf
log(' entries with pronunciation', npron)

# ---------------------------------------------------------------- Tatoeba
log('Tatoeba')
def bzlines(name):
    with bz2.open(os.path.join(RAW, 'tatoeba', name), 'rt', encoding='utf-8') as f:
        for line in f: yield line.rstrip('\n').split('\t')
nob = {int(r[0]): r[2] for r in bzlines('nob_sentences.tsv.bz2') if len(r) >= 3}
links = collections.defaultdict(list)
for r in bzlines('nob-eng_links.tsv.bz2'):
    if len(r) >= 2: links[int(r[0])].append(int(r[1]))
need_eng = {x for v in links.values() for x in v}
eng = {}
for r in bzlines('eng_sentences.tsv.bz2'):
    if len(r) >= 3:
        i = int(r[0])
        if i in need_eng: eng[i] = r[2]
sentences = {}
for sid, txt in nob.items():
    tr = [eng[x] for x in links.get(sid, []) if x in eng]
    if tr: sentences[sid] = [txt, tr[:3]]
log(' sentences with English', len(sentences))
TOK = re.compile(r"[A-Za-zÆØÅæøåÉéÈèÊêÓóÒòÔôÜüÄäÖö'\-]+")
ent_sents = collections.defaultdict(list)
for sid, (txt, _) in sorted(sentences.items(), key=lambda kv: len(kv[1][0])):
    seen = set()
    for tok in TOK.findall(txt):
        for i in form_to.get(tok.lower(), ()):
            if i in seen: continue
            seen.add(i)
            if len(ent_sents[i]) < 40: ent_sents[i].append(sid)
for i, lst in ent_sents.items():
    if i in entries: entries[i]['ts'] = lst

# ---------------------------------------------------------------- write
log('writing')
os.makedirs(os.path.join(OUT, 'e'), exist_ok=True)
POSCODE = {'NOUN': 'n', 'VERB': 'v', 'ADJ': 'a', 'ADV': 'adv', 'ADP': 'prep', 'PRON': 'pron', 'DET': 'det',
           'CCONJ': 'conj', 'SCONJ': 'sconj', 'INTJ': 'intj', 'NUM': 'num', 'EXPR': 'expr', 'PFX': 'pfx',
           'COMPPFX': 'pfx', 'SFX': 'sfx', 'ABBR': 'abbr', 'SYM': 'sym', 'PROPN': 'name', 'X': 'x'}

def short_en(e, limit=200):
    if 'en' not in e: return ''
    s = '; '.join(plain(x['g']) for x in e['en'])
    return s if len(s) <= limit else s[:limit].rsplit(' ', 1)[0] + '…'

def short_no(e, limit=90):
    def first(defs):
        for d in defs:
            if d.get('e'): return plain(d['e'][0])
            if d.get('d'):
                r = first(d['d'])
                if r: return r
        return ''
    s = first(e.get('d', []))
    return s if len(s) <= limit else s[:limit].rsplit(' ', 1)[0] + '…'

# index: one row per entry, columns
ids_sorted = sorted(entries, key=lambda i: (rank.get(i, 10**7), i))
idx = {'id': [], 'l': [], 'p': [], 'g': [], 'hg': [], 'r': [], 'en': [], 'no': [], 'f': []}
for i in ids_sorted:
    e = entries[i]
    idx['id'].append(i)
    idx['l'].append('|'.join(e['l']))
    idx['p'].append(POSCODE.get(e['pos'], 'x'))
    idx['g'].append(''.join(g[0].lower() for g in e.get('g', [])))
    idx['hg'].append(e['hg'])
    idx['r'].append(rank.get(i, 0))
    idx['en'].append(short_en(e))
    idx['no'].append('' if e.get('en') else short_no(e))
    flags = ''
    if e['src'] == 'wk': flags += 'w'
    if e.get('ens'): flags += 's'
    if e.get('tone'): flags += str(e['tone'])
    idx['f'].append(flags)
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

# forms: only forms that are not a lemma of the same entry
lemma_set = collections.defaultdict(set)
for e in entries.values():
    for l in e['l']: lemma_set[l.lower()].add(e['id'])
forms_out = {}
for fm, ids in form_to.items():
    rest = sorted(i for i in ids if i not in lemma_set.get(fm, set()))
    if rest: forms_out[fm] = rest
json.dump(forms_out, open(os.path.join(OUT, 'forms.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

# detail shards
shards = collections.defaultdict(dict)
for i, e in entries.items():
    d = {k: v for k, v in e.items() if k not in ('id',)}
    if i in rank: d['r'] = rank[i]
    shards[i % NSHARDS][i] = d
for s, m in shards.items():
    json.dump(m, open(os.path.join(OUT, 'e', f'{s}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

json.dump({str(k): v for k, v in sentences.items()}, open(os.path.join(OUT, 'sentences.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

# ---------------------------------------------------------------- built-in lists
log('lists')
def top(pred, n):
    out = [i for i in ranked if pred(entries[i])]
    return out[:n]
lists = []
bands = [(1, 500), (2, 1500), (3, 3000), (4, 6000), (5, 12000)]
prev = 0
for lvl, hi in bands:
    lists.append({'id': f'band{lvl}', 'group': 'Frequency', 'name': f'Band {lvl}: words {prev+1}–{hi}',
                  'ids': [i for i in ranked[prev:hi]]})
    prev = hi
for name, pos, n in [('Top 300 verbs', 'VERB', 300), ('Top 500 nouns', 'NOUN', 500), ('Top 300 adjectives', 'ADJ', 300),
                     ('Top 200 adverbs', 'ADV', 200), ('Prepositions', 'ADP', 120), ('Conjunctions', 'CCONJ', 60),
                     ('Subordinating conjunctions', 'SCONJ', 60), ('Pronouns', 'PRON', 80), ('Determiners', 'DET', 120),
                     ('Interjections', 'INTJ', 80)]:
    lists.append({'id': 'pos-' + name.lower().replace(' ', '-'), 'group': 'Grammar', 'name': name,
                  'ids': top(lambda e, p=pos: e['pos'] == p and e['src'] == 'bo', n)})
lists.append({'id': 'strong-verbs', 'group': 'Grammar', 'name': 'Strong & irregular verbs',
              'ids': top(lambda e: e['pos'] == 'VERB' and 'strong' in e.get('cls', []) and e['src'] == 'bo', 400)})
lists.append({'id': 's-verbs', 'group': 'Grammar', 'name': 'S-verbs (deponent)',
              'ids': top(lambda e: 'sverb' in e.get('cls', []), 200)})
lists.append({'id': 'irregular-plurals', 'group': 'Grammar', 'name': 'Nouns with irregular or contracted plurals',
              'ids': top(lambda e: e['pos'] == 'NOUN' and 'irrplural' in e.get('cls', []), 300)})
for g, nm in [('Masc', 'Masculine'), ('Fem', 'Feminine'), ('Neuter', 'Neuter')]:
    lists.append({'id': 'gender-' + g.lower(), 'group': 'Grammar', 'name': f'{nm} nouns (top 300)',
                  'ids': top(lambda e, g=g: e['pos'] == 'NOUN' and e['src'] == 'bo' and (e.get('g') == [g] if g != 'Fem' else 'Fem' in e.get('g', [])), 300)})
lists.append({'id': 'tone2', 'group': 'Pronunciation', 'name': 'Tonelag 2 words (top 400)',
              'ids': top(lambda e: e.get('tone') == 2 and e['src'] == 'bo', 400)})
lists.append({'id': 'tone1-2syl', 'group': 'Pronunciation', 'name': 'Tonelag 1 two-syllable words (top 300)',
              'ids': top(lambda e: e.get('tone') == 1 and e.get('ipa', '').count('.') >= 1 and e['src'] == 'bo', 300)})
# toneme minimal pairs: the same written form (lemma or inflected) pronounced with tonelag 1 in one word, 2 in another
form_tones = collections.defaultdict(dict)
for i in ranked[:40000]:
    e = entries[i]
    if e['src'] != 'bo' or 'ipa' not in e: continue
    if e.get('tone'): form_tones[e['l'][0].lower()].setdefault(e['tone'], i)
    if e.get('infp'):
        for cell, pc in zip(e['inf']['f'], e['infp']):
            if not cell or not pc: continue
            for w, p in zip(cell.split('/'), pc.split('/')):
                if '|' in p and not w.startswith('~'): form_tones[w.lower()].setdefault(int(p.split('|')[1]), i)
pairs = []
for fm, tones in form_tones.items():
    if not (1 in tones and 2 in tones and tones[1] != tones[2]): continue
    # the pronunciation lexicon itself must list this spelling with both tones
    lex = {tone_of(r[2]) for r in pron.get(fm, [])}
    if {1, 2} <= lex and len(fm) > 2:
        pairs.append([fm, tones[1], tones[2]])
pairs.sort(key=lambda p: max(rank.get(p[1], 10**6), rank.get(p[2], 10**6)))
pairs = pairs[:200]
lists.append({'id': 'tone-pairs', 'group': 'Pronunciation', 'name': 'Tonelag minimal pairs', 'type': 'pairs',
              'pairs': pairs, 'ids': list(dict.fromkeys(i for p in pairs for i in p[1:]))})
topic_ids = collections.defaultdict(list)
for i in ranked + [i for i in entries if i not in rank]:
    for t in entries[i].get('top', []): topic_ids[t].append(i)
for t, ids in sorted(topic_ids.items()):
    if len(ids) >= 12 and not re.search(r'(Norwegian|Bokmål|English|terms|words|lemmas|forms|entries|derived|borrowed|inherited)', t, re.I):
        lists.append({'id': 'topic-' + re.sub(r'\W+', '-', t.lower()), 'group': 'Topics', 'name': t, 'ids': ids[:500]})
json.dump(lists, open(os.path.join(OUT, 'lists.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

meta = {'built': time.strftime('%Y-%m-%d'), 'entries': len(entries), 'bo': sum(1 for e in entries.values() if e['src'] == 'bo'),
        'wk': sum(1 for e in entries.values() if e['src'] == 'wk'), 'withEnglish': sum(1 for e in entries.values() if e.get('en')),
        'withPron': npron, 'forms': len(form_to), 'sentences': len(sentences), 'shards': NSHARDS,
        'lists': len(lists)}
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
log('done', meta)

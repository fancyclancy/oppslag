# Oppslag: a Shirabe Jisho-style dictionary for Norwegian Bokmål

An offline Norwegian Bokmål ⇄ English study dictionary for iPhone, installed from Safari with **Share → Add to Home Screen**. It's built the same way as `hairline-tracker`: plain HTML/CSS/JS, no build step, hosted on GitHub Pages.

## Where the data comes from (and why)

All the data comes from official or curated open datasets. Nothing is machine-translated or AI-generated.

| What | Source | Licence |
|---|---|---|
| Headwords, official spelling, definitions, examples, fixed expressions, etymology, **full inflection** | **Bokmålsordboka** (Språkrådet + UiB), downloaded article by article from the official open API `ord.uib.no` | CC BY 4.0 |
| Compound analysis (sykehus = syke + hus) | **Norsk ordbank bokmål** (Språkbanken) | CC BY 4.0 |
| IPA + **tonelag 1/2** (Norwegian pitch accent), per word *and* per inflected form | **NB Uttale**, Urban East Norwegian (Språkbanken) | CC0 |
| English meanings, English etymology, topic categories, synonyms | **English Wiktionary** via kaikki.org | CC BY-SA 4.0 |
| Example sentences with English translations | **Tatoeba** | CC BY 2.0 FR |
| Frequency ranking, "common" labels, frequency bands | **FrequencyWords** (OpenSubtitles 2018) | CC BY-SA 4.0 |

English meanings are attached to Bokmålsordboka entries by matching spelling, word class and noun gender. When Wiktionary can't tell two homographs apart (e.g. two different nouns spelled *bank*), the entry says the English covers all of them instead of guessing.

## Shirabe Jisho features and their Norwegian equivalents

| Shirabe Jisho | Oppslag |
|---|---|
| Kanji / kana / romaji input | Norwegian or English input; `aa` `ae` `oe` type å æ ø (like romaji); æ ø å key bar |
| Conjugated words find their dictionary form | Every inflected form finds its lemma (*gikk* → gå, past tense) |
| Wildcards `*` `?` | Same, for Norwegian and English |
| Pitch accent with accent line | **Tonelag 1/2** with a pitch contour drawn over the syllables, plus IPA for every inflected form |
| Audio | Device text-to-speech (Norwegian voice) for words, forms and sentences |
| Conjugation tables | Full official inflection/conjugation tables (incl. non-standard registered forms) |
| Kanji components / radical tree | Compound breakdown (*arbeids+plass*), plus compounds starting/ending with the word |
| Example sentences | Tatoeba sentences (with the word highlighted) + Bokmålsordboka usage examples; separate sentence search |
| Word origin | Bokmålsordboka etymology (Norwegian) + Wiktionary etymology (English) |
| JLPT / grade lists, lists by topic & grammar | Frequency bands 1–5, grammar lists (strong verbs, s-verbs, irregular plurals, genders…), tonelag lists and minimal pairs, ~150 topic lists |
| Common-word markers | "common" + band badge, frequency rank |
| Bookmarks, folders, notes | Favourites + custom lists, per-word notes |
| Flashcards (+ extras: choose card content, scratchpad) | Spaced-repetition decks from any list, NO→EN / EN→NO / both, choose what's on the back, type-the-answer mode |
| History with adjustable limit | Same |
| Word of the day | Same |
| Multi-character / clipboard search | Clipboard button; **Reader** breaks a pasted sentence into looked-up words |
| Custom theme, reorderable sections (Shirabe Extras) | Light/dark/auto, accent colour, text size, reorder/hide sections. Free. |
| Backup / restore, sharing lists | JSON backup/restore, Anki (TSV) export, share list |
| Keyboard shortcuts | `/` or ⌘K search, Esc, Space/1–4 in flashcards |
| Offline | Service worker; the full dictionary downloads in the background |

Not carried over: handwriting input and radical search (they only make sense for kanji), the Japanese names dictionary (Wiktionary proper nouns are included instead), and iCloud sync (a web app can't use iCloud, so use backup/restore instead).

## Rebuilding the data

```bash
cd pipeline
python3 -I fetch_ordbok.py   # ~95k articles from ord.uib.no (resumable, ~1 h)
python3 -I build.py          # writes ../app/data/
```

The other raw files (`raw/kaikki`, `raw/ordbank`, `raw/uttale`, `raw/tatoeba`, `raw/freq`) come from the URLs listed at the top of `build.py`. Run `fetch_ordbok.py` again any time to pick up Bokmålsordboka's latest edits.

## Running locally

```bash
python3 -m http.server 8790 --directory app
```

Then open http://localhost:8790.

## Adapting it to another language

The app in `app/` doesn't depend on Norwegian: search, word pages, flashcards, lists, the reader, Anki export and offline mode all read from the data files in `app/data/`. Making, say, a Spanish version means producing that data and changing the Norwegian-specific wording. It is not a setting, but it is a small project. Rough steps:

1. **Fork the repo** and turn on GitHub Pages for your fork (publish the `app/` folder).
2. **Pick sources for your language.** Three of the sources here cover many languages: English Wiktionary via [kaikki.org](https://kaikki.org) (definitions, inflection, English meanings), [Tatoeba](https://tatoeba.org) (example sentences with translations) and [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (word frequency). The three Norwegian-only sources (Bokmålsordboka, Norsk ordbank, NB Uttale) need replacing: use another open dictionary for your language, or rely on Wiktionary alone.
3. **Rewrite `pipeline/build.py`** to read your sources and write the same output files into `app/data/`. The URLs at the top of the file show what each source provides and where it goes. Language-specific features (Norwegian tone, noun gender) can be dropped or swapped for equivalents.
4. **Change the Norwegian-specific text in `app/js/app.js`, `app/index.html` and the web manifest**: the name, the æ ø å key bar, the text-to-speech voice, and wording about tone and gender.
5. **Credit your sources** in the About screen. Check each licence, since several (Wiktionary, FrequencyWords) require attribution and share-alike.

Python plus a coding assistant makes this much faster, but expect to spend time on the data step, and to check the results by hand.

## Licence

The code is released under the [MIT licence](LICENSE). The dictionary data is not covered by it: each source keeps its own licence, listed in the table above, which require attribution and, for Wiktionary and FrequencyWords, share-alike.

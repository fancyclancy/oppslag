# Oppslag

Offline Norwegian Bokmål ⇄ English dictionary, modelled on Shirabe Jisho. Plain HTML/CSS/JS PWA in `app/` (no build step), data built by `pipeline/build.py` into `app/data/`. Published to GitHub Pages from the `gh-pages` branch (`git subtree split --prefix app -b gh-pages`).

## Design direction (v3, 2026-11-21)

Intentional, editorial, not "generic AI app". Built from four references the owner chose:

- **Merriam-Webster "remedy" concept**: full colour fields (plum, mustard, sage) on a near-black backdrop; huge grotesk headword; definitions in a large serif; a thin outlined "PLAY →" pill; a hairline rule above small footnote text.
- **Apple Dictionary / Contacts icons**: tactile leather book with a visible page block → the app icon.
- **Notion**: spacing and readability; bold title with a grey second line; hairline 1px borders instead of soft shadows.
- **Speak Sync**: warm grey base, pastel action tiles, solid dark primary button.

Rules that keep it intentional:
- **Colour carries meaning.** The word-page hero and flashcards take a field colour from the word class: noun = mustard, verb = sage, adjective = plum (coral headword), everything else = rose (`fieldOf()` in `app.js`). Don't add colour for decoration.
- **Two typefaces with jobs**: Schibsted Grotesk (a Norwegian newspaper grotesk) for headwords and interface; Newsreader serif for meaning (English meanings, definitions, example sentences). Gentium for IPA.
- **Hairlines, not shadows.** Cards and inputs use 1px `--rule` borders. Shadows (`--float`) only for things that float: menus, the pager, modals.
- **No bare badges.** Everything says what it is in words ("Tone 2", "Common word"), never "C", "T2", "n1".
- No uppercase tracked "eyebrow" labels (a template cliché): section labels are sentence case, 13px semibold, under a hairline.

## Tokens (defined at the top of `app/styles.css`)

### Type

| Role | Family | Size / line-height |
|---|---|---|
| Word-page headword | Schibsted Grotesk 600, −0.05em | 56–72 / 0.95 mobile, 120 desktop |
| Word of the day | Newsreader 400, coral on plum | 76 (112 desktop) |
| Sentence page sentence | Newsreader 400 | 34 / 42 (44 / 54 desktop) |
| Page titles (Notion style) | Schibsted Grotesk 700, −0.035em | 34 / 38 (44 / 48 desktop) |
| Single meaning lead | Newsreader | 34 / 40 |
| Meanings | Newsreader | 26 / 32 |
| Row headword, forms | Schibsted Grotesk 600 | 21 / 26 |
| Definitions, body prose | Newsreader | 19 / 27 |
| Glosses in rows | Newsreader | 17 / 23 |
| UI text | Schibsted Grotesk | 17, 16, 15 |
| Labels, metadata | Schibsted Grotesk 600 / 400 | 13 / 18 |
| Minimum | | 12 |

Fonts are self-hosted in `app/fonts/` (SIL OFL), subset with fonttools to Latin + Norwegian (and, for Gentium, only the IPA characters the data uses). To regenerate: download the TTFs from github.com/google/fonts and run `pyftsubset … --flavor=woff2`.

### Spacing and shape

4-point scale: 4, 8, 12, 16, 24, 32, 48, 64 (`--space-1…8`). Radii: 8, 12, 20, 28, pill. Widths: `--page-narrow` 700px, `--page-max` 1080px (word page), `--measure` 36em.

### Colour

| Token | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `--paper` | `#F5F2EC` | `#1C1B1C` | page | |
| `--card` | `#FFFEFB` | `#252325` | cards, inputs | |
| `--sunken` | `#ECE8E0` | `#2E2B2E` | pressed, segmented control | |
| `--rule` | `#DCD6CB` | `#3B383B` | hairlines | |
| `--ink` | `#1E2421` | `#EDE8E1` | text | 14.1 / 14.1 |
| `--ink-2` | `#4F5653` | `#C5BFB7` | secondary | 6.7 / 9.4 |
| `--ink-3` | `#5E6360` | `#A39D95` | tertiary | 5.5 / 6.4 (5.0 on sunken) |
| `--link` | `#5B4A5F` plum | `#D9C3DC` | links, the one interactive colour | 7.3 / 10.5 |
| `--mustard` | `#DFB94F` | same | noun field | ink 8.4 |
| `--sage` | `#96B07C` | same | verb field | ink 6.6 |
| `--plum` | `#5B4A5F` | same | adjective field, splash, word of the day | `--on-plum` `#F6ECEE` 7.0 |
| `--rose` | `#EFB4BC` | same | other word classes | ink 9.0 |
| `--coral` | `#F77A8C` | same | **large display type on plum only** | 3.1 (AA large) |
| tints `--mustard-t` `--sage-t` `--plum-t` `--rose-t` | pastel | deep | tiles, highlights, flashcard grade tiles | ink-2 ≥ 6.0 |

Verified with axe-core 4.10 (WCAG 2 A/AA): zero violations on home, search, word pages, lists, bookmarks, history, settings, about.

## Components

- **Word page**: colour-field hero (kicker in serif lowercase, headword, IPA · "Tone N" link, outlined `LISTEN →` pill `.pill-out`), then meanings in large serif, then sections under hairline labels; desktop = two columns with a sticky pronunciation/forms panel.
- **Home**: Notion title "Ordbok. / Slå opp et ord.", plum Word of the day card (coral serif word, hairline footer), four Speak Sync tiles (sage, mustard, plum, rose tints), recent words.
- **Launch screen** (`#splash`): the app icon (`bok7-logo.png`), 112px, centred on `--paper`, like a native launch screen. Cold starts only: held for at least 300ms after navigation start; the first page is given two frames to paint underneath, then the launch screen fades out as one still layer in 300ms. The icon never moves or scales: a scale lift on the drop-shadowed icon made iOS redraw it every frame at shifting sub-pixel positions, which showed as a jitter (2026-11-23). A resumed app never shows it; when a new release arrives while the app is in use, it reloads the next time the app goes to the background, with `sessionStorage['oppslag.quiet']` set so the reload skips the launch screen. `forms.json` (7 MB) loads after the first screen, not before it; searches wait for it with `db.formsReady()`.
- **Lists/settings**: hairline-bordered groups (`.group`), large page titles that hand off to the top bar (`watchLargeTitle()`).
- **Flashcards**: card is the word's colour field; sentence cards are a "page" (`f-page`: card colour, hairline, serif sentence, word list on the back); grade buttons are pastel tiles.
- **Decks as folders** (`.folder`, owner's reference: a links app's collection folders): tab + back panel in the deck's colour (`d.color`, the user picks mustard/sage/plum/rose; older decks fall back by position), two paper sheets peeking out, hairline front panel with icon tile, counts top right, name and direction bottom left. Hover or press tips the front open (`rotateX(-9deg)`), the sheets rise. Press and hold a folder for its options sheet (name, direction, colour, delete). The reference's black offset shadows were left out on purpose: hairline world.
- **Example sentences** are first-class like in Shirabe: `#/x/<Tatoeba id>` is a sentence page (large serif sentence with every word linked, Listen and Copy pills, translations, "Words in this sentence" rows, star and bookmark). Saved in lists as the string `"x<id>"` next to numeric word ids, so they flow into bookmarks, decks, Anki export and share. Anywhere a sentence appears (`[data-sent]`: word-page examples, example search, flashcard backs, sentence cards) press and hold for 460ms to open it; a tint fills in from the left while holding (`setupHold()` in `app.js`). A one-line hint shows until the first hold.
- **Icons**: Phosphor (regular), MIT, inlined in `app/js/icons.js`.

## Navigation and motion (2026-11-22)

- Page changes use View Transitions: deeper = the new page slides in over the old (iOS push, 0.42s on phones), back = the page slides off (faster, 0.82×), same level = crossfade 0.18s. The top bar, drawer and scrim are their own transition layers.
- **Nothing loads inside a transition.** A transition freezes the screen while its callback runs, so: `warmUp()` loads lists, sentences and the forms table one at a time after launch (never during a transition), and `preload(hash)` makes sure a page's data is in memory before the transition starts (it resolves at once when warm; on a cold visit the page dims after 120ms to show the tap registered). Never race or time-cut the transition callback: that captures half-built pages.
- Back is decided by intent, not by URL: `goBack()` sets `expectBack`; a link to the page you came from is a forward step.
- **Menu and swipe-back follow the finger (Shirabe).** Below 1100px the menu (`#drawer`) lies still underneath and the page layer (`#pagebg` + `.topbar` + `#view` + `#pager`, moved together by `--page-x` in `placePage()`) slides right to reveal it, stopping at 74% (max 300px) with a soft shadow on its edge; the visible strip (`#scrim`, transparent) closes it on tap. Choosing a menu item draws the new page inside the strip, then glides it back over the menu (440ms; opening 400ms; ease `cubic-bezier(.32,.72,0,1)`). On deeper pages the same drag is an iOS-style swipe-back: the page follows the finger and the previous page shows underneath (`#under`, built from the snapshot `snapshotPage()` took when it was left), 30% behind and lightly shaded.
- **Swipes start anywhere, not just at the edge** (owner's request, like Shirabe): a drag to the right from any point opens the menu (top-level page) or goes back (deeper page); with the menu open, a drag to the left anywhere closes it. A drag becomes a swipe after 10px sideways and only if it is clearly more sideways than vertical (×1.4); drags that start in a text field, slider, `#keybar` or any sideways-scrolling element are left alone (`ownsSideways()`). Releases finish on a flick (>0.3px/ms) or past a third of the way (back: 33% of the screen; menu: 35% of its width to open, 65% to stay open), taking the rest of the distance at the finger's speed (`releaseMs`); a finger that stopped before lifting counts as no flick. A `touchcancel` (the system took the touch) always springs back. A swipe that starts mid page-transition skips that transition and takes over.
- **Nothing scrolls sideways.** `html` has `overflow-x: hidden` and `body` `overflow-x: clip` (clip, because hidden would make body its own scroller), plus a scroll listener that resets `scrollX`. Without it, the page layer pushed right made the document wider than the screen; iOS let the finger pan it, and the content slid off its top bar while the menu closed (owner's recording, 2026-11-23).
- **The swipe-back picture must stay put.** `#under` holds copies of `.topbar` and `#view` (same id and class), so the page-layer transform rules matched them too: the picture followed the page off-screen and a finished swipe-back showed a blank screen. `#under .topbar, #under #view` cancel the transform. Any new rule that moves the page layer needs the same exception.
- **Swipe-back hand-off has no flash.** The shade on `#under` lifts with the page (`--page-p`, 0–1, set in `placePage()`), so the page underneath is at full brightness when the real page replaces it. `watchLargeTitle()` judges the large title on the vertical only: at the end of a swipe-back the new page is drawn while still parked off to the right, and an `isIntersecting` check counted that as scrolled past the title and flashed the small top-bar title (owner's recording, 2026-11-23).
- **The Home Screen app keeps one history entry (`OWN_HISTORY`).** iOS 26 gives Home Screen web apps a system swipe-back that drags in a screenshot of the previous history entry; with the app's own gesture running at the same time, the screen split into the menu, a stale screenshot (often with the menu open) and the page (owner's recording, 2026-11-23). So in the standalone app on touch devices every step replaces the entry: links are intercepted, `nav(hash)` uses `location.replace`, `go()` uses `replaceState`, and `goBack()` replaces with the previous `navStack` entry. The app's `navStack` is the only back stack and the system gesture has nowhere to go. Always navigate with `nav()`, never `location.hash =`.
- In an iOS Safari tab (`BROWSER_EDGE`, detected by user agent) the browser owns the left edge and history works normally: touches starting in the leftmost 24px are left to Safari, and a popstate during such a drag (or with `hasUAVisualTransition`) skips the app's animation.
- The top bar is solid `--paper` (no backdrop blur): the blur cost frames on scroll and had to be swapped during transitions, which flicked.

## Data rule: spellings

An entry with several spellings (bo/bu, malm/malme) is matched to Wiktionary once per spelling. The build keeps one match per entry, preferring: a real page over a stub ("form removed in the reform", "alternative form of"), then a spelling no other dictionary word shares, then the main spelling. Before this rule the last spelling won, so *bo* "to live" showed the archaic *bu* "to prepare".

## App icon (v5, 2026-11-22)

A leather-bound book after Apple's Dictionary icon: oxblood pebbled leather, the cover's bottom edge rolling down round the pages' top-left corner into the spine (left), a soft Moleskine-like cover corner (radius 190 at 1024) under which the pages sweep steeply up the right side, pages set in by an even back-cover margin (40px) below and to the right with a fore-edge corner parallel to the icon's own corner, light from the top with a shadow toward the spine and shading on the pages under both covers' lips, showing only along the bottom with fine page lines that curve up into the spine and up the fore-edge (right, where the book opens), and one light-red edge highlight running round the whole book (cover edge, spine curve, back cover, right edge). On the cover, a drawn cream "ø": a near-round O with a tall stadium counter (thick sides, thin top and bottom), a parallelogram slash with flat horizontal ends that runs past the letter, joined to the top and bottom arcs with a thin gap at the other two ends (a pinwheel). The O and slash are one shape with one gradient (no seam).

Source: `pipeline/icon_svg.py` (SVG; design "C") → `pipeline/render_icon.py` renders it with headless Chrome (needed for the leather and paper filters) into `app/icons/bok7-180.png` (apple-touch-icon), `bok7-192.png`, `bok7-512.png` (also maskable), `bok7-logo.png` (384, launch screen and menu). Review sheets are in `design/icon-v5/`. When the icon changes, change the `bok7` prefix and the manifest file name: iOS caches both by URL.

## Status bar

The page has a single `<meta name="theme-color">`, set before first paint by an inline script in `index.html` to the app's background (`#F5F2EC` light, `#1C1B1C` dark), and `applyTheme()` keeps it in sync. The manifest (`app/oppslag-v7.webmanifest`) has `theme_color`/`background_color` `#1C1B1C`; like the icons, give it a new file name whenever these change, because iOS reads it once at install and Safari may serve a cached copy. iOS reads these when the app is added to the Home Screen, so changes need a re-add.

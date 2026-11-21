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
| Word of the day, splash | Newsreader 400, coral on plum | 76 (112 desktop), splash 120–280 |
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
- **Splash**: plum field, "Opp/slag" in coral Newsreader running off the edges, credit line over a coral hairline.
- **Lists/settings**: hairline-bordered groups (`.group`), large page titles that hand off to the top bar (`watchLargeTitle()`).
- **Flashcards**: card is the word's colour field; grade buttons are pastel tiles.
- **Icons**: Phosphor (regular), MIT, inlined in `app/js/icons.js`.

## App icon

A leather-bound book (oxblood cover with grain and a soft top light, cream page block with curved page edges, thin back cover) with a white Helvetica Neue Bold "ø" whose slash is a solid blue bar (`#25468C`). Generated by `pipeline/make_logo.py` → `app/icons/` (`book-180.png` = apple-touch-icon, `book-192.png`, `book-512.png`, `logo.png`). When the icon design changes, change these file names too: iOS caches icons by URL.

## Status bar

The page has a single `<meta name="theme-color">`, set before first paint by an inline script in `index.html` to the app's background (`#F5F2EC` light, `#1C1B1C` dark), and `applyTheme()` keeps it in sync. The manifest's `theme_color`/`background_color` are `#1C1B1C`. iOS reads these when the app is added to the Home Screen, so changes need a re-add.

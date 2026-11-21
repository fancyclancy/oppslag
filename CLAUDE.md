# Oppslag

Offline Norwegian Bokmål ⇄ English dictionary, modelled on Shirabe Jisho. Plain HTML/CSS/JS PWA in `app/` (no build step), data built by `pipeline/build.py` into `app/data/`. Published to GitHub Pages from the `gh-pages` branch (`git subtree split --prefix app -b gh-pages`).

## Design direction

Calm, bookish, Scandinavian: the iOS Dictionary crossed with Things 3. **The headword is the hero.** Paper-white pages, one quiet accent, generous whitespace, thin rules instead of boxes, serif for the words being studied and sans for the interface around them. Nothing decorative; every badge must explain itself.

## Design tokens

> Status: **approved** (2026-11-21). Defined on `:root` in `app/styles.css` (bottom section). Applied so far to the **word page only** (`.wpage`, `w-*` classes in `app/js/app.js`); other pages still use the older styles and should migrate to these tokens. The word page uses `--tok-accent` (fjord) while the rest of the app still uses the user-picked `--accent` (sage by default); unify when the other pages migrate.

### Type

Two families. Serif is reserved for Norwegian words being studied (headwords, forms, example sentences); sans for interface and English.

```css
--font-serif: ui-serif, "New York", "Iowan Old Style", "Charter", Georgia, serif;
--font-sans:  -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
--font-ipa:   "Charis SIL", "Doulos SIL", ui-serif, Georgia, serif;
```

Seven sizes, nothing in between (size / line-height, px). Weights: 400, 500, 600 only.

| Token | Mobile | ≥ 900px | Use |
|---|---|---|---|
| `--text-hero` | 44 / 48, serif 600 | 64 / 68 | Headword on the word page |
| `--text-title` | 28 / 34, sans 600 | 32 / 38 | Page titles, word-of-the-day word |
| `--text-headline` | 20 / 26, serif 500 | 20 / 26 | Headwords in result rows, inflected forms |
| `--text-body` | 17 / 25, sans 400 | 17 / 26 | Meanings, definitions |
| `--text-callout` | 15 / 21, sans 400 | 15 / 22 | Secondary lines, examples' translations |
| `--text-footnote` | 13 / 18, sans 400 | 13 / 18 | Metadata, sources, IPA of forms |
| `--text-eyebrow` | 12 / 16, sans 600, uppercase, +0.06em | same | Section labels ("MEANINGS", "FORMS") |

Minimum text size is 12px. No `em`-based one-off sizes.

### Spacing

4-point base, eight steps. Every margin, padding and gap uses one of these.

```css
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
--radius-s: 8px; --radius-m: 12px; --radius-pill: 999px;
--measure: 34em;          /* max line length for definitions */
--page-max: 1080px;       /* desktop content width */
```

Row padding `--space-3` × `--space-4`; between sections `--space-6` (mobile) / `--space-7` (desktop); page side gutter `--space-4` (mobile) / `--space-6` (desktop).

### Colour: one accent + neutrals

All text pairs pass WCAG AA (4.5:1) on every background listed; ratios measured.

| Token | Light | Dark | Use | AA check (light / dark, on paper) |
|---|---|---|---|---|
| `--paper` | `#FAF8F3` | `#141618` | Page background | n/a |
| `--surface` | `#FFFFFF` | `#1C1F22` | Raised panels, cards, buttons | n/a |
| `--sunken` | `#F1EEE7` | `#24282C` | Search field, selected row | n/a |
| `--rule` | `#E4E0D6` | `#2E3236` | Hairlines between rows and sections | n/a |
| `--ink` | `#1D2125` | `#ECEAE4` | Headwords, body text | 15.3 / 15.1 |
| `--ink-2` | `#4A5157` | `#B8BCBE` | Secondary text, translations | 7.6 / 9.5 |
| `--ink-3` | `#626970` | `#8F959A` | Tertiary: metadata, articles, IPA of forms | 5.2 / 6.0 (4.8 / 4.9 on sunken) |
| `--accent` | `#3A6788` | `#8CB3D4` | The only accent: links, active states, focus, IPA | 5.7 / 8.2 |
| `--on-accent` | `#FFFFFF` | `#141618` | Text on accent fills | 6.0 / 8.2 |

`--accent` is "fjord blue". The user's accent picker swaps this one token (sage alternative: `#4D7444`, 5.1:1).

Rules:
- **One accent.** No second hue for tonelag, "common", or labels. Tonelag is shown by the contour drawing and a text label ("Tone 2"), not by colour.
- Status colours are allowed only for flashcard grading buttons.
- No coloured section bands; sections are separated by whitespace and an eyebrow label.
- Every badge or abbreviation has a visible label or a one-tap explanation; no bare "C", "T2", "n1", "#13,421".

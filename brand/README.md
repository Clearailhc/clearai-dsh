# ClearAI brand mark

**The mark is one glyph: the opening of a `c`, plus one fact.**

```
c        = Clear (say it clearly)
opening  = it does not close — completion passes admission, it is not declared by the model
solid dot = a fact (the emerald used in the world tree when a branch is adopted)
```

Three meanings in one shape, nothing spare. That is why it was chosen.

## Files

| File | What it is | Used by |
|---|---|---|
| `logo.svg` | **the single master** (1024 grid; the main stroke is `currentColor`) | every bitmap is generated from it |
| `logo-wordmark.svg` | the wordmark `clearai` (`clear` in ink, `ai` in brand teal); typeset, not outlined | lockups |
| `logo-lockup.svg` | mark + wordmark, horizontally locked | README, package page, documents |
| `logo-512.png` · `logo-512-dark.png` | the mark, transparent, ink / inverted | README (light / dark) |
| `logo-lockup.png` · `logo-lockup-dark.png` | the lockup, ink / inverted | README, npm page |
| `build-icons.mjs` | **the generator**: master → the four bitmaps above | re-run it after any change to the master |
| `social-preview.svg` · `social-preview.png` | **the GitHub repository card image** (1280×640; GitHub requires < 1 MB) | uploaded by hand in *Settings → General → Social preview* |
| `build-social-preview.mjs` | **the generator**: lockup + claim + the ontology figure → the two files above | re-run it after any change to the brand, the claim or the figure |

Bitmaps are never hand-edited: `build-icons.mjs` regenerates the whole set in one command, and a hand-exported file would be a second ledger for the brand.

```bash
node brand/build-icons.mjs      # needs google-chrome on PATH (headless rasteriser)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node brand/build-social-preview.mjs   # repo card image
```

## Rules

- **Minimum size 16px.** The 16px column is the only judge; test any new proposal there first.
- **One source, two themes.** The main stroke is `currentColor`; colour comes from context, so it is never hard-coded in the master.
- **The dot stays emerald `#10B981`.** It is a product-semantic colour (the world tree's "adopted / settled"), and does not follow the theme.
- **Do not move the dot back to the centre.** A dot at the centre is © and CircleCI (ring plus centre dot — same structure); our dot sits **in the opening**.
- **Do not straighten the opening.** An opening pointing due right is just a `c`; angled up-right (centred on −35°) is what makes it recognisable.
- **The repo card only reads the social preview.** GitHub's topic/search cards scale the image to the container width and clip it at `max-height:275px`, so lockup, title and the one-line claim all sit inside the top 43%; the lower half (ontology figure, loop stages) is decoration that survives being cropped away. README images never appear on a card.
- Backgrounds: light `#FBFAF7` (warm paper) / dark `#1C1A18` (warm ink); brand teal `#3E8E7A`.

## What was removed

Only the chosen brand assets and their generator belong to this repository. The master artwork is the sole source for generated bitmaps; no external archive or prior design process is required to interpret the brand.

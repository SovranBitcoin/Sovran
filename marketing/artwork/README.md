# Sovran artwork

One pipeline combines **concept × named layout × aspect**. Edit the JSON in
`source/`; compare all layouts in `generated/contact-sheets/<concept>.png`, then
choose one layout per aspect in `source/selection.json`. Each sheet includes all
eight layout descriptions, three labelled aspect columns, selected markers,
explicit n/a reasons and red warnings for missing-input drafts.

- Wide: **2048×1000** (2.048:1), tall: **1080×1920**, square: **1080×1080**.
- Selected PNGs: `generated/<concept>/<aspect>.png`.
- Store banners: `generated/feature-graphic/{ios,android}/1024x500.png` are plain
  Lanczos downscales of the selected feature concept's platform-specific wide
  render. The iOS companion is promotional artwork, not an App Store screenshot.
- `--variants` retains every applicable full-size render under ignored
  `generated/variants/<concept>/<layout>/<aspect>.png` for local comparison.
- Outputs are opaque sRGB PNGs, under 15 MiB each; contact sheets are 1500 px wide.

```sh
node scripts/artwork.mjs --allow-missing
node scripts/artwork.mjs --check --allow-missing
node scripts/artwork.mjs --only wallet --variants
bun run assets:test
bun run assets:check
```

`--check` rerenders and compares exact bytes and manifest records without writes.
Full checks also reject unexpected committed output files. `--only` updates or
checks one concept and preserves other manifest entries without certifying them;
if it selects `selection.featureGraphic`, both platform banners update too.
All inputs and renders validate before staged outputs replace committed files.
`--allow-missing` tolerates absent inputs only: bad hashes, unreadable images,
invalid catalog/selection and copy collisions still fail. Strict mode fails even
when only an unselected applicable variant needs an input. Root/app asset commands
explicitly allow labelled drafts during capture work; unlike the old skip, they
always verify every committed output. Remove that allowance when captures finish.

## Layout and source contracts

`source/layouts.json` owns IDs, descriptions, phone counts, copy placement, canvas
sizes and the 6.25%-of-short-side margin. The shared geometry implementation in
`scripts/artwork.mjs` provides hero-fan, spotlight, duo, triptych, stack, closeup,
portal and pack. Every applicable layout renders in all three aspects. A concept
lists ordered screenshots, background (`brand`, `wallpaper`, `tint`), allowed
layouts and its copy key. One-phone layouts use the first screenshot; hero-fan
paints the first screenshot in front; pack uses distinct images of one album.
Tall pack layouts use two-column rows instead of shrinking a landscape row into the
upper half of a portrait canvas. Tall triptychs use a broad descending zigzag; lower
phones paint above earlier screens so every phone header stays visible.
Every concept renders all six general layouts, repeating its retained screenshot
when additional phone slots are needed. Portal requires a matching wallpaper;
pack requires distinct screenshots from the same album. These two material
requirements are the only n/a cases. Missing registered
captures are drafts, not n/a.

All phones use the shared bezel/rim/shadow and **full native screenshots**,
including status bar and home indicator. Rotation is 2D only. Intended bottom
bleed in hero-fan, stack and closeup belongs to the canvas composition, never an
input crop. Mona Sans is outlined from bundled font files and the brand lockup
uses canonical S/wordmark geometry. Headlines and subtitles each fit at most two
lines; the renderer asserts that the copy box does not intersect any phone's
rotated frame bounds. The manifest retains those bounds for review.

`source/screenshots.json` retains the page/file/run/sha256 contract. Screenshot
keys describe capture variants; `page` remains the actual canonical screen.
Retained store images are byte-identical to their original runs, pinned separately
in `scripts/fixtures/artwork-store-pins.json`. Do not overwrite them with a newer
capture without explicitly changing those pins. No originals or old generated
aliases remain in the previous `featured` or `feature-graphic` trees.

## Copy voice

Benefit before mechanism; prefer verb-first 2–5 words and name what the screen
does. Cash is the metaphor. No protocol words in headlines (Cashu, Nostr,
Lightning, ecash, proofs, NUT); use “mint” only for mint screens. The headline
promises; the subtitle proves, never “Explore…”. Claim only shipped behavior:
no “your keys”/self-custody on wallet frames and no onchain-send claims. Prefer
one sentence, one full stop; no exclamation marks or chains of period fragments.

`source/copy.json` retains the task's supplied researched copy **verbatim**, with
all alternatives and independent zero-based headline/subtitle choices, initially
zero. Some supplied choices themselves exceed the preferred word count or use
multiple sentences; they are explicit editorial exceptions, not silently rewritten.
Revision 2 tightens the backup language: a phrase is not a guarantee that all funds,
accounts or message history can be restored. Artemis concepts now name the collection
and its per-currency wallpapers. The original selection indexes remain unchanged.
Increment the copy version when
revising wording; hashes also detect choice/content changes. These files record
the supplied copy direction, not a new independent product-claims certification.

## Real wallpapers and portals

The supplied `source/wallpapers/catalog.json` is the original Nagg response,
including eventId, themeName, displayName, SHA-256, Blossom URL, album and palette.
All 13 retained portrait JPEGs must hash to their catalog entries. Rendering never
fetches network data. DNS access was unavailable during X2; the orchestrator had
already supplied the snapshot and portrait bytes. For an explicit refresh in a
network-enabled environment:

```sh
bun run assets:wallpapers                    # download pinned portraits
bun run assets:wallpapers --refresh-catalog  # deliberately refresh snapshot
```

Review the refreshed catalog and acquire corresponding panoramas/provenance before
regenerating. The Colors album retains its existing palette SVGs and provenance
under `source/wallpapers/colors/`; it is synthetic, not photography.

`source/wallpapers-wide/` retains all 13 supplied 2:1 outpaintings and their original
provenance. Eleven are 3840×1920; `looking-back-at-earth` and `vavilov-crater` were
supplied at 2048×1024. Preserve these actual dimensions and hashes; do not upscale
originals just to match a nominal size. Portal wide/square backgrounds first
restore the original portrait at panorama height in the centre strip, with only
24 px of outward feathering at each vertical edge, preserving the full original strip. The canvas crop places that strip behind the phone so generated flanks never appear inside its screen. Manifest records `centreRestored: true`
for that operation. Tall uses the original portrait. The matching wallpaper is
sharp inside the phone and canvas-aligned, blurred at approximately sigma 24 and
35% darker outside.

An opaque capture cannot expose canvas-aligned wallpaper without a **reviewed UI
mask**. Add `uiMask: {file: "source/masks/ios/wallet-in-eclipse.png", sha256: "…"}`
to its screenshot entry. Mask dimensions must equal the full native screenshot:
white preserves captured UI, black reveals the wallpaper, gray feathers edges.
Do not infer text/card transparency from pixel color, fabricate UI or omit the
status bar. Missing masks render blank portal phones with a DRAFT warning; the
restored photo can still be inspected. This existing provenance requirement
remains until an actual transparent UI capture mechanism is supplied.

## Capture handoff

No simulator runs are part of this task. The orchestrator runs
`app/e2e/scenarios/marketing-screenshots-wallpapers.json` through the existing
marketing suite, in Mock Mode, without real funds. The scenario selects Colors,
then the Artemis II album, then its sat wallpaper through the UI. It waits for
`Wallpaper image loaded for <themeName>` (verified in `WalletWallpaperProbe.tsx`),
not merely album selection. Four explicit journeys implement the loop because
the JSON harness has no loop instruction.

The harness currently only accepts canonical page names for screenshot `name`.
Keep `name: "wallet"`; retain the seven wallet occurrences as these source keys,
in order: `wallet-navy`, `wallet-sunset`, `wallet-beige`, then the Artemis captures
per mock currency — sat `wallet-setting-earth`, usd `wallet-edge-of-lunar-day`,
eur `wallet-in-eclipse`, gbp `wallet-looking-back-at-earth` — taken by switching
the wallet unit after each currency received its own collection wallpaper.
All provenance entries use `page: wallet` and the matching `wallpaperId`. This
avoids changing runtime or harness schema for a marketing task. Copy exact PNG
bytes from the capture run and fill in `run`/`sha256`; never relabel an unrelated
screen. iOS harness captures at 9:41/full battery; artwork preserves that chrome.

Thread and stories remain explicit drafts pending isolated media fixtures. Backup
remains a draft for `backup-words` (currently associated with settings-recovery)
until X1 supplies the real safe capture and canonical page. Never fabricate words.
Artemis pack/portal captures and reviewed portal masks remain missing too.

## Provenance and verification

Every output records composition hash, layout ID (or layout list for contact
sheets), copy version/hash, source/provenance hashes, renderer/font/brand hashes,
output hash and dimensions where applicable. Variant records remain in the
manifest even when their full PNGs are not retained. Contact sheets and selected
outputs are always committed together. EAS ignores all marketing files and
`marketingNotBundled` guards the import graph. CI `assets:check` verifies exact
regeneration; its unchanged-tree guard includes `marketing/artwork/generated`.

Tests cover source corruption, missing inputs, two-render determinism, original
store pins, full-chrome geometry, catalog/selection validation, copy collisions,
all catalog portrait/panorama hashes, centre restoration, portal alignment and
plain feature-graphic downscaling. Native appearance and missing capture content
still require the orchestrator's device evidence and human artwork selection.

See [the X2 verification record](VALIDATION.md) for the complete concept/layout matrix, actual gate output and capture handoff limits.

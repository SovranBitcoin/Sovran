# Featured artwork

Run from the repository root; dependencies already belong to the workspace.
Each file in `source/compositions/` defines one image family. The first batch has
14 families / 42 PNGs: 12 social, payment, AI and mint-trust compositions, plus
`portal-wallet` and `theme-pack-colors`. All are opaque sRGB, three channels,
under 15 MiB: wide 1920×1080, tall 1080×1920, square 1080×1080.

```sh
node scripts/featured-artwork.mjs --only payments-wallet
node scripts/featured-artwork.mjs --check --only payments-wallet
node scripts/featured-artwork.mjs --allow-missing
node scripts/featured-artwork.mjs --check --allow-missing
node scripts/featured-artwork.mjs --check
```

Strict generation/checking fails with an enumerated **Missing inputs** message
until all selected screenshots and portal masks are retained. `--allow-missing`
is development-only: missing phones are blank and a red DRAFT banner is painted
above everything else. The manifest records `draft: true` and missing paths.
Never publish drafts. It does not tolerate a hash mismatch or bad composition.
`--check` is read-only and compares exact PNG bytes and manifest records.

Root and app `assets:generate` / `assets:check` use `--skip-missing`: validate
compositions and authenticate available sources, then explicitly skip featured
artwork if any required input is missing. This transitional CI skip does not
certify drafts. Remove the skip policy once captures and masks are complete.
`--only` touches/verifies only that composition's PNGs and manifest entry; it
preserves other entries without declaring them current. An unknown ID fails.

## Composition contract

See `source/compositions/payments-wallet.json` for a two-phone example.
Required keys are `id`, `theme`, `aspects`, `headline`, `subtitle`, `platform`,
`background`, `phones`. IDs/filenames use kebab-case. Themes are social, payments,
ai, mint-trust and wallpaper; platforms are ios/android. Phone coordinates are
canvas fractions: x/width use canvas width; y uses canvas height. x, y, width and
depth are in [0,1], width is positive. x/y mark the unrotated screen's top-left.
Screen height follows the native screenshot ratio after system-chrome trimming.
Higher depth paints later; phones may intentionally bleed off the canvas.

Every phone requires screenshot, x, y, width, rotate, depth, mask (`frame`).
Rotation is 2D, between −30° and 30°. Optional `scaleX` (0.5–1) fakes a tilt with
horizontal compression plus rotation; this is **not perspective**. The Sharp/SVG
recipe does not project a 3D phone. `perAspect.<aspect>` can replace phones and/or
set copy `{x,y,width,headline,subtitle}`. Copy coordinates are fractions too.
Headline size fits its column; oversized subtitle lines fail rather than clip.
Fonts are the bundled Mona Sans outlines; lockup is the canonical brand source.

Screenshot keys are resolved through `source/screenshots.json`; each declares a
canonical E2E `page`. Keys can identify captures of the same page, e.g.
`wallet-navy` is page `wallet`, `ai-model-picker` is page `ai`. No capture-order
prefixes are retained. To add a family, add one composition JSON, using existing
registered screenshot keys (register/provide additional captures when necessary).

## Capture and retain

The JSON harness suite is `app/e2e/suites/marketing-screenshots.json`. It is
platform-neutral and runs on the existing `sim` (iOS) and `android` drivers:

```sh
cd app
bun e2e/cli.ts run --suite marketing-screenshots --driver sim --evidence screenshots --no-record
bun e2e/cli.ts run --suite marketing-screenshots --driver android --evidence screenshots --no-record
```

Check `bun e2e/cli.ts --help` for device ownership/setup options before capture.
No simulator was run for this change. Each scenario enables Mock Mode through
Settings and retains the existing mode-off/live-data assertions. No funds,
messages, publishing, cache seeding or persistence bypasses are involved.

- Core: wallet, mint-select, mint-info, unified receive (canonical receive-qr),
  send, fictional DM conversation, contacts, feed, notifications, AI, model
  picker (second ai occurrence), settings.
- Wallpapers: theme-preview/gallery, then select sat navy, sunset, beige before
  three wallet captures. The existing wallpaper render probe asserts the chosen
  theme. Retain those as wallet-navy, wallet-sunset, wallet-beige.
- Mints: **live data required**. Reviews needs a populated review row; mint
  changes needs a populated revision. Availability is not fabricated in Mock
  Mode. Both conditions must be met before retaining the images.
- Media: **explicitly deferred capture inventory**, not a runnable or validated
  journey. Thread, stories, image viewer require isolated navigable media
  fixtures. `DemoHomeFeed` deliberately blocks pointer events; thread uses live
  reads; stories requires story media; image viewer is an overlay. Implement
  real fixture entry/readiness/exit actions before removing `deferredReason`.
  Do not inject snapshot events into live stores to make these pages appear.

Copy named PNGs to `source/screenshots/<platform>/<key>.png`. Update the matching
entry's run ID and SHA-256 (`shasum -a 256 <file>`). Keep full uncropped native
screenshots; the shared renderer trims only system chrome. Wallpaper entries
also record `wallpaperId`. Never relabel another surface to fill a missing slot.
Eight retained store screenshots (four per platform) are copied byte-for-byte
with their original run IDs/hashes; nine first-batch outputs use those now.

## Portal and theme packs

A portal scales one wallpaper to cover the canvas, blurs it at sigma 24 and
reduces brightness to 65%. Inside the rounded phone screen the same canvas crop
is sharp, beneath the captured UI. The inverse phone transform preserves canvas
alignment even with rotation/scaleX; rim and shadow add depth.

An opaque screenshot contains no UI transparency. A portal therefore requires a
reviewed grayscale mask at the **original screenshot size** in addition to the
matching-wallpaper capture. White retains app UI; black reveals wallpaper; gray
feathers edges. Add `uiMask: {file: "source/masks/ios/wallet-navy.png", sha256: "…"}`
to that screenshot's provenance entry. The generator crops the mask and screenshot
identically and uses the mask as UI alpha. Retain UI text/cards faithfully; do
not infer/remove dark UI by color-keying. Capture alone cannot supply this mask.
Until the mask exists, strict mode fails and the portal remains a draft.

Theme packs require 3–5 different wallpaper captures from one declared album,
with a blurred hero wallpaper behind them. Wallpaper sources live in
`source/wallpapers.json`, each with album, retained source path and SHA-256.

**Current source reality:** `app/config/backgroundImageThemes.ts` explicitly
starts its image registry empty; old bundled background PNGs were removed.
`wallpaperSync` → `wallpaperStore` → `downloadedThemeRegistry` resolves live
catalog IDs to downloaded files. The first album is the synthetic **Colors**
album in `builtinAlbums.ts`, not an image album. This batch retains SVG gradients
using navy/sunset/beige palette shades 800/900/950 from `app/themes.ts`, matching
the gallery preview recipe. These are palette artwork, not claimed native
wallpaper-image captures. Later image albums should retain exact catalog image
bytes plus provenance here; never fetch changing network images during rendering.

## Outputs and verification

`generated/<id>/<aspect>.png` and `generated/manifest.json` are deterministic:
composition, source, provenance-index, renderer, font and brand hashes; dimensions,
byte sizes, output hashes and draft status. No timestamps or absolute host paths.
All renders validate in memory before output writes; staged PNGs are replaced
and the manifest is written last, so an interrupted write fails the next check.
This is not a transaction across every PNG; rerun generation after interruption.

```sh
node scripts/feature-graphic.mjs --check
bun run assets:test
cd app
bun run test -- marketingNotBundled --runInBand
bun run e2e:validate
```

The Node tests cover validation, provenance, missing/corrupt inputs, and repeated
renders using retained screenshots. The app Jest guard rejects imports/requires
of marketing assets. Marketing remains outside the runtime import graph and is
excluded by both EAS ignore files. Native captures, media-fixture journeys and a
real portal UI mask remain prerequisites for the complete production batch.

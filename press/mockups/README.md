# Phone scenes

The website and artwork generator share `scripts/lib/phone-frame.mjs`. No native
screenshots were regenerated for this change. Source captures, their run IDs,
SHA-256 hashes, and the eight store pins remain unchanged. The images contain
illustrative app content, not live balances or feeds. Screens can differ by version.

## Browse and compose

Run `bun run site:dev` from the repository root, then open `/scenes`. Every named composition is
static and renders without JavaScript. `/scenes/custom` is a small optional
editor: choose any ordered 1-20 list of retained iOS screenshot keys, a preset,
canvas format, and optional JSON poses. Its URL records the selection. Invalid input removes
the preview and reports the error; Android references appear only as raw captures
in `/screenshots`, not as iPhone mockups.

| Preset                 | Phones | Composition                              |
| ---------------------- | ------ | ---------------------------------------- |
| `single-front`         | 1      | Straight-on portrait                     |
| `single-tilt`          | 1      | Three-axis tilt                          |
| `duo-overlap`          | 2      | Opposing rolls, overlapping cases        |
| `duo-depth`            | 2      | Parallel tilt, size and depth separation |
| `triple-fan`           | 3      | Front centre, rolled outer devices       |
| `triple-row`           | 3      | Straight-on row                          |
| `quartet-side-by-side` | 4      | Four phones side by side                 |
| `quartet-stagger`      | 4      | Alternating vertical placement           |
| `quartet-depth`        | 4      | Diagonal depth sequence                  |
| `custom`               | 1-N    | Default row or explicit poses            |

`PhoneScene.astro` accepts `scene` for the existing homepage selections, or
`preset`, `screenshots: string[]`, and `poses`. Pass a unique `id` when placing
the same scene more than once in a document, so SVG clip references stay unique.
The gallery supplies its own IDs. Example:

```astro
<PhoneScene
  id="payments-four"
  preset="quartet-side-by-side"
  screenshots={['ios/wallet', 'ios/send', 'ios/receive-qr', 'ios/dm-chat']}
/>
```

Each pose is `{ x?, y?, z?, rotateX?, rotateY?, rotateZ?, scale? }`, with finite
numbers only. Explicit x/y are scene coordinates locating the unrotated screen
origin; normalization does not reposition them. Rotations are degrees about the
screen centre. `rotateX` and
`rotateY` accept -75 through 75; `rotateZ` rolls the whole device, including its
case and portrait capture. `scale` is positive. `z` controls camera-space paint
order (low first); orthographic projection does not pretend z changes image size.
Use explicit scale for size differences. Within `createScene`, the effective scale
is `scale * referenceChassisHeight / nativeChassisHeight`, where chassis height is
`device.height + 2 * device.bezel`. The fixed reference is the calibrated Pro
chassis (about 905.777 logical points), not the first selected capture. Thus a
Pro and Pro Max at scale 1 have equal unrotated chassis presentation heights;
scales 0.8 and 1.2 retain that exact 2:3 height ratio. Screen dimensions, source
aspect ratios, and device-specific corner calibration remain native. No screenshot
is reinterpreted as a landscape app screen. Poses override the preset placements,
not its phone count; explicit poses bypass automatic gap/baseline alignment.

`duo-front`, `triple-row`, `quartet-side-by-side`, and the default custom row use
measured chassis widths, equal baselines, and 48-point chassis-to-chassis gaps.
`quartet-grid` uses that same gap in both axes, with two rows aligned around a
shared central gutter. Side buttons are outside the chassis and the conservative
export envelope is slightly larger. Overlap, fan, diagonal, stagger, and depth
presets retain their authored placements around stable reference-screen centres,
even when capture order changes. The stepped reading view uses gentle 12-degree
yaw without pitch. Canvas fitting then uniformly scales the entire scene; it does
not promise equal pixel heights across separately fitted exports.

Normalization is scene-only. `captureDevice` and `phoneGeometry` still expose native
logical dimensions and calibrated bezel/thickness. The artwork `phone()` wrapper
continues to size screens by its requested width, not by scene presentation height.

## Export

Commands run from `site/`; use a fresh destination for a new custom selection.
Chrome/Chromium must be installed (`CHROME_PATH` overrides discovery). No extra
packages, servers, native builds, or external uploads are required.

```sh
# All named presets plus the five homepage scenes and OG composition:
bun scripts/visual.mjs --export ../press/mockups

# Any preset with its default captures:
bun scripts/visual.mjs --export /tmp/sovran-four --preset quartet-side-by-side

# Arbitrary ordered screenshots, including repeated captures:
bun scripts/visual.mjs --export /tmp/sovran-custom --preset duo-depth \
  --screenshots ios/dm-chat,ios/wallet --format square

# Custom 1-N layout and three-axis controls:
bun scripts/visual.mjs --export /tmp/sovran-poses \
  --screenshots ios/wallet,ios/feed \
  --poses '[{"x":0,"y":0,"rotateY":-25,"rotateZ":-8,"z":-1,"scale":0.9},{"x":270,"y":150,"rotateX":10,"rotateZ":8}]'

# Desktop/mobile pages, composer/gallery controls, formats, and corner evidence:
bun run build
bun scripts/visual.mjs --frames
bun test tests/phoneGeometry.test.ts
node --test tests/export.test.mjs
```

Exports build the current source first, authenticate captures, check geometry in
Chrome, and write a manifest with renderer/input hashes, image hashes, and the
selection. Each selected/custom export records its format, exact canvas, ordered
screenshots, native run IDs, source hashes, and contexts in `manifest.json`'s
`exports` map. They refuse unrecognized modified output files and refuse leaving
other retained scenes stale. Changing source during export fails before replacing
outputs. Custom exports are `custom.png`; named exports use the preset name.
Nothing is published. Browser PNGs are derived presentation assets; the retained
source PNGs are not rewritten. Browser font/raster differences can change pixels
between Chrome versions, so record the browser version when comparing machines.

`--format` works with `--preset` or `--screenshots`, using the same custom composer
URL contract as the preview. It does not resize or crop the source capture:
the full scene is contained in the requested canvas with transparent padding.
PNG dimensions and all four transparent outer edges are checked before staging.
The default for a selected preset/custom scene is `native`. The unfiltered legacy
homepage/preset set keeps its page-defined bounds; OG remains opaque 1200x630 and
does not accept `--format`.

| Format      | PNG size                        |
| ----------- | ------------------------------- |
| `native`    | Rounded-up natural scene bounds |
| `square`    | 1080x1080                       |
| `portrait`  | 1080x1350                       |
| `story`     | 1080x1920                       |
| `wide`      | 1920x1080                       |
| `landscape` | 1200x630                        |

## Bulk variants

Run these commands from the repository root:

```sh
# Default is a read-only JSON plan on stdout, diagnostics on stderr. No build/browser.
bun run --cwd site scripts/variants.mjs
bun run --cwd site scripts/variants.mjs --plan --collection mint-trust

# Explicit destination required. One build and one Chrome session for the batch.
bun run --cwd site scripts/variants.mjs --export ../press/exports/normalized

# Restrict a batch; --limit takes the first N jobs in deterministic plan order.
bun run --cwd site scripts/variants.mjs --plan --format story --preset duo-depth --limit 5
bun run --cwd site scripts/variants.mjs --export /tmp/sovran-mints \
  --collection mint-trust --preset quartet-depth --format wide

# Equivalent renderer entry point; --variants is a switch, not a manifest filename.
bun run --cwd site scripts/visual.mjs --variants --export /tmp/sovran-batch --limit 3
```

Relative export paths resolve from `site/` with these commands. There is no default
write destination, no arbitrary plan-file input, and no auto-delete/overwrite flag.
`--plan` and `--export` are mutually exclusive. Filters accept one exact collection,
format, or preset name each; unknown values fail rather than silently broadening
the selection. `--limit` accepts 1-1000. An empty export selection fails before a
build or destination write.

The plan takes collections from `press/artwork/source/screenshot-context.json` and
uses only registry entries with retained, SHA-256-matching native iOS PNGs and
context metadata. Unavailable, missing, unreviewed, noncanonical-path, and tampered
inputs are skipped with diagnostics. P2PK capture requests are not replaced with
the Unified QR or unrelated images. They produce no variants until reviewed.

Every retained screenshot gets `single-front` in all six formats, plus two rotating
single-angle presets in native/portrait/story (flat lays use native/square/wide).
Captures outside authored collections
appear in the synthetic `retained-singles` collection, which never forms multi-phone
scenes. A collection filter restricts coverage to that collection.

Within each authored collection, every combination of 2-4 available members is
included in collection order, not just the first members and never permutations.
Each gets a base preset (`duo-front`, `triple-row`, or `quartet-grid`) and one
alternative rotated through the count's preferred presets. Pairs use
square/portrait/landscape; triples use square/wide/landscape; quartet grids use
square/portrait/story and other quartets use wide/landscape/portrait. This curates
layouts and ratios rather than dropping screenshots. The current catalog produces
**402 variants**. The stale `ios/receive-qr` capture is skipped until it is replaced. The default budget test is 400-600 for this catalog and also checks
the count derived from complete screenshot/subset coverage; this is not a hard
runtime cap that silently drops later collections.

An explicit `--preset` selects that preset for every count-correct combination,
using the count's formats (all six for singles). An explicit `--format` selects
that canvas for every matching preset and combination, bypassing default preset
curation; combine both flags for an exact preset/canvas batch. Explicit selections
can therefore exceed the default budget. Duplicate keys are removed, undersized
collections are never padded, and identical ordered combinations/presets/formats
across collections are deduplicated. Names include the ordered screenshot names:
`COLLECTION--SCREENSHOT--SCREENSHOT--PRESET-FORMAT.png` (one screenshot for singles).
Double-hyphen separators avoid ambiguity between hyphenated screenshot names.

Use a **new export directory** for each planner or frame revision, such as the
`normalized` destination above. The pre-normalization `curated` batch was deleted
as superseded. Old first-slice exports have different
names and source fingerprints; do not mix them with the revised set or bypass
the exporter's existing-output guards.

The renderer revalidates the plan against current sources. All images are staged,
then source fingerprints and existing-output hashes are checked before publishing
to the requested local directory. Existing user outputs are not deleted. If a
filtered rerun would leave other retained images stale, use a fresh destination or
regenerate the full set. The manifest fingerprints the shared geometry/formats,
registry and context catalog, composer/layout/styles, and both exporter scripts.

`--frames` uses an already-built site and covers the homepage, presets, roadmap,
releases, developer hub, mockups, screenshot library, and custom composer at
1440px, 390px, and 320px. It exercises story/count/preset/format controls, captures
each custom canvas and exact transparent export, checks image decoding and phone
containment, and verifies missing inputs remove export/share affordances. It
writes screenshots and `checks.json` to its own temporary evidence directory.
Do not run builds concurrently with exports or another agent's build.

## Geometry and evidence

- `app/e2e/artifacts/run-2026-09-11T18-03-58-075Z-813d671c/session-1.json`
  identifies the store capture device as **iPhone 17 Pro Max**, iOS 26.2. Its
  retained PNGs are 1320x2868, or 440x956 points at @3x.
- `app/e2e/artifacts/run-2026-09-13T02-12-43-637Z-aca0af50/session-1.json`
  identifies the later capture device as **iPhone 17 Pro**, iOS 26.2. Those
  PNGs are 1206x2622, or 402x874 points at @3x. Run artifacts are local evidence,
  not required build inputs; the retained manifest authenticates the source bytes.
- `app/e2e/viewer/src/components/deviceCorners.ts` records a 62pt display corner
  for both models. The app reads native hardware radius through
  `app/shared/lib/screenCornerRadius.ts`. Its iOS `SquircleView` uses the native
  continuous border; the Android implementation uses fast-squircle smoothing 0.6.
- The shared construction adapts fast-squircle 1.1.5's cubic/arc transitions,
  not circular CSS/SVG radii. The upstream MIT notice remains in
  `site/public/licenses/fast-squircle.txt`.
- Apple lists [Pro dimensions](https://support.apple.com/en-us/125090) as
  71.9x150.0x8.75mm and [Pro Max dimensions](https://support.apple.com/en-us/125091)
  as 78.0x163.4x8.75mm, both at 460ppi (checked 2026-09-14). The model converts
  these to @3x logical points. The two-axis average yields a uniform bezel
  within 0.1mm of both rounded published dimensions; thickness is 8.75mm.
- Screen, glass, rim, and every chassis cross-section reuse one contour. SVG
  strokes provide **parallel normal offsets** rather than independently enlarged
  corner radii. All strokes are painted behind the screenshot. A shared
  orthographic Rz*Ry*Rx transform projects the complete object, with 65 depth
  sections and side-plane buttons. Sidewall rounding is inward: intermediate
  sections bulge relative to the end sections but remain inside the calibrated
  chassis envelope. Conservative projected bounds cover those intermediate
  sections and button protrusions, not just the visible front plane. Tests
  independently reconstruct this rotation and check all 65 section envelopes.
  The dark sidewall has restrained tonal variation and a one-point front rim;
  neither is a physically simulated metal shader.
- The Android store capture is a 1080x1920 emulator framebuffer. Its run metadata
  records an AVD, not a physical phone model. Artwork uses a neutral square-screen
  emulator frame without Apple hardware; it does not assert a Pixel identity.

This is a dimension-calibrated orthographic illustration, not Apple CAD, photographic
perspective, or a product photograph. Parallel lines do not converge with depth.
Material response, edge rounding, button dimensions/positions, and lighting are
illustrative. It does not add an island, replace the real status bar, crop the
capture to fill a different aspect ratio, or paint reflections over app content.
Existing deliberately cropped artwork layouts still have their documented canvas
bleed; reusable scene presets instead fit complete devices within their viewBox.

## Integration

`bun run site:scenes` opens the local gallery. `bun run press:mockups` exports the
complete preset/homepage set. The site build copies the shared device module,
all reviewed iOS PNGs and the visual renderer source used in OG fingerprints;
production does not run Chrome. Docker allowances and site CI/deployment watch
patterns cover those inputs. Android references are rejected by website scenes.

Deployment integration for the workbench must also copy
`press/artwork/source/screenshot-context.json` and `site/scripts/variants.mjs`
into the Docker build context/image. Mockup previews use same-origin iframes:
production CSP needs `frame-src 'self'`, and the composer response must permit
same-origin framing (`frame-ancestors 'self'`, not `frame-ancestors 'none'`).
The visual QA server permits same-origin preview frames; production policy must
be aligned before treating local preview QA as deployment verification.

The public OG is a separate delivery output from the same renderer. After source
changes, refresh it from `site/` with
`bun scripts/visual.mjs --export public/social --og-only`, then rebuild. Tests
verify the source/output hashes before advertising it in page metadata.

# Screenshots And Artwork

Run `bun run site:dev` from the repository root and open
<http://localhost:4321/dev>.

| Local page | Purpose |
| --- | --- |
| `/screenshots` | Native views paired by page/state and platform, with freshness, attempts and blockers |
| `/logos` | Logo families and colorways with ordered PNG sizes and SVG downloads |
| `/social` | Related-screen templates, editable copy/phones/poses, PNG and recipe downloads |
| `/mockups` | Explicit website compositions and their output status |

These pages and the artwork API exist only in the local dev server. Public builds
exclude them before compilation, so their screenshot catalogs cannot leak through
Astro's generated asset directory. `noindex` is not the security boundary.

## Sources And Outputs

- `app/assets/brand/source/` owns logo masters. Keep the generated native/logo
  variants because app installation and release tooling consume them.
- `press/screenshots/` owns the latest verified full-page capture library. Its
  manifest contains sanitized provenance; raw native logs and AX snapshots stay
  in ignored E2E artifacts, never in this library.
- `press/artwork/source/screenshots.json` retains the existing curated press
  selections, their pixel size and metadata. Successful reviewed capture recipes
  refresh those aliases; the store archive below is never rewritten by a capture.
- `press/artwork/source/concepts/`, copy, layouts and screenshot context describe
  compositions. Wallpapers and their provenance remain source inputs.
- Social previews and PNG downloads are rendered in memory. Browsing does not
  save a poster inventory, contact sheets or every orientation combination.
- `press/website.json` selects named website scenes and the public OG output.
  `site/public/social/` is the single raster destination. The homepage's remaining
  phone scenes render directly from its selected native captures.

The old selected-poster and duplicate full-mockup inventories are retired. The
legacy poster renderer remains an explicit tool for its specialized wallpaper
and store-feature-graphic contracts; normal refresh never runs its bulk writer.

## Refresh

```sh
bun run screenshots:refresh:plan both
bun run screenshots:refresh both
bun run screenshots:refresh both --resume
bun run screenshots:status --strict
```

Refresh builds or verifies each native host, runs focused approved scenarios,
imports passing evidence, updates the source library, then regenerates logos,
selected website outputs and the public site. It never runs the entire functional
suite implicitly. A simulator lane alone does not authorize publishing or spending.

Run the full campaign whenever a release is decided, before the version bump is
merged: the website's phone scenes and its social/OG rasters build from this
library, and a public `site:build` fails when a selected capture is not `current`.
See [the release runbook](../release/README.md#day-to-day-operation).

```sh
# Focused diagnosis; keep both-platform inventory visible.
bun run screenshots:refresh android --scenario capture.local-navigation --attempts 1 --no-downstream

# Regenerate derived website assets without touching a device.
bun run screenshots:refresh --render-only

# Explicit asset operations.
bun run assets:brand
bun run site:assets
bun run site:assets:check
bun run site:build
```

The capture profile is `library-v1`: iPhone 17 Pro Max / iOS 26.2 / 1320x2868,
and the pinned Android emulator / 1080x2400 / 420dpi. Missing profiles fail rather
than silently falling back.

Android capture also runs with animations disabled, recorded on each capture as
`motion: reduced`. `uiautomator dump` waits for the window to go idle, and a
looping animation — a skeleton shimmer, a marquee — never lets it, so the dump is
reaped and the harness reads an empty screen it cannot act on. A still library
frame wants the settled state anyway. iOS reads its accessibility hierarchy
directly, needs no idle window, and keeps system motion; that asymmetry is why
only the Android profile declares it. These frames are not evidence about
animation behaviour on either platform.

One body per platform. Every retained capture records its pixel size, and a
capture that does not match its platform's reviewed geometry is withheld with
that reason instead of being framed as a different phone — `/screenshots` names
the device beside each image. Store delivery is a separate contract with its own
resolution limits — Play rejects ratios above 2:1, so its images cannot be the
1080x2400 library body. Prepare those from a current library capture at
submission time; the library keeps no archived copy of what was last delivered.

The campaign lock and checkpoint live in `app/e2e/artifacts/`. The checkpoint is
`screenshot-refresh.json`; timestamped final reports are retained alongside it.
Sessions alternate iOS/Android per recipe so one platform cannot monopolize the
queue. Every attempt checkpoints its state. Resume skips only verified matching recipes,
app/native fingerprints and image bytes. Inspect the recorded PID before removing
a lock left behind by process death. Do not run overlapping native campaigns.

## Coverage And Evidence

The inventory always contains all 101 canonical pages on both platforms: **202
baseline slots**, plus meaningful state variants. A planned or blocked slot is
not a captured image. Run the plan/status commands for current counts rather than
treating this document as a capture report.

Native fixtures render actual app components with controlled presentation data.
Native navigation uses a disposable profile. Both retain
`functionalResult: not-established`; neither proves payment settlement, hardware
transport or recovery behavior. Import eligibility is separate from publication
review. Real secrets and live private conversations are not approved sources.

Missing views never receive substitute screenshots. A failed attempt leaves the
last verified capture intact and visible as outdated when appropriate. Full strict
coverage fails while any required slot is blocked, missing, corrupt or outdated.

## Editing Artwork

Choose a social template, change its text, screenshots, platform, compatible frame,
arrangement or poses, and render the preview. The download rasterizes the same
final SVG, not a separate approximation. Edits live in the URL fragment; export or
import versioned JSON for a durable recipe. The endpoint cannot write recipes
into the checkout or read arbitrary local paths/URLs.

Every composition carries the brand lockup. `brand.placement` picks one of six
anchors — `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`,
`bottom-right` — or `none`; `brand.lockup` is the full logo and name
(`wordmark`) or the symbol alone; `brand.scale` is 0.6-1.6. The watermark
reserves its own band, so headline, subtitle and phones are laid out in what is
left instead of being drawn over it, and the lockup is placed by its ink rather
than its padded canvas. The theme follows the background automatically.

Published images carry no provenance text. Capture freshness, evidence class and
run identity live in the render's metadata and in the workbench, never in the
pixels people see. Outdated sources still require explicit draft mode and a
visible draft label — that label is what makes a draft unpublishable, and it sits
in the same band, opposite the logo.
Website output generation rejects drafts and preserves previous output on failure.
Changing `press/website.json` and rerunning `site:assets` regenerates its selected
deliverable with per-output source and recipe hashes.

## Checks

```sh
bun run screenshots:test
bun test app/e2e/press app/e2e/core/loader.test.ts
bun run site:test
bun run site:build
git diff --check
```

`site:assets:prune` previews retirement of manifest-owned, unchanged tracked
outputs. Pass `--apply` to delete those exact files. It deliberately preserves
edited assets, ignored/user exports, source screenshots and capture evidence.

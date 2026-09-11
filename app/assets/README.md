# App assets

Group assets by purpose: `brand/`, `demo/`, `fonts/`, and the existing icon and
wallpaper owners. [SYSTEM.md, decision 23](../../SYSTEM.md#23-assets-fonts-and-user-media)
owns the naming convention. Start with the [brand gallery](brand/index.html) or
[brand guide](brand/README.md).

```sh
bun run assets:generate       # brand, demo media and marketing exports
bun run assets:check          # recreate and compare required outputs
bun run assets:brand          # brand artwork only
bun run assets:feature        # store feature graphics only
bun run assets:test           # geometry, opacity, dimensions and rendering
```

These commands work from the repository root or `app/`.

## Product artwork

Canonical design inputs live in `brand/source/`. Generated exports live under
`brand/generated/<layout>/<foreground-on-background>/<width>x<height>.png`.
For example, the 512×512 symbol on a light background is
[`brand/generated/symbol/black-on-light/512x512.png`](brand/generated/symbol/black-on-light/512x512.png).
Generated SVGs are named `artwork.svg`; only editable masters live in `source/`.

App/widget icons use `brand/generated/symbol/black-on-light/1024x1024.png`.
Android's foreground uses
`brand/generated/android-adaptive-icon/black-on-transparent/1024x1024.png`.
Splash images use the symbol's 2048×2048 transparent variants; the favicon uses
`brand/generated/symbol/white-on-transparent/32x32.png`. Native targets generate
their required platform icon sizes. Runtime imports remain literal known paths.
Native icon/splash changes require a new binary.

## Demo media

`manifest.json` separately inventories 22 public/generated raster originals and
66 purpose-sized render variants. These are photographs and avatars, not vector
logos, and retain the existing `image.png`, `image@2x.png`, `image@3x.png` Metro
families. Their source resolution caps the available detail. Do not manufacture
2048px photos from smaller originals merely to fill a size list.

Each demo folder retains one unchanged `source.*`. Public URLs and original
SHA-256 hashes remain in `shared/stores/runtime/fixtures/publicDemoSnapshot.json`:
`file` references the original, `renderFile` references the PNG family. Signed
Nostr events are unchanged. Fictional portraits have separate provenance.
Animated demo avatars use their documented first frame; live remote media is
unaffected. PNG is used here for a uniform export workflow; JPEG/WebP usually
compress photographs better, so this is not a policy for arbitrary user uploads.

Runtime callers import generated PNGs, never source files. Metro bundles only
reachable assets; sources and unreferenced export sizes stay out of the runtime
asset graph. `assets:check` rejects uncatalogued raster files and stale exports.

## Other resources

Fonts retain TTF/OTF formats and central `useFonts` registration. SVG wallpaper
patterns and the existing icon registry retain their own pipelines. Historical
font license records remain a follow-up; public availability of demo media is
recorded without inventing a license grant. The brand guide identifies supplied
artwork and the bundled font used to outline version numbers.

## Store feature graphics

[Android and iPhone banners](../../marketing/feature-graphic/README.md) live outside
the runtime asset bundle. `assets:generate` and `assets:check` include them;
`assets:feature` regenerates only those two 1024×500 graphics.

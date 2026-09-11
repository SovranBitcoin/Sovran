# Sovran brand assets

[Open the gallery](index.html) to choose a layout, colorway and exact pixel size.

## Naming and structure

Use lowercase kebab-case for folders and named assets. Read a generated path as
**layout / foreground-on-background / width×height**:

```text
brand/
├── source/
│   ├── symbol.svg              # canonical S geometry
│   ├── wordmark.svg            # canonical Sovran lettering
│   └── brand.json              # composition, colorways and sizing
├── generated/
│   ├── symbol/<colorway>/
│   ├── wordmark-lockup/<colorway>/
│   ├── version-lockup/<colorway>/
│   ├── android-adaptive-icon/black-on-transparent/
│   └── manifest.json
├── index.html                  # generated preview; not a design source
└── README.md
```

A **symbol** is the standalone S. A **wordmark** is the lettering master.
A **lockup** is a fixed arrangement: S plus lettering or S plus version number.
The Android adaptive icon is a separately padded use of the same symbol.

| Colorway | Foreground | Background |
| --- | --- | --- |
| `black-on-light` | Near-black `#050505` | Light gradient |
| `white-on-dark` | White `#ffffff` | Dark gradient |
| `black-on-transparent` | Near-black `#050505` | None; alpha retained |
| `white-on-transparent` | White `#ffffff` | None; alpha retained |

Names describe the artwork, never the active application theme. `light`/`dark`
alone and abbreviated transparency suffixes are not asset identifiers.
The light gradient is white to `#e1e1e1`; dark is `#181818` to `#030303`.

Every variant contains generated `artwork.svg` and PNGs named with both physical
dimensions, using ASCII `x`: `16x16.png`, `32x32.png`, `64x64.png`, `128x128.png`,
`256x256.png`, `512x512.png`, `1024x1024.png`, `2048x2048.png`. Wide lockups retain
8:3: `512x192.png`, for example. These are pixel dimensions, not density scales.
Use the symbol for tiny placements where lettering would not be legible.

## Files to use

| Symbol, 512×512 | File |
| --- | --- |
| Black on light | [512x512.png](generated/symbol/black-on-light/512x512.png) |
| White on dark | [512x512.png](generated/symbol/white-on-dark/512x512.png) |
| Black on transparent | [512x512.png](generated/symbol/black-on-transparent/512x512.png) |
| White on transparent | [512x512.png](generated/symbol/white-on-transparent/512x512.png) |

The [wordmark lockup](generated/wordmark-lockup/black-on-light/512x192.png) and
[version lockup](generated/version-lockup/black-on-light/512x512.png) use the same
colorways. Keep directory context with a file when copying it elsewhere.

Only `source/` contains editable design inputs. The S was extracted from Group
2748, lettering from Group 2749, and version layout informed by Group 2750.
Superseded originals and intermediate artwork are not retained. The version's
digits use bundled Mona Sans ExtraBold outlines. Every SVG uses identical S
geometry with uniform scaling; no runtime fonts or remote resources are needed.
`generated/manifest.json` records input hashes, layout bounds, dimensions and
output hashes; its paths are relative to this brand directory.

## Mathematical layout

Positions use exact Bézier ink bounds, not viewBox whitespace, font advance widths
or guessed baselines. All scaling is uniform; the S is never stretched.

- Logo canvas: 1024×1024. S height: 832. Top/bottom margins: 96; the actual
  left/right ink margins are equal.
- Wordmark canvas: 2048×768. S height: 448; text ink height: 304; gap: 128.
  Both ink centers share y=384. The combined group has equal left/right margins.
- Version canvas: 1024×1024. S height: 576; text ink height: at most 104;
  gap: 64. Both pieces are horizontally centered, and their combined group is
  vertically centered. Longer versions scale text down to a maximum 768px width.

Android uses a dedicated `generated/android-adaptive-icon/black-on-transparent/` family with the same eight square
PNG sizes. Its S height is 528 on a 1024 canvas; the entire silhouette fits inside
the central 66/108 circular safe zone, preserving the mark under launcher masks.
The regular logo remains larger for store artwork and iOS icons. See
[Android adaptive icon guidance](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive).

## Regeneration and release integration

Run `bun run assets:generate` after changing a master, layout, font, or
`app/app.json`'s `expo.version`, then review and commit the generated artifacts.
`bun run assets:brand` regenerates only the 13 brand SVGs and 104 PNGs.

The root install hook regenerates brand assets after dependencies are available,
**before Expo prebuild**. The EAS post-install hook verifies them again. Normal CI
checks artwork and rejects uncommitted generated changes. The release validator
checks all assets, and the build controller compares brand artifacts against the
exact release checkout before requesting EAS builds. It does not mutate the
release checkout to bypass its clean-source requirement. A version bump therefore
cannot silently ship the previous outlined version number.

SVGO keeps compact path transforms rather than expanding every coordinate.
Curve-to-arc approximation is disabled after it exceeded the pixel-difference
budget in the supplied wordmark. Path coordinates retain five decimal places;
transforms retain six. Tests compare pre/post-optimization renders, theme alpha
silhouettes, output sizes, uniform scaling, alignment and changing version text.
`assets:check` also recreates every PNG in memory and compares its bytes.

No release, build submission or publication is performed by these asset commands.

Sources: [SVGO presets](https://svgo.dev/docs/preset-default/),
[OpenType outline generation](https://github.com/opentypejs/opentype.js/),
[Expo lifecycle ordering](https://docs.expo.dev/build-reference/npm-hooks/).

## Verification (2026-09-11)

Reviewed all 12 themed layouts visually, plus the padded Android foreground.
The optimized light SVGs are approximately 65%, 50%, and 72% smaller than the
supplied logo, wordmark, and version references respectively; this includes the
intentional removal of filter stacks and normalization of layouts/version text.
Five asset tests pass, including pre/post-SVGO comparisons at 1024 and 2048px,
all themed PNG dimensions/opacity, matching transparent silhouettes and Android
safe-zone coverage. Full asset regeneration/check is byte-identical locally.
Both native Metro exports and platform type checks pass; 10 demo/isolation tests
and 29 release tests pass. Release tests needed their existing Node mock cleanup
calls corrected to `.mock.restore()`.

No native binary or EAS build was produced. Linux/EAS byte reproducibility remains
for CI to verify. A broader web export encountered the existing missing web
`GlassSearchBar` implementation; the separate iOS and Android exports succeeded.

At the naming-migration checkpoint, all 106 brand/banner PNGs were byte-identical.
Later feature-graphic design revisions deliberately regenerate the two banners. Asset
checks and five geometry/render tests pass; gallery links, every size-selector
target, native config paths and separate iOS/Android Metro exports were verified
after the move. No compatibility aliases remain at the previous asset paths.

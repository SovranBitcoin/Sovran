# Sovran Site

Standalone static Astro **5.18.2**, the latest 5.x published when this package was
created. It is pinned rather than following Astro's newer major. Plain CSS and
Astro components; no React integration, private schema package, app dependency,
token, `.env` file, build-time release fetch, or bundled availability snapshot.

## Source Only Versus Activation

Adding this folder does **not** activate a deployment. No DNS, Railway service,
publisher destination, old website repository, or production data was changed.
The root scripts, dedicated website workflow and archive exclusions include this package.

To activate deliberately: select the repository root as the Railway build context,
select `site/railway.json` as its config, review the site and legal delivery, then
configure `ARTIFACT_ORIGIN` to an externally managed **HTTPS origin** that continues
serving the existing publisher's public tree. It must not point back to this site
or a redirect to it. It accepts only a hostname, without a trailing slash, path,
port, credentials or query. No origin is built in. `ARTIFACT_RESOLVER` defaults to
`1.1.1.1`; operators may set their trusted numeric DNS resolver. `PORT` defaults to
8080. These are server routing settings, not client configuration or secrets.

With no origin, `/releases/channels.json`, `/releases/*` artifacts, `/ios`, and
`/ios/*` return **503**, while `/releases` and `/releases/` remain HTML pages.
The site starts safely without release infrastructure. A successful `/health`
only establishes static-site health, **not** artifact-origin readiness.

**Do not delete the old artifact repository.** The current publisher still writes
`public/releases/channels.json`, `public/releases/<version>/artwork/*`, iOS ADPs,
and the old website's `src/releaseMedia.json`. This site does not require a new
public media endpoint. Host migration, publisher cutover, immutable-byte checks,
store testing and DNS activation remain separate work. Proxying must preserve
the complete `/ios` and `/releases` paths and bytes. A hostname's mere existence
does not establish its readiness or authority.

## Local Commands

From the repository root:

```sh
node site/scripts/install.mjs
```

The installer copies only this package manifest and lock to a temporary directory
outside the workspace, runs Bun with a frozen lock and disabled lifecycle scripts,
then copies the resulting dependency tree into `site/node_modules`. It never runs
an install from the monorepo. Use `--update-lock` only for an intentional isolated
dependency refresh. No root `.npmrc`, `bunfig.toml`, overrides or credentials are
copied into the installation. Do not use `bun install` from `site/`: parent
workspace discovery can otherwise alter the root installation.

Run these commands with **`site/` as cwd**:

```sh
bun run build
bun test tests
bun run dev
bun run preview        # serve the completed build locally
```

The tests require a completed build, `nginx`, and `envsubst` on PATH. They start
an isolated nginx on a loopback ephemeral port and stop it on completion; they do
not touch system nginx configuration. `bun test tests/releases.test.ts` runs the
pure parser/fetch tests independently. Both `dev` and `preview` provide
`/releases/channels.json` by fetching the current public metadata from
`https://sovran.money/releases/channels.json`. They use the same bounded parser as
the browser, forward no local cookies/headers/query strings, and keep no stale
snapshot. Local downloads therefore show the publisher's actual per-store versions;
the sibling repository is not required. Internet access is required for this check.
An unavailable upstream disables links and offers retry, not an invented version.

Use `bun run preview`, not bare `astro preview`: Astro 5 discards custom Vite
middleware in static preview, so this script uses the same pinned Vite version
directly with Astro directory-page routing. Neither local server emulates all
nginx redirects or artifact downloads. Production routing remains in nginx and
requires `ARTIFACT_ORIGIN`; a Docker preview can use the current public site as its
origin while that site still serves the artifacts. Never point the deployed
frontend's artifact origin back to itself.

Docker uses the **repository root** context:

```sh
docker build -f site/Dockerfile -t sovran-site .
docker run --rm -p 8080:8080 sovran-site
```

Only explicit site sources, the shared phone model, canonical legal JSON, plain
site copy and the reviewed iOS capture PNGs plus their manifest enter the build stages. The runtime is
static nginx, without Bun, Node, `.env`, or app dependencies. The original font and
identity assets are retained locally in `site/public`; the build never reads the
sibling website repository. Root `.dockerignore` allows the iOS PNG subtree and
shared device module, but not Android captures or native app sources.
Production delivery still needs checks before activation.
The Docker dependency install is outside any workspace.

## Local Artwork Gallery

Open `/dev` with `bun run dev` or `bun run preview` from `site/`. All existing
artwork appears in a responsive thumbnail grid, not a one-image selector. The
**View** control shows current images by default; **Needs review** lists drafts,
stale renders, stale captures and untracked files; **All** shows everything.
`?view=review` and `?view=all` are shareable. Search, family/status filters and
visible counts apply within the view. **Refresh files** rescans
the filesystem and metadata; no export or build is needed to discover new outputs.
Preview still requires an existing site build. Bare `astro preview` does not mount
these routes; use the package's preview command. Bind local servers to loopback;
this is a development utility, not an authenticated asset server.

The server recursively scans PNGs in `press/artwork/generated`, `press/mockups`,
`press/exports`, `site/public/mockups`, `site/public/social`, and
`app/assets/brand/generated` (all relative to the repository). Selected outputs and
regenerated layout variants are included; contact sheets are not generated or
retained. Byte-identical SHA-256 duplicates share a thumbnail and retain
every alias path, family and evidence record in details. Source wallpapers,
screenshots, native runs and private captures are not image roots. Symlinks,
including redirected root ancestors, are rejected. Missing optional roots are OK.

Local-only route contract (both Astro dev and the Vite preview config):

- `GET /__artwork/catalog`: fresh JSON with `schemaVersion: 1`, `generatedAt`,
  `roots`, `caveats`, `fileCount`, `uniqueCount`, `diagnostics`, and `items`. Each
  item has an opaque SHA-256 `id`, `imageUrl`, dimensions, byte size, `aliases`,
  `families`, `statuses`, and `current`. Aliases retain relative paths, per-file
  metadata/diagnostics and their own `current`. An alias is current when it is
  `current-render` without `stale-render`, `draft`, `stale-known-capture` or
  `untracked`; an item is current when any alias is.
- `GET /__artwork/image/<id>`: original PNG bytes, only for a catalogued ID.
  No path parameter, arbitrary file lookup, asset copying, re-encoding or network
  request. Native `loading="lazy"` thumbnails use fixed boxes with `object-fit:
  contain`; large originals still cost bandwidth and decoding time.
- `HEAD` is supported without a body. Other methods return `405` with
  `Allow: GET, HEAD`; unknown IDs/paths return `404`, changed image bytes return
  `409` until catalog refresh, and unreadable images/catalog failures return `503`.
  Responses disable caching, sniffing and cross-origin image embedding. Cross-site
  browser requests are rejected. No request cookies or headers are forwarded.
- Production static hosting has neither endpoint. `/dev` explains local-only
  availability instead of embedding a stale catalog or publishing local images.

`stale-known-capture` follows relevant registry keys/files marked unavailable or
stale, including the retained receive-QR poster. A replacement candidate from a
passing run awaits native build verification; those pixels are not included. `draft` follows manifest flags.
`stale-render` means recorded output, source, provenance, renderer or browser-input
hashes differ or their files are missing. `current-render` means recorded output
and available input hashes match, **not** native freshness or production approval.
Native freshness is a catalog-level caveat: `caveats` lists
`native-freshness-unverified` once, and no alias status repeats it.
`capture-scope-unverified` images remain current; the gallery shows a quiet chip. Incomplete/unknown
render records are `untracked`, not assumed fresh. Browser records without explicit
per-export screenshot keys conservatively check the full recorded input set and
say so in diagnostics. Historical stale images remain viewable and downloadable.

Focused checks, without building, from the repository root:

```sh
node --test site/scripts/local-artwork.test.mjs
```

These exercise temporary fixture filesystems, HTTP dev/preview middleware, path and
symlink rejection, hash/alias/status derivation, refresh and the actual local PNG
catalog (with its observed counts printed). They do not capture native screens,
regenerate artwork, start a browser or validate production approval.

## Content And Evidence

- `../copy/src/site.ts` owns plain homepage/benefit/release/roadmap copy. It imports
  nothing. Roadmap statuses distinguish source implementation, work in development,
  and proposed direction; they do not establish that every store has those features.
- `../copy/legal/documents.json` is canonical. Its operator/document/publicationReady
  structure is validated before building and revisions use the app's fingerprint
  algorithm. The generated endpoint emits
  the exact source bytes, and every policy paragraph appears in static HTML. Draft
  bundles are visibly marked and noindexed, never relabelled as approved.
- `/build.json` exposes canonical legal revisions, site-copy and dependency-lock
  SHA-256 revisions. These are content fingerprints, not a claim of a clean Git
  checkout, signed release, deployed app version, or store availability.
- `PhoneScene.astro` consumes the reviewed iOS capture catalog through Astro's
  image pipeline. `scripts/verify-inputs.mjs` checks every retained PNG against its
  capture run, dimensions and SHA-256. The shared device model clips screens and
  constructs continuous, uniformly offset frame contours. Static SVG projects
  the device frames; screen contents are actual images, never recreated UI.
  Standard scenes render without JavaScript; the optional custom scene editor
  uses client-side composition. Provenance stays in manifests/docs rather than a
  repeated public caption. Removing the caption does not imply a native recapture.
- Visual authority: sibling `sovran.money/src/pages/Home.tsx`, `src/App.tsx`,
  `src/index.css`, `src/content/home.tsx`, `public/hero-devices.png`, product artwork,
  committed desktop/mobile references, and the live `https://sovran.money/en/`.
  The restoration keeps Mona Sans, `#080808`, 84px desktop hero type, compact
  rectangular actions, the device-first mobile composition, manifesto, OpenSats
  grant attribution, white problem/solution surface, alternating product scenes,
  pale stack/logo watermark, dark FAQ, and white download section.
- Deliberate differences: corrected custody/recovery/offline/availability wording;
  no unsupported store, source, privacy, or settlement guarantees; no fake locale
  switch or obsolete product links. FAQ and mobile menu use native `details`.
  The original branded download cards, iOS/Android groups, metadata alignment and
  QR layout retain all five independently checked release channels.
- `scripts/restore-assets.mjs` records the one-time read-only import of three
  original Mona Sans weights, the OpenSats mark, and seven grayscale stack marks.
  `public/sovran-mark.svg` and the logo slot inside `public/downloads/download-qr.svg`
  are derived from `app/assets/brand/source/symbol.svg` by
  `node scripts/site-brand.mjs` from the repository root. The original viewport,
  QR grid and logo placement are preserved; use `--check` to detect logo drift.
  See the [brand ownership inventory](../app/assets/brand/README.md#app-website-and-press-ownership).
  Mona Sans is under
  SIL OFL 1.1; its notice is included beside the fonts. Third-party logos identify
  the named projects, not blanket endorsements. OpenSats links to the original
  dated grant announcement rather than implying a new grant.
- `public/.well-known/nostr.json` preserves the two public name mappings verified
  in the reference repository's tracked file of the same name, without adding
  relay configuration. This verifies provenance, not possession of private keys.

## Scene Exports

With `site/` as cwd, Bun and local Chrome/Chromium installed (`CHROME_PATH` may
select an executable; otherwise the script checks PATH and platform install paths):

```sh
bun scripts/visual.mjs --export /absolute/path/to/press/mockups
bun scripts/visual.mjs --export "$PWD/public/mockups"
bun scripts/visual.mjs --export "$PWD/public/social" --og-only
bun run build
```

Run the first command after a frame/copy change or an approved screenshot refresh.
It exports the nine named presets, five homepage scenes, `og.png`, and a
source/output hash manifest. It rebuilds first and fails if inputs
change during export. The scene pages at `/scenes/<name>` are static and noindexed.
The OG-only command updates the website's 1200x630 social preview using the same
rendered scene. Rebuild afterward to include it in the site. Metadata is withheld
if its source hashes or exported PNG no longer match; no stale placeholder is used.
Temporary browser profiles and staging files use `os.tmpdir()` and are removed
after the owned browser exits. Evidence folders and requested destinations are
never recursively removed. Browser startup, connection, CDP commands, and builds
have deadlines. Exports stage first, reject changed inputs, and only replace
files matching the destination's previous export manifest. Edited/unrecognized
files fail closed. Use separate destinations for a full scene set and OG-only
exports; updating only part of a set against changed inputs is rejected.

`bun scripts/visual.mjs` compares the original local `dist` and this site's build
at 1440x1000 and 390x844, with all lazy images loaded. `--live` uses the live
original instead. It writes full-page/section evidence and checks to a temporary
folder, checking overflow, images, FAQ/menu controls, and fail-closed downloads
under the production content-security policy. It also tests 320px layouts, all
screen ratios, continuous-corner hit regions and extrusion bounds. It never edits
the reference site. Use `/scenes` to browse presets and `/scenes/custom` to compose
an ordered screenshot list with explicit rotation, depth and scale controls.

### Frame Geometry

`scripts/lib/phone-frame.mjs` at the repository root owns the dependency-free
equal-radius port of the cubic / arc construction in
`react-native-fast-squircle@1.1.5/ios/SquirclePathGenerator.swift`.
The library's MIT notice is retained unchanged in `public/licenses/fast-squircle.txt`.
It licenses that third-party construction, not the whole repository. The project
license is **Mozilla Public License 2.0**, recorded in the root [LICENSE](../LICENSE).
The shared construction now lives in `scripts/lib/phone-frame.mjs`; the site
adapter imports it rather than carrying another geometry implementation.
The adapted MIT code and OFL fonts retain their own notices, not a new MPL license.
The public [license clarification](public/licenses/README.txt) explains these
scopes without replacing any upstream notice or granting logo/trademark rights.
Read-only app authorities are `app/shared/ui/primitives/SquircleView/index.ts`
(smoothing 0.6), `app/shared/providers/OfflineProvider.tsx` (continuous parent
shell and inset-radius relationship), `app/shared/lib/screenCornerRadius.ts`, and
`app/e2e/viewer/src/components/deviceCorners.ts` (62pt at an 874pt screen height).
The web build imports none of those native files or packages.

Each capture's actual width/height selects the calibrated Pro or Pro Max display
plane. A presentation-only uniform scale makes their chassis heights equal;
screen pixels retain their original aspect ratios. Rows use measured widths and
a fixed gap; grids align their baselines and central gutter. Explicit pose scales
remain relative size choices. SVG `clipPath` uses the native plane's coordinates.
The screen, black glass, 1pt metallic rim, and 65 depth sections spanning the
calibrated sidewall share continuous contours and an orthographic 3D projection.
This is a static extruded model, not a perspective camera or certified hardware
CAD. The hero uses a shared 12-degree clockwise orientation, feed behind/above
the foreground wallet. Existing islands and indicators remain in the captures;
no camera or app UI is drawn over them. The conservative scene bounds contain
the chassis and hardware. Sidewall shading is subdued illustrative material,
not a physically based lighting simulation or photographic perspective.

## Download Trust Boundary

The pure parser is ported from the old site's allowlist, not its React hook. It
requires all five channel keys, permits explicit `null`, checks versions/builds,
restricts destinations to the known app identities and binds APK version/tag/name.
Unknown or malformed metadata rejects the entire response. A previously allowed
App Store record without a version/build is now unavailable, not a confirmed link.
Optional publisher hashes, size and source revision are validated when present;
legacy records need not gain fields the current publisher has not supplied.

The browser requests only `/releases/channels.json`, without cookies or referrer,
with redirects rejected, cache disabled, a 10-second timeout and a 100,000-byte
stream limit. All channels start disabled. A retry removes all previous links
before fetching. There is no stale fallback, local-storage cache, unconditional
Android redirect, or automatic store choice. The releases page is a static
editorial log with a link to the separate download page.

This is destination and metadata validation, **not** cryptographic authentication
of the publisher or verification of downloaded APK bytes. Displayed hashes come
from that same publisher; compare them with an independently trusted source.
Review upstream store redirects, code signing, origin ownership and artifact
integrity as part of activation.

## Privacy And Routes

**Analytics are withheld.** There is no tracking script, SDK, pixel, cookie banner
that enables tracking, or identifier collection in this implementation. Do not add
analytics until its reviewed disclosure is deployed and the actual configuration,
consent requirements, IP handling, event fields and retention have been checked.
Existing canonical policy text is preserved, not rewritten to justify new tracking.
Reverse proxies or hosting providers can still process request data; their logging
and retention require operational review.

nginx disables access logs and suppresses ordinary request error logging. Retired
`esim`, `esims`, `order`, `orders`, `blog`, and `test-flows` paths return plain 410
before any page JavaScript or locale redirect. It does not reflect invoice/order
values. Known prefixes `en es ja ko zh fr uk ru pl de pt` redirect to unprefixed
paths, dropping query strings. This preserves old links, not translated content.
Unknown paths return real 404s, never the homepage. The verified public Nostr
well-known JSON is available with wildcard read-only CORS for NIP-05 clients.

## Verification Limits

Parser/fetch, static route, policy byte/fingerprint/render and actual local nginx
smoke tests are included. The nginx smoke verifies the unconfigured-origin path;
it does not authenticate a real upstream, download an IPA/APK, or exercise TLS
proxying to a production artifact host. Docker must be tested with a running daemon
before deployment. No publisher, store or production endpoint is mutated by tests.

The restoration passed Astro build, Bun tests (including actual local nginx
requests), legal byte/render parity, all six capture hash checks, and the root
TypeScript compiler's `--noEmit -p site/tsconfig.json` check on 2026-09-14.
Two batched desktop/mobile browser rounds compared the original and restored
pages. The single repair pass corrected caption overlap, phone bounds, mobile
action stacking, and production-CSP-compatible pattern placement. The detector's
Mona Sans warnings are intentional: the user's original-font instruction wins.
No further visual polish loop was run. Earlier Chrome contract smoke checks covered
independent versions, loading/retry/failure, and JavaScript-disabled privacy;
the restoration leaves that client logic untouched and retains its tests.
The container was not built or deployed in this scoped restoration. Root Docker
allowlist integration and new native capture confirmation remain with the parent
task. Neither local evidence nor workflow definitions establish production readiness.
# Marketing and editorial workbench

From the repository root, `bun run site:dev` opens `/dev`. The workbench links the
public pages, annotated screenshot catalog, curated mockups and orientation atlas.
All workbench routes are noindex; that is indexing advice, not access control.
Only reviewed, non-private marketing captures belong in its inputs.

Roadmap and release prose lives in `copy/src/site.ts`. Keep releases dated,
newest-first, with short user-facing changes and a source link, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plain-language
approach of [Minibits releases](https://github.com/minibits-cash/minibits_wallet/releases).
Roadmap goals are not release claims. Do not infer new release features from an
old roadmap or from the current development branch.

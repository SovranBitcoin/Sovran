# Sovran Site

Standalone static Astro 5.18.2 with plain CSS and Astro components. It has no React
integration, private schema dependency, tracking SDK or build-time release fetch.
The local artwork workbench and public website share rendering primitives, not
their asset inventories.

## Commands

From the repository root:

```sh
bun run site:install
bun run site:dev
bun run site:build
bun run site:test
bun run site:assets
bun run site:assets:check
```

The isolated installer copies the site's package manifest and frozen lock to a
temporary directory, installs with lifecycle scripts disabled, then copies its
dependencies back. Do not run `bun install` inside `site/`: workspace discovery
can alter the native installation. `--update-lock` is only for an intentional
isolated dependency refresh.

Sharp and OpenType are pinned public development dependencies for the local
renderer and its tests. The isolated install does not install the native app.

With `site/` as the working directory, `bun run preview` serves the completed
public build. Use that command rather than bare `astro preview`; the pinned Vite
preview supplies directory-page routing and local release metadata middleware.
Only `bun run dev` serves the artwork workbench.

## Local Workbench

Open <http://localhost:4321/dev>. Screenshots, logos, social compositions and
website outputs have separate pages. See [the press guide](../press/README.md)
for capture commands, evidence classes, retention and editing.

- `/screenshots`: all canonical page/platform slots, paired native views, latest
  attempt, freshness, blockers and downloads.
- `/logos`: layout/colorway groups with ordered PNG sizes and SVG downloads.
- `/social`: related-screen concept gallery and editable compositions. Text,
  frame, screenshots, platform, placement, scale and canvas are recipe inputs.
- `/mockups`: the website's explicitly selected compositions and output status.
- `/scenes`: advanced geometry reference and explicit legacy scene exports.

Social preview and download use the same final SVG and rasterization. Edits live
in the URL fragment or exported/imported JSON. No PNG inventory or repository
write occurs when browsing. Missing images never receive substitutes. Outdated
inputs require labelled draft mode; public website generation rejects drafts.

The local API accepts only allowlisted capture IDs, manifest-approved logos and
bounded composition JSON. Exact loopback Host/Origin checks, body/pixel/phone
limits, one concurrent render, path/symlink checks and byte hashes protect that
boundary. It serves no raw E2E run directories, logs, AX snapshots or arbitrary
paths/URLs. The retired generated-file catalog is not an API surface.

Production excludes workbench routes before Astro compilation. The public asset
copy excludes their directories, and nginx also denies their routes. `noindex`
alone would not prevent private images from being emitted into `/_astro`.

## Website Assets

`press/website.json` owns named phones, scene arrangements and saved outputs.
The public image import list is generated from that file, not maintained separately.
The homepage renders its selected scenes directly using Astro-optimized native
captures. Only the OG raster is currently consumed, so it is the only approved
saved website composition: `site/public/social/og.png`.

`site:assets` validates sources, stages the PNG and manifest, verifies dimensions
and provenance, and replaces only unchanged owned outputs. Failed rendering,
stale captures, edited destinations and unknown files preserve previous bytes.
`--check` does not write. Old poster and duplicate mockup batches are not part of
refresh. `site:assets:prune --apply` retires only unchanged, tracked,
manifest-owned historical outputs; it leaves user exports and source images alone.

`scripts/lib/phone-frame.mjs` owns calibrated capture planes and orthographic
phone geometry. Native aspect ratios are preserved; incompatible explicit frames
are rejected. These are screenshot-based illustrations, not manufacturer CAD or
physically based renders. The continuous-corner construction derives from
`react-native-fast-squircle@1.1.5`; its MIT notice remains in `public/licenses/`.
Mona Sans retains its OFL notice. The repository license remains MPL-2.0, not the
licenses of those individual components. Trademark rights are not granted by
those notices.

The explicit legacy geometry exporter remains available for specialized evidence:

```sh
# Run inside site/; never defaults to every preset.
bun scripts/visual.mjs --export /absolute/output --preset duo-depth --screenshots ios/feed,ios/wallet --format landscape
```

Its internal build lives in `.astro/internal-dist/`, not public `dist/`. Browser
profiles/staging are temporary; unowned destinations are never erased wholesale.

## Content And Downloads

`copy/src/site.ts` owns plain homepage, benefit, release and roadmap copy.
`copy/legal/documents.json` owns canonical policies; builds validate and publish
their exact revisions. Roadmap items and source implementation do not establish
store availability. Releases remain dated, newest-first, with source links.

`scripts/site-brand.mjs` derives the site mark and download-QR logo from the same
brand master used by the native app. Builds verify it with `--check`. Third-party
stack/supporter logos identify those projects, not blanket endorsements. The
public Nostr well-known JSON preserves the reviewed public name mappings.

The download client validates all five release channels, version/build identity
and allowlisted destinations. It fetches only `/releases/channels.json`, omits
cookies/referrers, rejects redirects, bounds time/size, and disables links on
failure. There is no stale snapshot or invented version fallback. Displayed hashes
come from publisher metadata; this is not cryptographic publisher authentication.

Both local dev and public preview read current metadata from
`https://sovran.money/releases/channels.json` through the bounded local middleware.
They do not emulate all production redirects or artifact downloads.

## Deployment Boundary

Adding this source does not activate DNS, Railway or a publisher cutover. Docker
uses the repository root context and `site/Dockerfile.dockerignore`:

```sh
docker build -f site/Dockerfile -t sovran-site .
docker run --rm -p 8080:8080 sovran-site
```

The runtime is static nginx without Node, Bun, app dependencies or environment
files. Select `site/railway.json` deliberately and review legal/content delivery
before activation. `ARTIFACT_ORIGIN` must identify the external HTTPS hostname
serving the existing publisher tree: no path, port, credentials, query, trailing
slash or self-reference. `ARTIFACT_RESOLVER` defaults to `1.1.1.1`; `PORT` to 8080.

Capture sources are available in the build stage, but only recipe-selected image
imports enter the final public build. CI checks freshness against the full app
source before building the container. A standalone container without Git can
verify render consistency, not independently establish native app freshness.

Without an origin, artifact and release-metadata paths return 503 while the HTML
site starts normally. `/health` proves only static-site health. Do not delete the
old artifact repository: the publisher still writes its release files and iOS
ADPs there. Publisher cutover, immutable-byte checks, store testing and DNS remain
separate operational work.

nginx suppresses access logging, returns 410 for retired commerce routes, handles
known locale-prefix redirects without retaining query strings, and returns real
404s for unknown paths. The NIP-05 well-known JSON allows public read-only CORS.
No analytics script or tracking consent behavior is introduced by this work.

## Verification

Site tests require a completed build, local nginx and envsubst. They use isolated
loopback servers, not system nginx configuration. Composition tests verify actual
SVG/PNG equivalence, source approval, hashes, recipe limits and endpoint isolation.
`node --test site/scripts/composition-browser.test.mjs` from the root exercises
desktop/mobile controls and downloads with local Chrome/Chromium.

Native screenshot verification is separate from web builds and synthetic tests.
Read the current campaign report and `screenshots:status --strict` before claiming
fresh coverage. Docker tests require a running daemon; local tests do not establish
production origin readiness, store delivery, TLS behavior or deployment success.

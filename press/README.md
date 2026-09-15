# Press assets

## Marketing workbench

Run `bun run site:dev` from the repository root and open `/dev`. Use `/screenshots`
to inspect what each retained image shows, its flow/state, related pages and run
provenance. `/mockups` pairs curated stories with one-to-four-phone compositions;
`/scenes` displays every supported orientation. The custom composer supports
shareable selections and fixed-ratio canvases without cropping or stretching.

`bun run press:variants` lists the export plan without writing images. To render:

```sh
bun run press:variants --export ../press/exports/normalized
```

The renderer verifies the retained bytes, skips missing captures and records
source/output hashes. P2PK key management and locked receiving are a registered
story awaiting reviewed captures; the existing Unified QR is not substituted.
These are marketing illustrations from historical captures, not device tests.

Routine asset commands no longer generate missing-input drafts. The older poster
pipeline remains available through `assets:artwork`; only the explicit
`assets:artwork:drafts` command allows placeholders. Do not publish those drafts.

Promotional artwork lives in [artwork/](artwork/README.md), outside the app's
runtime import graph. The initial move from `marketing/artwork/` preserved all
internal source/output paths, filenames, capture pins, image bytes and file modes.
That move was not a recapture, visual redesign or provenance upgrade. The later
copy correction below intentionally changes the affected rendered artwork bytes.

## Copy and frame corrections

Copy version 4 corrected the `payments-instant` alternatives. Version 5 reviews
all 19 concepts, including unselected alternatives, against [CLAIMS.md](../CLAIMS.md).
Corrections distinguish digital cash from its mint-held backing, qualify recovery
and compatibility, and explain provider visibility. Concept identities and the
headline/subtitle selection mechanism are unchanged.

This is a new render from historical source captures, not new native evidence.
The full catalog is regenerated with the corrected copy and the shared continuous
phone frame from `scripts/lib/phone-frame.mjs`. Copy, frame and renderer hashes
are recorded in provenance. Source screenshots, screenshot registrations, store
pins and brand assets are unchanged. No source capture was replaced or relabelled.

```sh
node scripts/artwork.mjs --allow-missing
```

Use normal generation for copy changes. `--manifest-only` cannot apply them when
rendered pixels differ.

## Brand location correction

Brand sources and generated exports remain at
[`app/assets/brand`](../app/assets/brand/README.md). The EAS postinstall and asset
checks require that owner today. Moving brand masters or outputs into `press/`
would break that build contract; it is explicitly not part of this move. Fonts,
runtime assets, e2e fixtures and scenario IDs also stay where they are.

## Capture provenance

### Partial iOS attempt, 2026-09-15

A real disposable iPhone 17 Pro/iOS 26.2 run captured 12 core-tour PNGs, including
a visibly updated receive QR. The run's eight-minute outer deadline interrupted
it before verification; intake correctly rejected it. It used current Metro
source with an existing **0.1.1 (1)** native development binary, not a fresh
0.1.3 build. A retry stopped at the 10 GiB storage gate (8.6 GiB available).
No canonical pixels or pins were replaced. The retained `ios/receive-qr` is now
explicitly unavailable/stale; its historical bytes and attribution remain.
See [the evidence and blockers](../app/e2e/press/REFRESH-2026-09-15.md).

### Recapture status, 2026-09-14

The existing `store-screenshots`, `marketing-screenshots`, and `backup.flow`
journeys remain the capture path. Their obsolete onboarding/backup labels were
repaired; the existing loader regression now derives expected titles from
`copy/onboarding`. Validation, dry-runs and fake-driver smoke pass, but none of
those are new native screenshot evidence.

A fresh Android development APK was built for `com.sovranbitcoin.dev`, version
0.1.3, with `ACTIVITY_RECOGNITION` absent. The real Android store-capture attempt
stopped before emulator boot because the host had less than the runner's required
7.3 GiB of free space. iOS still requires a fresh build. No retained screenshots
or store pins were replaced, and the full recapture remains incomplete.

The site phone scenes now use the app's continuous-corner construction for both
screen clipping and the chassis, with an orthographic 3D extrusion. Regenerate
their browser-rendered exports with `bun run press:mockups`; its manifest records
input and image hashes. These scene exports do not establish screenshot freshness.

The retained captures are historical. Existing run IDs and SHA-256 pins identify
retained artifacts; they do not establish that those images show today's source
or a newly built native app. Renderer/source fingerprints prove which local
inputs produced an export, not native build freshness or successful device tests.
The historical [validation record](artwork/VALIDATION.md) is not a current capture
inventory or a new verification claim.

The capture CLI below automates existing journeys and candidate export; no newly
completed native capture or native freshness is claimed. Build-bound stamps are
not implemented. Before claiming freshness, a successful native build and
capture run must be verifiably bound to the reviewed source, platform/build
identity, scenario and screenshot artifacts. A source fingerprint alone is not
native proof. Failed builds, matching filenames and planned runs do not qualify.

Never hand-copy real device captures into this tree or fill in provenance to
make a check pass. Future capture ingestion must authenticate successful
build-bound run artifacts and preserve their exact bytes and evidence. Until
that mechanism exists, retain historical captures honestly and leave unavailable
inputs as explicit drafts. Do not fabricate screenshots, masks or manifests.

## Refreshing every screenshot

One command captures, promotes and regenerates every screenshot on `/screenshots`:

```sh
bun run screenshots:refresh:plan        # read-only: native build status, sessions, keys
bun run screenshots:refresh             # both platforms, one after the other
bun run screenshots:refresh ios         # or one platform
bun run screenshots:refresh ios --scenario marketing.screenshots
```

For each platform it runs four stages:

1. **Native build.** It computes the Expo fingerprint of the development client
   (`APP_VARIANT=development`, generated `ios/` and `android/` excluded). A stamped
   build in `app/e2e/artifacts/native-builds/<platform>/` with the same fingerprint
   is reused. Otherwise it runs `expo prebuild` and a local build: `xcodebuild`
   Debug for the iOS Simulator, or `gradlew assembleDebug` with JDK 17. iOS keeps
   only the finished `Sovran.app`; its 10+ GB DerivedData is deleted afterwards.
   `--rebuild force` or `--rebuild never` overrides the check.
2. **Capture.** Every press session runs on that build. `SOVRAN_E2E_APP_PATH` and
   `SOVRAN_E2E_APK_PATH` pin the drivers, so they never fall back to an older
   installed app. A failed session retries once (`--attempts N`), and later
   sessions still run.
3. **Promotion.** Each passing session is imported with the full validation below,
   then `promote.ts` copies its PNGs into `press/artwork/source/screenshots/` and
   rewrites each registry entry with `run`, `sha256`, `capturedAt` and
   `nativeBuild`. Unavailable and stale flags are cleared. Store pins move only
   when the whole store set came from one run.
4. **Failures.** A session that still fails writes `lastRefreshFailure` onto its
   entries. The previous capture stays in use, and `/screenshots` says why it was
   not replaced.

When anything was promoted, it then regenerates artwork and layout variants
(`scripts/artwork.mjs --allow-missing --variants`), `press:mockups`, a fresh
`press/exports/normalized` batch and the site build. `--no-downstream` skips this.
A JSON report is written to `app/e2e/artifacts/screenshot-refresh-*.json`, and the
exit code is non-zero if any build, session or downstream step failed.

Run it from a normal terminal and leave the machine alone: a full iOS pass is
about an hour, and a simulator plus Metro needs several GB of RAM. Agent
background jobs can be stopped under memory pressure. Each scenario runs as its
own session, so captures promoted before an interruption are kept; rerun to
continue.

Each capture session still needs **10 GiB free**. A cold iOS build peaks near
11 GB before DerivedData is removed. Android also needs Gradle caches and a
7.3 GiB emulator floor.

Staleness is detected, not assumed away. Every promoted capture records
`appSource`: a fingerprint of the files that decide rendered pixels (`app/`
except e2e, tests and docs, plus `wallet/`, `nostr/`, `copy/`, `package.json` and
`bun.lock`), with the commit it came from. `scripts/lib/app-source.mjs` owns the
rule. Promotion refuses a capture without it, and a session whose app source
changes mid-capture is not promoted. Edits to `press/`, `site/`, e2e scenarios
or tests never make a capture look outdated.

```sh
bun run screenshots:status           # current / outdated / unverified / withdrawn / missing
bun run screenshots:status --strict  # exit 1 unless every capturable screenshot is current
```

`/screenshots` shows each capture's freshness, and the `/dev` gallery marks
artwork built from outdated or unverified captures as `outdated capture`, so it
leaves the Current view. Withdrawn captures are never displayed.

Registry semantics:

- `freshness: "stale"` with `staleReason` withdraws a capture whose content is
  known to be wrong. Renderers and scenes exclude it, and `/screenshots` shows it
  small beside its capture request.
- Entries without `nativeBuild` predate build-stamped refreshes. They remain
  usable and the page labels them as older captures.

The lower-level `press:capture` (capture plus unreviewed candidates, no build or
promotion) and `press:import RUN_DIR...` remain available.

Selection is fixed to `store-screenshots`, all four `marketing-screenshots`
scenarios, and only `backup.flow`, `settings.keyring.generate`, and
`receive.qr-display.tabs` from `full`. `--scenario ID` narrows that allowlist to
one exact scenario; it never expands it. The real e2e loader and planner
check every selection and expanded fixture for simulator/no-funding operation.
Some mint/media captures depend on external read data. Missing readiness must
fail rather than produce an empty replacement.

The read-only plan lists every scenario, all named capture steps, the 31 required
press mappings per platform, and uncovered registrations. Mapping lives in
`app/e2e/press/plan.ts`; no source pins are duplicated there. In particular:

- `marketing.screenshots` / `ai` occurrence 2 is `ai-model-picker`.
- Wallpaper `wallet` occurrences 1-8 are navy, sunset, beige, in-eclipse,
  edge-of-lunar-day, setting-earth, new-moon and looking-back-at-earth. The last
  is reached by re-applying the Artemis album and switching to EUR, because the
  picker's first row cannot be tapped.
- `marketing.screenshots.media` captures `thread`, `image-viewer` and `stories`.
  The viewer opens from a separate control over the inert demo card and closes
  with a swipe, because its close button is not in the iOS accessibility tree.
- `backup.flow` / `backup-words` occurrence 1 is the existing display-only public
  practice vector, not a real wallet backup.

### Candidate intake

Every session is validated before promotion. Intake requires a native
`product-run` manifest, a source fingerprint, the exact selected scenarios, a
completed passing event stream without failures, skips, deferrals or funding,
successful cleanup and expected final states, and every named
scenario/page/occurrence tied to its completed screenshot step. It checks PNG
format, decoding, portrait dimensions, nonblank content and realpath containment,
and verifies copied bytes. No resizing, re-encoding, AX/state sidecars, keys or
logs are copied. To import existing runs without promoting them, name every
directory explicitly:

```sh
bun app/e2e/press/import.ts app/e2e/artifacts/run-EXPLICIT_ID [OTHER_RUN_DIR ...]
```

Validation is structural. It does not prove a screen shows populated content, so
scenarios must wait on a populated-state probe before each screenshot.

```sh
bun test app/e2e/press/*.test.ts
```

## Offline verification

Run from the repository root:

```sh
node scripts/artwork.mjs --manifest-only --allow-missing
node scripts/artwork.mjs --check --allow-missing
bun run assets:test
bun run assets:check
```

`--manifest-only` uses the existing renderer to recompute provenance, verifies
every retained output byte and the output inventory, then updates only
`artwork/generated/manifest.json`. It refuses changed pixels or missing outputs;
it does not rewrite images. `--check` is read-only. Neither command performs
network calls, builds or captures. `--allow-missing` labels absent inputs as
drafts; it does not tolerate corrupt sources or certify capture freshness.

`scripts/fetch-wallpapers.mjs` is a separate, explicit network maintenance command,
not part of these checks. Do not run it as part of a path-only move.

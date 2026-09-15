# X2 verification — 2026-09-13

Historical record retained during the move to `press/artwork/`. The paths,
counts, missing-input list and command results below describe that earlier task,
not the current inventory or a fresh native build/capture. See the
[press provenance policy](../README.md) for current evidence limits.

19 concepts; 177 applicable full-size variants: **123 complete, 54 labelled drafts**. There are 279 n/a tiles across the full 19 × 8 × 3 grid. Committed exports: 57 selected images, two platform banners and the manifest. Contact sheets were later removed; the local `/dev` gallery replaces them. Full variants remain gitignored.

## Every concept × layout

Each cell applies to **wide, tall and square**. R = rendered with complete inputs; D = rendered as an explicit missing-input draft; n/a = inapplicable (reason in `manifest.concepts[id].layouts`).

| Concept | hero-fan | spotlight | duo | triptych | stack | closeup | portal | pack |
|---|---|---|---|---|---|---|---|---|
| ai-chat | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| ai-models | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| app-overview | R | R | R | R | R | R | n/a | n/a |
| backup | n/a | D | n/a | n/a | n/a | D | n/a | n/a |
| contacts | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| mint-reviews | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| mint-trust | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| mint-updates | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| payments-instant | R | R | R | R | R | R | n/a | n/a |
| portal-artemis | n/a | D | n/a | n/a | n/a | D | D | n/a |
| receive-unified | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| send | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| social-dm | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| social-feed | n/a | R | n/a | n/a | n/a | R | n/a | n/a |
| social-thread | n/a | D | n/a | n/a | n/a | D | n/a | n/a |
| stories | n/a | D | n/a | n/a | n/a | D | n/a | n/a |
| themes-artemis | D | D | D | D | D | D | D | D |
| themes-colors | R | R | R | R | R | R | D | R |
| wallet | n/a | R | n/a | n/a | n/a | R | n/a | n/a |

## Files and scope

- `scripts/artwork.mjs`, `scripts/artwork.test.mjs`: single pipeline and its tests, replacing the former featured/feature-graphic scripts. The checkout had one former artwork test file; there was no separate feature-graphic test file to migrate.
- `scripts/lib/marketing-render.mjs`: full captures in the shared phone frame; no system-chrome trimming.
- `scripts/fetch-wallpapers.mjs`, `scripts/fixtures/artwork-store-pins.json`: explicit portrait fetch/authentication helper and immutable original store pins.
- `marketing/artwork/`: migrated screenshots and palette sources; layout/copy/concept/selection JSON; supplied portrait catalog and panorama provenance; regenerated selected outputs, manifest and documentation. Removed both superseded marketing trees.
- Root/app `package.json`, both `.easignore` files, `.gitignore`, `.github/workflows/ci.yml`, `app/__tests__/marketingNotBundled.test.ts`, `app/assets/README.md`, `SYSTEM.md` §23: single-pipeline commands, exclusions, guard and documentation.
- `app/e2e/scenarios/marketing-screenshots-wallpapers.json`: four explicit Artemis UI capture journeys, checking the actual loaded-image probe. No runtime app changes, dependency/lockfile/patch changes, simulator runs or publication.

## Gate output

All commands run from the repository root unless an `app/` working directory is stated. Logs below are actual local output tails.

`node scripts/artwork.mjs --allow-missing --variants` — exit 0:

```text
Generated 19 artwork concepts; 9 missing inputs (labelled drafts allowed).
```

`node scripts/artwork.mjs --check --allow-missing` — exit 0:

```text
Verified 19 artwork concepts; 9 missing inputs (labelled drafts allowed).
```

`bun run assets:test` — exit 0:

```text
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9200.406541
```

`bun run type-check` — exit 0:

```text
$ bun run --filter '*' type-check
nostr type-check: Exited with code 0
wallet type-check: Exited with code 0
Sovran type-check: Exited with code 0
```

`bun run test -- marketingNotBundled --runInBand (cwd: app/)` — exit 0:

```text
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Snapshots:   0 total
Time:        1.479 s
Ran all test suites matching marketingNotBundled.
```

`bun run e2e:validate (cwd: app/)` — exit 0:

```text
$ bun e2e/validate.ts

[validate] ✓ all e2e JSON valid + compact + suite-complete
```

`bun run lint (cwd: app/)` — exit 0:

```text

✖ 142 problems (0 errors, 142 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

`bun run check:styling (cwd: app/)` — exit 0:

```text
    features/user/screens/UserMessagesScreen.tsx  inline-style: 3 → 2
    … and 8 more

  Run `node scripts/check-styling.mjs --update` to bank the reduction.
```

Lint warnings are pre-existing: none of the files named in the 142-warning output changed in this task. The styling guard also reports no new debt; its suggested reductions are pre-existing and were not banked.

`bun run assets:check` — exit 0:

```text
themes-artemis: rendered hero-fan, spotlight, duo, triptych, stack, closeup, portal, pack × wide/tall/square; n/a none
themes-colors: rendered hero-fan, spotlight, duo, triptych, stack, closeup, portal, pack × wide/tall/square; n/a none
wallet: rendered spotlight, closeup × wide/tall/square; n/a hero-fan, duo, triptych, stack, portal, pack
Verified 19 artwork concepts; 9 missing inputs (labelled drafts allowed).
```

`git diff --check` — exit 0, no output.

## Evidence boundaries and follow-ups

- Native store pin tests authenticate all eight original PNGs and run IDs; full-chrome tests check the exact embedded bytes and native aspect ratio for both platforms.
- All 13 portrait and panorama hashes match retained provenance. Centre-strip tests compare every restored portrait at 128 px with mean absolute error below 2/255. Portal tests verify shared canvas alignment and enforce that the phone shows the restored portrait region.
- Visual inspection: app-overview and Colors layout variants, iOS feature banner and the explicit Artemis portal draft. Automated copy/frame bounds checks run for every applicable variant. Native screenshots and full product-claim accuracy are not newly certified.
- Missing: thread, stories, backup-words (after X1), four Artemis wallet captures, and reviewed UI masks for wallet-navy and wallet-in-eclipse. These are seven missing screenshots plus two missing masks in the current iOS concept inventory. Keep strict checks failing until they are supplied.
- The harness accepts only canonical screenshot names, so JSON uses `name: "wallet"`; the README maps occurrences to the requested `wallet-<themeName>` artwork keys. This is the explicit JSON-only workaround; distinct harness artifact names would need a separate schema change.
- Supplied panoramas: eleven 3840×1920, two 2048×1024 (`looking-back-at-earth`, `vavilov-crater`). Original bytes and provided provenance are preserved.
- DNS resolution prevented a live Nagg refresh. The supplied catalog/portraits were authenticated locally; `fetch-wallpapers.mjs` supports a deliberate future refresh. No fabricated image bytes or capture provenance.
- SYSTEM.md follow-ups left open: orchestrator capture/mask handoff, human layout/copy review, removal of the temporary `--allow-missing` asset allowance, and the existing asset license/provenance review. Linux CI and native device validation were not run here.

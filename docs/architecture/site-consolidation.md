# Site Consolidation

Reviewed 2026-09-14 against app baseline `fc597d4a23cf64be27e31e32a4480ba3d3c63c94`
and site baseline `ec884194767fc5cbea3a45960655223afe9021e4`.
This records the source migration and its limits, not approval to publish or delete
anything. No old-site edits, commits, pushes, store submissions or Railway changes
were made. The working tree is intentionally uncommitted.

## Audit Corrections

| Proposed assumption | Verified constraint and decision |
| --- | --- |
| Keep two ADPs and delete older ones | `release/freedom.mjs` preserves historical catalog entries. Every referenced URL, pending publication and rollback dependency must remain available. Keep publication append-only; do not implement deletion by age. |
| Orphan force-push is safe for a bot repo | `release/hosting.mjs` currently uses non-force writes and expected-blob checks. An unconditional rewrite can erase a concurrent channels/artifact update. Compaction needs quiesced writers, an expected-head lease, a retained inventory and explicit maintenance approval. Not a release step. |
| Delete the old repo once the site moves | The controller, token scope and immutable downloads still depend on it. A replacement artifact owner must serve every retained URL with identical bytes before retirement. Source consolidation alone cannot meet this condition. |
| One latest version can drive everything | `release/site.mjs` updates five channels independently. App Store, Play, GitHub, Zapstore and Freedom may have different live versions. `app/app.json` and editorial notes are not availability evidence. Nagg's app-update API is separate. |
| The legal reader need not change | `release/legal.mjs` used a hardcoded source path. It now reads `copy/legal`, with an ENOENT-only legacy path for already-pinned old source SHAs. The app's hash serialization and approved bytes are preserved. |
| Change legal now without touching the old site | The pre-EAS gate requires matching live text. Strengthening during source relocation could block current releases; prepare and publish reviewed text separately, coordinating any in-flight release. |
| A phrase is the only backup | Recovery also depends on mint records, URLs, derivation and token history; imported keys need separate backup. The app's existing backup overclaim was corrected instead of copying it into Terms. |
| A claims linter makes wording true by construction | It catches known phrases and drift, not false omissions, composed strings, binary image text, translations, provider behavior or legal enforceability. Explicit scope and external-evidence gaps are reported. |
| Exclude press after moving brand sources there | EAS postinstall/check still reads brand sources. Keep `app/assets/brand` intact and exclude only website/press resources from native archives. |
| Prebuild fingerprint proves a fresh capture | Prebuild produces native sources, not the installed APK/app. Capture acceptance needs a successful-build stamp bound to selected binary bytes as well as source/fixture evidence. No new freshness gate is pretended here. |
| A zero exit status authenticates a marketing run | Fake/deferred runs and repeated canonical page names exist. An importer needs scenario, page, occurrence, platform and successful native evidence; filenames alone are insufficient. |
| Proxy all `/releases/` traffic | Astro's release page shares that namespace. Exact `/releases` and `/releases/` locations precede the artifact proxy. Missing artifacts must not become SPA HTML. |
| Retire all eSIM pages as harmless dead code | Historical order routes may still matter. New source returns 410 without reflecting order IDs or loading analytics; historical-order support needs an operator decision before activation. |
| Store text can overwrite every Apple locale | Existing carry-forward preserves locale-specific metadata and edits. English catalog publication needs explicit locale ownership and source pinning; subtitle uses a different Apple API surface. Publishing is unchanged. |

## Implemented Ownership

| Owner | Contents and contract |
| --- | --- |
| `CLAIMS.md`, `copy/claims.json` | Scoped claims, evidence, prohibited phrases and exact contextual exceptions. |
| `copy/src/onboarding.ts` | Onboarding and backup introductory copy used by the app. No carousel, navigation, key or persistence change. |
| `copy/src/site.ts` | Dependency-free site copy. Not imported into wallet operations. |
| `copy/legal/documents.json` | Canonical, byte-preserved approved policies. App renders offline; site builds static pages and raw JSON. |
| `copy/store.json` | Length-tested English editorial candidate only; not live state or a publishing input. |
| `site/` | Standalone locked Astro site, no private schemas or native install. Runtime channel metadata, static legal pages, reviewed demo captures, explicit artifact proxy configuration. |
| `press/artwork/` | Existing artwork family moved intact internally. Capture identities, screenshot pins, source bytes and renderer ownership remain recognizable. |
| `app/assets/brand/` | Unchanged runtime and release brand source/output owner, required by EAS hooks. |
| `app/e2e/` | Unchanged harness/scenario ownership. Only a stale artwork path/order in scenario prose was corrected. |
| `release/` | Same publication destinations, version/source identities, signing, review gates and retention policy. Legal reader and source-compatible copy validation are integrated. |

The artwork move preserved image bytes. A subsequent claims correction regenerated
only the three `payments-instant` aspect PNGs. The generated
manifest records the new copy and renderer provenance; no screenshot was recaptured
or relabelled as current. Existing missing inputs remain explicit drafts.

## Activation Boundary

1. Build and test the site, including its Linux Docker image. Configure an HTTPS
   artifact origin that serves the current publisher's tree and does not loop back
   into the frontend. See `site/README.md`; no hostname or secret is embedded.
2. On a preview origin, verify `/terms`, `/privacy`, legal JSON, the release page,
   JSON MIME/cache behavior, every retained ADP inventory, legacy screenshots,
   version artwork and byte-range downloads. A green `/health` checks only the site.
3. Ensure artifact-repo commits remain deployed at that origin. Runtime channel
   fetching avoids needing a frontend rebuild when a store becomes available.
4. Coordinate any legal-content publication with active releases. The structural
   move alone does not change the current accepted terms or require a reprompt.
5. Switch domains only with verified artifact routing. Keep the old repo/service
   until a separately reviewed replacement fulfills the entire retained URL space.
6. Observe the next real release through the unchanged controller. Local tests do
   not establish credentials, provider behavior, approvals or installation success.

No unconditional force push, pruning executor or change to `websiteRepository`
was added. Serving through a proxy does not itself authorize removing upstream data.

## Remaining Plan Work

- Legal strengthening and Plausible disclosure, with actual provider configuration
  review. The new site deliberately omits analytics until that disclosure is ready;
  the old live site's disclosure gap is not repaired by an unshipped frontend.
- Locale-aware, source-pinned store publishing and read-only listing snapshots. No
  snapshots or console approvals were invented. English-only site redirects do not
  implement app translations; SYSTEM's selected localization approach still applies.
- Build-bound native freshness and automatic capture ingestion, including strict
  scenario/page/occurrence selection, native success, fixture provenance and pin
  protection. Both platforms need fresh capture runs and manual privacy review.
- Shared 3D mockup scene definitions and raster exports, complete missing captures
  and masks, and optional filename flattening. Current site images are explicitly
  labelled historical demo captures, not latest-version store screenshots.
- ASC screenshot replacement/pruning, only after reviewed pins and tested upload
  recovery. Existing carry-forward semantics are unchanged.
- Artifact-storage replacement and retention planning before old-repo deletion.
  Existing publisher readback gaps, same-version metadata identity checks and
  provider diagnostic redaction merit separate hardening; a source move does not
  fix those pre-existing concerns.

## Concerns Status

Follow-up claims/legal review: **2026-09-14**. This matrix separates work visible
in source from operating actions that source edits and local tests cannot complete.
Earlier verification records below are retained as historical integrated-run
results, not rerun or certified by this focused review.

| Original concern | Implemented / checked in source | Pending action and owner |
| --- | --- | --- |
| Honest ecash, custody and mint-trust claims | `CLAIMS.md` records protocol facts, allowed wording, prohibited inferences and review limits; primary Cashu/Nostr sources fetched. | Operator verifies issuer identities, affiliations, redemption terms and listing criteria. No reserve proof or mint-vetting guarantee established. |
| DM cash/bitcoin conflation and privacy | Artwork now pairs "Send cash in a message" with "Send digital cash in chat. You still rely on its issuer to redeem it." Register distinguishes encrypted transport from metadata, plaintext caches and key-compromise risks. | App/security owner addresses decrypted-cache protection; provider operations remain unverified. No messaging behavior changed here. |
| Remaining artwork copy | All 19 concept catalogs, including alternatives, reviewed; 16 changed to remove overclaims about wallet/model support, review authenticity, ranking, threads, cost and recovery. | **Frame agent:** regenerate affected PNGs, feature graphics and manifest; review visual fit and retained qualifiers. This follow-up did not run the renderer. |
| Conditional backups | Artwork names words, mint URLs, imported keys and limits; claim evidence distinguishes deterministic restore from full data recovery. | App/capture owner runs recovery and native layout checks. Word recall and source tests are not recovery drills. |
| Narrow claims enforcement | Actual old slogans are seeded into CLI regression tests, including unselected alternatives; qualified replacements remain allowed. No new broad exemption. | Human review still required for semantic omissions, composed/localized text, images and deployed copy. Passing lint is not a truth certificate. |
| Legal strengthening | `docs/legal/README.md` compares current clauses with specific gaps and provides owner-review paragraphs A-F, wallet benchmarks, ICO generator recommendation and CRA/ICO sources. | Owner supplies processing facts and approves separate publication. Phoenix policy pages returned 403; no clause-level review claimed. |
| Approved legal parity | `copy/legal/documents.json` left unchanged; original byte and acceptance-hash expectations retained. | Publication owner coordinates active release pins, live website text and the later bundled app update. Existing approval does not certify actual processing. |
| Analytics and third parties | Replacement-site source omits analytics; legal draft distinguishes that source from the live site and from host request processing. | Keep analytics withheld. Operator verifies live requests, default/fallback recipients, legal bases, agreements, retention, transfers and complaint handling; legacy-site gaps remain until corrected in deployment. |
| Store copy, locales and availability | Existing English catalog remains a candidate with length tests, not publisher input or a live snapshot. | Store owner obtains timestamped read-only listing evidence, reviews locales and coordinates source-pinned publication. No store/API mutation performed. |
| Old artifact repository and history | Existing architecture records immutable download/publisher/rollback dependencies; no old-repo edit or deletion made. | Release/hosting owner must inventory and preserve every retained URL and identical byte before retirement. Do not delete the repo or prune by age after frontend migration alone. |
| Native captures and screenshot provenance | Existing historical captures are not relabelled as current by this review. | No local native captures/builds: disk constraints remain. Capture owner needs build-bound evidence, platform runs, privacy/masking review and reviewed screenshot pins before publication. |
| Frames, site activation and release operation | Ownership stays with the other agents; this review changes no site code, root config or release destination. | Separate frame/site owners handle regeneration, Docker/preview checks, artifact routing and approved activation. No live cutover, upload, signing or publishing authorized by this matrix. |

Focused follow-up verification passed: claims lint reported no hard violations,
and `node --test copy/scripts/*.test.mjs release/tests/legal.test.mjs` passed
32 tests, including original legal bytes and acceptance revisions. Watch-word
matches and missing external snapshots remain explicit. No whole-app, native or
live operational verification is implied.

## Local Verification

On 2026-09-14 the integrated checkout passed:

- `bun run test`: 4,554 app, 1,265 wallet, 329 Nostr and 25 copy tests; 166 snapshots.
- `bun run type-check`: wallet, Nostr and both app platform passes.
- `node --test release/tests/*.test.mjs`: 45 tests, including consolidation
  contract coverage; Python archive suite: 5 tests.
- `bun run e2e:validate` and `bun run e2e:test` from `app/`: 656 harness tests.
- Site build and 43 site tests including actual local nginx requests; legal source
  bytes/rendered paragraphs and acceptance fingerprints match.
- Assets check and 24 asset tests, including corrected artwork provenance.
- Claims lint: no hard violations; review warnings and absent external snapshots
  remain visible. App lint: no errors, 153 warnings in existing code.

Root lock changes only register the `copy` workspace. No dependency versions changed.
Root Knip excludes the independently built site; its remaining unused-export
report is `QrJunkLayers` in unchanged `app/shared/ui/composed/QRCodeFrame.tsx:90`.
It is not waived or changed by this migration. Docker could not run because its daemon was unavailable.
No EAS archive/build, signed artifact download, live API mutation, actual native
capture, or production cutover was performed.

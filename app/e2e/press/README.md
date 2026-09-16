# Screenshot Content Contract

Two import-free JSON files can be consumed directly by Astro or other tooling:

- `press/artwork/source/screenshot-context.json`: versioned semantic source. `contexts` holds caption, alt, purpose, state, flow, concepts, and relatedPages. `collections` holds ordered screenshot-key lists with id, title, and description.
- `press/artwork/source/screenshots.json`: retained-image registry. Each entry's `context` references the semantic source; existing page, file, run, sha256, and wallpaperId values are preserved.

Resolve a gallery item without importing the e2e planner or native code:

```js
const key = 'ios/receive-qr';
const image = registry[key];
const metadata = content.contexts[image.context];
// metadata.caption: Share a standing receive code
// metadata.flow: { id: 'receive', position: 'share-request', from: [...], to: [...] }
const available = image.availability !== 'unavailable' && Boolean(image.run && image.sha256);
```

`file` is relative to `press/artwork/`, not a public URL. It is a target path,
not proof that the image exists. Only publish images with reviewed provenance;
also check file existence and hash when preparing public assets. Existing entries
with null run/hash remain unavailable. Semantic metadata never establishes native
freshness, payment settlement, or a safe mint.

`flow.id` groups a product journey; `position` names the screen's role. `from`
and `to` are canonical pages describing product navigation, not an assertion that
one screenshot run captured all those transitions. `relatedPages` also contains
canonical pages, not image keys. Use ordered `collections[].screenshots` for exact
curated image pairings. Wallpaper variants share `wallet-appearance` context and
retain their individual `wallpaperId`.

## P2PK Collection

Collection `p2pk-receive` pairs `ios/settings-keyring` with
`ios/receive-qr-p2pk`. Read each registration's current availability, run and hash;
historical capture requests are not a live status report. Consumers must show
unavailable slots rather than substitute a different receive state.

The keyring candidate maps to `settings.keyring.generate`, canonical
`settings-keyring`, occurrence 2, after `YOUR KEYS (3)`. The full library instead
uses the read-only keyring entry recipe and never generates keys for capture.
The locked request maps to
`receive.qr-display.tabs`, canonical `receive-qr`, occurrence 6, after
`receive-creq-p2pk-state:1`. It asks the payer for P2PK-locked ecash; displaying
the request proves neither delivery nor redemption. These are separate scenarios,
not evidence that the displayed key and request belong to the same wallet.

The receive-tabs scenario depends on live mint discovery and reusable-offer
support later in its run. The importer requires the **entire** run to pass before
exporting any candidate, even though the P2PK screenshot happens earlier.

## Candidate Intake

`plan.ts` resolves semantic context for each mapped capture. `import.ts` copies
its `context` and `metadata` into each candidate screenshot, with `contextVersion`
on the manifest. The manifest's file/source/sha256, dimensions, scenario, page,
occurrence, stepId, runId, sourceFingerprint, timestamps, and evidence hashes
remain independent provenance. All named test and verify captures are validated;
only mapped images are exported. Setup/cleanup captures are rejected.

Importer output stays `unreviewed-candidate` and never edits the retained registry.
`bun run screenshots:refresh` first requires full-library verification on the fixed
native profile, then updates matching curated selections; see
[press/README.md](../../../press/README.md). It does not execute every legacy press
recipe: effectful key generation and the live P2PK tour are excluded.
Do not copy runtime payloads into the semantic source. Recovery-word captures use
the display-only public practice vector in a disposable simulator wallet.

## Focused Recapture

Capture one exact scenario from the existing press allowlist without running every
journey. The complete allowlist is still validated before selection; no arbitrary
scenario, funding, build, or publication flag is forwarded.

```sh
bun app/e2e/press/run.ts ios --scenario marketing.screenshots --plan
bun app/e2e/press/run.ts ios --scenario marketing.screenshots
```

Intake reconstructs a focused selection only when the native manifest records the
exact `filters.scenario`. Every selected scenario, capture, cleanup and final-state
check must pass. An interrupted multi-scenario run cannot be imported as a completed
single scenario. Do not edit raw manifests/events to bypass rejection.

The [September 15 refresh attempt](REFRESH-2026-09-15.md) is historical evidence,
not current capture status. Use the registry and full-library status command for
current provenance. Every newly promoted capture records native build and app
source identity.

## Offline Checks

Run from the repository root:

```sh
bun test app/e2e/press/press.test.ts
bun app/e2e/cli.ts validate
bun app/e2e/press/run.ts both --plan
```

These commands do not run native sessions or build the app. Synthetic importer
tests verify provenance and semantic inheritance, not device rendering or native
freshness. No runtime screenshot schema changes are required for this contract.

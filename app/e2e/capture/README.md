# Full Native Capture Library

`plan.ts` and `import.ts` are device-free planning/intake modules. `refresh.ts`
owns native execution, resumable campaign reports and downstream generation.
See [the workbench guide](../../../press/README.md) for commands and retention.

## API

```ts
createCapturePlan(platforms?: Platform[], root?: string): CapturePlan

importCaptureRun(
  runDir: string,
  options: {
    attestation: CaptureAttestation;
    plan?: CapturePlan;
    libraryDir?: string;
  }
): Promise<{
  manifest: string;
  imported: CaptureRecord[];
  skippedOlder: number;
}>
```

`Platform` is `ios | android`. The default plan includes both platforms. Every
canonical page has exactly one baseline slot per selected platform, even when no
scenario can capture it. `targets` includes those slots and explicit variants;
`blocked` contains actionable authoring/privacy/capability reasons. `occurrences`
inventories all authored screenshot occurrences, including unselected scenarios,
using the real loader and fixture expansion. Occurrences are counted across all
phases, never confused with artifact sequence numbers.

`invocations` contains `{ platform, suite, scenario, scenarios, recipeSha256 }`.
Every invocation selects exactly one effect-reviewed scenario. Do not replace it
with a modified version without reviewing the changed effects: `REVIEWED_STEPS`
pins the expanded setup/test/verify/cleanup steps and blocks changed recipes until
their pin is deliberately updated. Native execution remains unverified by the pin.
Do not replace a focused invocation
with a suite-only run. The full suite contains funded and publishing scenarios;
`lane: simulator` does not authorize those effects. Local setting changes and
disposable-profile initialization are permitted recipe effects. Network reads in
mint reviews, search and metadata can still fail; mock evidence is not an offline
network guarantee.

Each target records page/state/occurrence, its scenario and step, platform profile,
readiness assertions, privacy eligibility and evidence class. `planned` means
authored and statically checked, NOT captured or native-tested. `native-fixture`
means the actual native app selected an existing presentation fixture. It never
means a reconstructed image or verified payment. Imported records always retain
`functionalResult: not-established`, even when their capture scenario passed.

## Refresh Integration

1. Build the plan. Retain all baseline slots when filtering the invocations for
   retries; do not filter the inventory denominator.
2. Use the existing builder to resolve the exact native artifact. For each
   invocation, run the normal CLI with its suite AND scenario, the native driver,
   `--evidence screenshots --no-record`, and separately authorized destructive
   reset. Set `E2E_CAPTURE_PROFILE=library-v1`; optionally set the driver's
   `E2E_CAPTURE_CAMPAIGN_ID`. Planning is not execution approval.
3. Record `CaptureAttestation` around that exact invocation: the raw-run
   `sourceFingerprint`; `appSourceBefore` and `appSourceAfter` from the existing
   app-source helper; the builder's `nativeBuild` summary; and independently
   computed `nativeFingerprintBefore` and `nativeFingerprintAfter`. Do not invent
   old-run stamps from today's HEAD. Do not pass native paths, logs or keys.
4. After a successful process exit, call `importCaptureRun` with the explicit run
   directory and those stamps. It checks the complete ordered step trace, successful
   cleanup/final-state, page guards, named image attribution, native session/profile,
   exact dimensions and nonblank PNG content. It requires the new driver's
   `session-1.json` capture profile. Interrupted, failed, fake, funded, unstamped,
   wrong-platform and incomplete runs cannot enter the library.
5. Consume `press/screenshots/manifest.json` for the full library. Images are
   `press/screenshots/{platform}/{page}[--state].png`. Originals remain immutable;
   the manifest hashes original PNG, manifest, events and session bytes separately
   from the decoded, metadata-stripped library PNG. The press curator remains a
   separate selection and publication decision.

The importer validates all selected inputs before staging files. A lock serializes
updates, the manifest is replaced last, and older captures cannot replace newer
ones. Consumers must check each file's recorded SHA-256: interrupted filesystem
promotion can leave a newer file beside an older manifest, which must not be used
until a verified reimport repairs it. A stale `.import-lock` after process death
requires operator inspection before removal. No raw AX, state, DB, logs, absolute
source paths or arbitrary previous-manifest fields are copied into the library.

## Privacy And Gaps

Fresh disposable-profile defaults are valid native navigation evidence. The
account-entry, composer, signer-lists, receive-rails, followers, White Noise entry
and storage recipes capture the actual untouched forms or resolved empty lists.
They do not fabricate entities. Keyring captures its loaded public-key list,
never the import/generation workflow; public profile QR is not signer pairing QR.
Receive rails and keyring withhold readiness after failed reads. Followers must
resolve to an empty result for the active disposable identity. White Noise must
read zero local key packages without bootstrapping. Storage captures names/counts
in the initial viewport without invoking any dump, clipboard or log controls.

Only the reviewed public practice-word backup journey is selected. Live seed
reveal, key generation, signer pairing QR, restoration, live private chats and
unsupported onchain/payment-request fixtures remain blocked. Full-frame masking
does not count as a captured page. Native masks must fail closed before extending
this allowlist to any secret-bearing journey.

The new cohorts are source-backed candidates, not device-validated legs. Existing
demo history rows are opened through the real history list; no history objects,
route payloads or application stores are fabricated. Missing readiness fails the
scenario rather than counting a loading/error/blank route as its intended page.

Tests use synthetic non-app PNG bytes in temporary directories only. Native
verification results live in the campaign report, not in test fixtures.

```sh
bun test app/e2e/capture app/e2e/viewer/lib/pages.test.ts
bun app/e2e/cli.ts validate
bun app/e2e/audit/page-testability.ts
```

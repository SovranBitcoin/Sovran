# Production releases

**Implemented but not executed or enabled.** This pipeline requires the operator's
account checks and validation below before activation. Static review cannot prove
store credentials, historical signing continuity, hosting limits or live APIs work.

## Day-to-day operation

After setup, change `app/app.json` → `expo.version`, run `bun run assets:generate`,
review the brand gallery, and commit the generated artwork with the version bump
before merging to protected `main`.
The **Production release** GitHub Action starts the release. **Run workflow →
release** starts/resumes the same process; **plan** only reads and describes state.
An hourly workflow resumes builds, review and deployment waits without keeping a
runner alive for days. `RELEASE_ENABLED` must be the literal repository variable
`true`; missing/false disables every publishing job. Keep it false until validation.

Only one release is active at a time. A newer version waits until the active one
finishes. `release-state/active.json` is a nonsecret checkpoint on a separate Git
branch, not a file on main. Completed states go into `history/`. CAS writes and a
workflow-wide concurrency group prevent overlapping publication. Run summaries
show each channel's confirmed version; failed jobs expose bounded diagnostics.

The controller uses the workflow's reviewed commit, while builds use the immutable
app source SHA saved in state. A controller fix on main therefore applies on the
next resume without silently rebuilding a release from different product code.

Pipeline stages are ordered to serialize checkpoints, but a pending or failed
Apple/Freedom stage does not prevent the Android lane from being reconciled:

1. Frozen dependency install, release tests, credential-path checks and app gates.
2. EAS queues exact-source iOS and Android builds; iOS goes to EAS Submit.
3. Apple version/build matching, carry-over metadata/screenshots, review and release.
4. Play AAB upload, production review, generated signed APK retrieval/verification.
5. GitHub draft assets/checksums verified, then release published.
6. Approved Apple ADP and screenshot bytes published to the website; full-byte
   deployment gate; one Freedom PR, then observation of its live catalog entry.
7. Zapstore signer preview, signature/identity checks, publication and independent
   canonical relay/APK readback using the same GitHub APK bytes.
8. Website availability changes only for confirmed channels. Pending channels keep
   their prior version. Editorial release notes are not automatically overwritten.

## What the local JKS files mean

`app/credentials/android/keystore.jks` and the backup `.jks` are potential Android
private signing keystores. `app/credentials.json` is the EAS local-credentials
descriptor convention; it can contain passwords and key aliases. Their contents
were not inspected. All three paths are ignored by Git. Current production EAS
profiles explicitly use **remote** credentials, so those local files are not the
pipeline's credential source. Keep backups secure; do not delete or upload them to
GitHub just because this pipeline does not use them.

An upload key and the Play app-signing key can be different. The pipeline uploads
one EAS-signed AAB and downloads Play's generated **universal APK**, selected by
the expected app-signing certificate. GitHub and Zapstore publish those exact APK
bytes. It never creates a keystore, changes package ID, resets a signing key, or
re-signs an APK. The removed separate EAS APK profile could not establish this
cross-store compatibility.

Before activation, compare public SHA-256 signing-certificate fingerprints from
Play Console → App integrity, EAS, and all historically distributed APKs. Record
key rotations and the supported Android versions. If historical channels differ,
resolve the migration first. A matching fingerprint is not proof that every OS
version's signing lineage and installer policy allow unattended cross-store updates.

## GitHub secrets

Create environment **production-release**, restrict it to `main`, and put the
publishing secrets there. No secrets go into repository files or action inputs.
Repository-level secrets work too, but environment scoping is preferable.

| Secret | Value / purpose | Rotation behavior |
| --- | --- | --- |
| `EXPO_TOKEN` | Existing Expo token authorized for this EAS project | Reuse if valid; rotate on compromise/revocation/policy |
| `ASC_PRIVATE_KEY` | Apple App Store Connect API `.p8` contents | Long-lived until revoked; JWTs are generated per request |
| `RELEASE_APP_PRIVATE_KEY` | Private key of a dedicated GitHub App installed only on `SovranBitcoin/sovran.money`, Contents read/write | Installation tokens are minted/revoked automatically per job |
| `FREEDOM_TOKEN` | Dedicated bot's token with access to its public Freedom fork and upstream PR creation; classic PAT `public_repo` is the practical fallback where fine-grained contribution permissions do not work | Prefer account policy's longest appropriate lifetime; not a blanket personal admin token |
| `ZAPSTORE_SIGN_WITH` | Dedicated release identity's `nsec1…`, or authorized `bunker://…` connection URL | Nostr identity does not expire; never use a wallet/user key |
| `ZAPSTORE_BUNKER_CLIENT_KEY` | Only for bunker mode: stable, already authorized client private key, 64 lowercase hex characters | Restored mode 0600 in temporary HOME; avoids reauthorizing a one-use bunker connection each run |

Keep existing `SOVRAN_CI_TOKEN` as a **repository** secret for frozen private package
installation (or grant the repository's `GITHUB_TOKEN` read access to those
packages). The validation job cannot read environment secrets. EAS's remote build
environment also needs its existing GitHub Packages read credential; a GitHub job's
token is not automatically available on EAS workers.

There is **no Google service-account JSON key secret and no JKS secret** in this
design. Google uses workload identity federation and short-lived access tokens.
This does not make every provider key maintenance-free. Account policy, revocation,
Apple signing certificate/profile renewal, agreements and store review can still
require attention.

## GitHub repository variables

Keep these at repository scope because prepare/job conditions run before an
environment is entered. IDs and public fingerprints are configuration, not secrets.

| Variable | Required value |
| --- | --- |
| `RELEASE_ENABLED` | `false` until all operator checks pass; then `true` |
| `ANDROID_CERT_SHA256` | Play **app signing** certificate SHA-256, hex with or without colons |
| `ASC_KEY_ID` | ID of the corresponding Apple API key |
| `ASC_ISSUER_ID` | Team API key issuer UUID; leave unset for an individual API key |
| `RELEASE_APP_ID` | Dedicated website GitHub App ID |
| `GOOGLE_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>` |
| `GOOGLE_SERVICE_ACCOUNT` | Play-authorized service-account email to impersonate |
| `FREEDOM_FORK` | Dedicated bot's `<owner>/freedomstore` public fork; create it once |
| `ZAPSTORE_NPUB` | Expected public Nostr publishing identity |
| `ARTIFACT_DOWNLOAD_HOSTS` | Comma-separated **exact** EAS/AltStore artifact hosts and redirect hosts verified from your provider outputs; no URLs, paths or wildcards |

Allowlisting exact artifact hosts deliberately blocks unknown redirect destinations.
Hosts can change upstream; diagnose a blocked download and update the allowlist
without weakening authenticated API redirect restrictions. Do not copy signed URL
query strings into this variable or any report. GitHub, Apple image and Zapstore
public hosts are explicitly constrained in their adapters.

`release/config.json` owns public IDs, the bootstrap version excluded from automatic publication,
fixed upstream endpoints and pinned CLI versions/checksums. The EAS and Android
tool versions also appear in workflow install steps; update both together. The
human product-version source remains `app/app.json`.

## Where to find the Google values

These are **repository variables**, configured at
[GitHub Actions variables](https://github.com/SovranBitcoin/Sovran/settings/variables/actions).
The workflow reads `vars.*`; putting these only in repository secrets does not
satisfy it. `ANDROID_CERT_SHA256` is needed by the prepare job before the
production environment is entered.

- `ANDROID_CERT_SHA256`: open [Play Console](https://play.google.com/console/),
  select Sovran (`com.sovranbitcoin`), then **Protected with Play → Play Store
  distribution → Go to Play app signing**. Under **App signing key**, copy the
  **SHA-256 certificate fingerprint**. Some console layouts expose this through
  **App integrity → App signing** or **Play Store protection → Manage Play app
  signing**. Use the app-signing certificate, not the upload certificate or SHA-1.
  Colons are accepted. The current verifier expects one certificate matching the
  downloadable universal APK; multiple/rotated certificates must be reconciled
  against that APK rather than guessed. [Google's signing guide](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en-GB).
- `GOOGLE_SERVICE_ACCOUNT`: Google Cloud Console → IAM & Admin → Service Accounts
  → copy the publishing account's email (`name@project.iam.gserviceaccount.com`).
  Also grant that email the app-specific publishing permissions under Play Console
  → **Users and permissions**. Creating it in Cloud alone does not grant access
  to the Play application. [Google API setup](https://developers.google.com/android-publisher/getting_started).
- `GOOGLE_WORKLOAD_IDENTITY_PROVIDER`: Google Cloud Console → IAM & Admin →
  Workload Identity Federation → open the GitHub pool/provider. Copy its full
  resource name, including the numeric project number, pool and provider:
  `projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`.
  This value comes from Cloud, not Play Console. [Federation setup](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).

Do not manually create `GOOGLE_ACCESS_TOKEN`: the `google-github-actions/auth`
step generates it for each run. This pipeline uses federation and does not need
a downloaded service-account JSON private key.

Repository/environment inspection on 2026-09-11 found all required secret **names**
and Google identity variables present. `ANDROID_CERT_SHA256` is set identically in
both scopes. `ARTIFACT_DOWNLOAD_HOSTS` contains `expo.dev,api.expo.dev,wf-artifacts.eascdn.net`
in both scopes, verified from two finished EAS Android builds and their redirect
chains. The AltStore download host is still unverified. `RELEASE_ENABLED` remains
`false` in both. The production environment permits only `main`, but the repository's
`Protect` ruleset is disabled and `main` has no branch protection. Secret values,
Google IAM grants, Apple permissions and signing continuity have not been validated.
Recheck these mutable settings before activation.

### First merge and next release

`baselineVersion` is `0.1.1`, the version of the pipeline/bootstrap merge. Keep this
baseline fixed after merging. Enabling the workflow while main is still `0.1.1`
does not publish it. The next reviewed version bump (for example `0.1.2`) starts a
release; a schedule resumes pending work against its original source SHA. Keep
root `package.json`, `app/package.json` and `app/app.json` versions aligned and run
`bun run assets:generate` before committing. No action silently commits regenerated
artwork back to the app repository.

Once any channel confirms the new version, the website stage publishes all four
version-lockup colorways, SVG plus PNG sizes 16 through 2048, at
`https://sovran.money/releases/<version>/artwork/<colorway>/<width>x<height>.png`.
The sibling `artwork.svg` and `artwork/manifest.json` record reusable vectors and
hash/source provenance. These are exact bytes from the release SHA. Previous
artwork is immutable, retries reuse matching files, and all 37 deployed files
are checked before release completion. Existing website editorial graphics are
not automatically replaced.

### Remaining activation evidence

- Enable reviewed main-branch protection/required checks. Merge the pipeline with
  publication disabled, and require a green Linux PR run using the frozen lockfile.
  Local macOS validation does not establish Linux raster byte reproducibility or
  EAS archive correctness.
- Add exact AltStore artifact download/redirect hostnames after inspecting a
  current approved ADP response. EAS hosts are configured; recheck them when the
  provider changes its artifact delivery. Never paste signed URLs or wildcard
  domains. Prepare fails before creating a new release state when the allowlist
  is missing, and every artifact redirect is checked against it.
- Exercise Google OIDC/service-account and Apple API access from GitHub Actions;
  secret-name presence is not proof of authorization. Confirm the website GitHub
  App installation can write the site repository and the Freedom token can create
  a PR from the configured fork.
- Finish the draft Google Play app setup and verify the first production bundle
  and upload certificate. The controller submits `completed` production releases;
  it does not bootstrap a draft listing, fill compliance forms or enroll signing.
- Reconcile the **quantum-ready** Play signing configuration with a real downloaded
  universal APK before activation. The saved fingerprint has not been matched to an APK; the screenshot shows
  a newer classical key, an older key and a PQC key. The current pinned
  verifier/parser supports the single-certificate path only. Do not broaden its
  allowlist or claim cross-store update support until APK verification and updates
  in both directions have been tested on older and current Android versions.
  Google documents multiple keys for quantum-ready upgrades, and newer apksigner
  output includes scheme-specific signers. See [Play signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)
  and [apksigner output change](https://android.googlesource.com/platform/tools/apksig/+/d177d78e4649d08499d90e6cbf9ca47d77c9b865).
- Verify AltStore marketplace authorization/notifications and retrieve a current
  approved ADP. The public GET returned 404 for the ADP referenced by Freedom's
  current Sovran entry; that does not establish whether future ADPs will work.
  The [documented GET and POST endpoints](https://faq.altstore.io/developers/rest-api)
  and exact-byte hosting contract are used. Freedom still needs a maintainer to
  merge the generated catalog PR before that channel becomes live.

The site release contract is already public at `/releases/channels.json`, and the
configured Freedom fork exists with the correct upstream. The pinned zsp Linux
binary's GitHub digest matches `config.json`; its flags, event kinds and signer
storage paths were checked against [v0.4.17 source](https://github.com/zapstore/zsp/tree/v0.4.17).
Google production status uses its current [release summaries API](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list),
with a separate full-rollout check before advertising availability. None of these
read-only checks publish or prove a live release.

## Local audit result (2026-09-11)

The working-tree audit corrected the bootstrap baseline, frozen dependency
installation, required asset tooling, version-artwork publication to the site,
and independent iOS/Android build reconciliation. A missing iOS submission
acknowledgement now remains visible without re-submitting or blocking Android.
The app review also fixed a moderation read race that could replace a newer relay
mute list and added candidate settings gesture coverage.

Passed locally on macOS:

- Workspace tests: 3,752 app Jest tests, 1,209 wallet and 275 Nostr Vitest tests.
- Release controller/archive tests: 32 Node tests and 5 Python tests.
- Native harness: 656 tests; 129 authored scenarios / 221 supported platform
  pairs validate. The new Moderation and legal-settings journeys pass dry runs
  and fake-driver orchestration only.
- Type checks for both app platforms and workspace packages; ESLint, Prettier,
  Knip, compiler coverage, styling and glass-header guards.
- Brand/asset regeneration checks and five geometry/raster tests; workflow
  syntax checks; Expo JS exports; website release tests and production build.

No native release build, marketplace write, deployment, merge or push was
performed. All required secret names are present, but provider permissions,
Linux reproducibility, actual Android signing/update continuity and native
execution of changed screens still need the evidence listed above. Keep
publication disabled for the bootstrap merge and do not treat these local
results as proof that all channels can publish unattended.

## One-time provider setup

**GitHub:** Protect `main` and workflow/controller files through review. Restrict
the production environment to main. Do not add pull_request/pull_request_target
publication triggers. Allow `GITHUB_TOKEN` to update the separate state branch and
create releases. Configure immutable GitHub releases if desired; assets are all
verified before a draft is published. Keep publishing concurrency enabled and do
not run another manual publisher against an active release.

**Google:** Enable Android Publisher API. Create a service account with the needed
app-specific Play Console permissions (release production, read app information).
Configure GitHub OIDC federation and service-account impersonation. Restrict the
provider condition to numeric repository/owner IDs, `refs/heads/main`, the expected
production environment subject and release workflow identity; never trust only a
reusable repository name or every PR in the organization. Grant only the required
workload identity impersonation permission to that principal. Do not grant Owner.
Complete the app's initial listing, policy/data-safety declarations and production
access requirements. **Disable managed publishing** if approval should release
automatically; API states requiring console action are reported, never called live.

**Apple/EAS:** Confirm EAS project/team/bundle IDs match `release/config.json` and
noninteractive remote signing/submission is already configured. EAS Submit's Apple
key is managed separately in EAS; this controller's key is for ASC API operations.
Prefer an individual app-scoped publishing key if your account supports the needed
operations; team keys apply across apps. Existing ASC contact, review, screenshot,
privacy and legal metadata form the initial source. The controller carries forward
existing metadata and images and uses generic release notes when no new notes are
prepared. It preserves human-prepared screenshot sets. Update store declarations
when the product actually changes them; do not assume legal statements can be
inferred from commits.

**AltStore:** Preserve existing developer/marketplace registration, Apple linkage,
and notifications. The pipeline requests the exact approved version's ADP when
absent and can request AltStore processing once. Expired package download URLs
require provider-supported refresh; their public API does not document a reliable
automatic renewal contract, so the pipeline reports this rather than inventing one.

**Freedom:** Configure a dedicated fork and token capable of creating upstream
PRs. The tool inspects existing open source-file PRs for Sovran changes, looks up
all states for its deterministic head, and recognizes already-published manual
releases. It never auto-merges, reopens a rejected PR, replaces historical URLs or
posts repeated comments. A maintainer still decides whether/when to merge.

**Zapstore:** Register/authorize the release identity according to the official
publisher instructions. Ensure repository identity verification recognizes that
npub. For bunker mode, authorize the stable client once and permit intended release
and Blossom signing without per-event prompts. A dedicated release-only nsec is
operationally simpler but exposes that publishing identity to its isolated job.
APK certificate-linking is skipped: Google's private app-signing key may be
unexportable, and the upload key cannot create that ownership proof. Nostr events
and APK signatures/hashes are still verified independently.
Existing Zapstore listing text and images are preserved. A first listing gets
basic app metadata; iOS screenshots are not relabeled as Android screenshots.

## Website setup and limits

Merge/deploy the corresponding `sovran.money` changes first. Its
`public/releases/channels.json` is the public availability contract; its download
page refreshes this same-origin JSON after hydration and validates allowed store
destinations. Historical App Store version is deliberately unknown until an ASC
observation; the existing link remains usable. Freedom starts from the verified
0.1.0/build169 listing. Android links remain disabled until verified publication.

`src/releaseMedia.json` selects approved ASC screenshots for the site. ADPs remain
under `public/ios/releases/<adp-id>/`, with original hierarchy/bytes. Media is stored
by content hash. Publication uses an atomic Git tree commit on website main,
preserves unrelated files and refuses conflicting immutable bytes. GitHub App
permissions must allow that operation under website branch rules; pushes must
trigger the existing hosting deployment. No hosting provider was configured here.

Each ADP file must currently be **under 99 MB**, with a 2 GB extracted package
limit. Larger Apple variants require object storage/CDN instead of Git hosting;
the pipeline stops rather than uploading a broken package. Actual future package
sizes remain unverified; the largest existing local website IPA observed during
implementation was 48,851,120 bytes. Every original ADP file is downloaded from the public
site and hash-compared before a PR opens. A SPA HTML/200 fallback cannot pass.

The website's old global TLS-verification bypass was removed. If its build reveals
a certificate-chain issue, repair that trust chain instead of restoring the bypass.

## Reproducing checks and completing live validation

Start with local checks, which do not publish. Run the input checker from a clean,
reviewed commit: it deliberately rejects uncommitted release-input changes.

```sh
# From sovran-app, using its installed/frozen dependencies
bun run test:release
node release/check-inputs.mjs
bun run type-check
bun run test
bun run lint
bunx --no-install knip
git diff --check

# From sovran.money
bun run test:release
bunx tsc --noEmit -p tsconfig.app.json
bun run lint
bun run build
```

Also validate GitHub workflow syntax with actionlint, preview the website on mobile
and desktop, and inspect the actual EAS archive before authorizing a native build.
The input checker verifies ignore rules and tracked credential-shaped files; it is
not a Git-history secret scan and does not prove the contents of an EAS archive.

Run the GitHub workflow in **plan** mode with activation still false. Then validate
account access, signing certificates/rotation, the existence of a usable generated
universal APK and hosting size limits with operator-controlled actions. Before
enabling unattended publication, test real cross-store upgrades with disposable
wallet data, including persisted settings and wallet state. Those live tests and
production builds were not performed in this audit.

## Failure and recovery rules

Safe reads and pending states are retried hourly. Ambiguous non-idempotent operations
use persisted intent plus provider lookup; absent acknowledgement never causes an
automatic second build. A failed/ambiguous build, invalidated Play edit after an
uncertain commit, rejected review/PR, mismatched certificate/artifact or changed
immutable file requires investigation. Do not delete state to make a red job green.
Inspect provider objects by the recorded IDs, preserve source/build identity, and
make a reviewed controller/state correction. Controller fixes can ship while the
release remains active. State is nonsecret, but still integrity-sensitive.
Each resume repeats the validation gates and uses separate stage jobs; account for
that Actions usage while reviews are pending. The schedule can be reduced without
changing the saved release, at the cost of slower availability updates.

Secrets are scoped to individual stage processes. Subprocess output and provider
error bodies are suppressed because they may include signed URLs or keys. Tests
use fake canaries, local fixtures and mocked providers. No raw API responses,
credential files or working directories are uploaded as workflow artifacts.

## Evidence informing the implementation

- [Expo CI](https://docs.expo.dev/build/building-on-ci/) and [remote versioning](https://docs.expo.dev/build-reference/app-versions/).
- [Google signed APK distribution](https://developers.google.com/android-publisher/download-apks?hl=en), [generated APK schema](https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks/list), [release lifecycle states](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases).
- [Google workload identity federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines?hl=en).
- [Apple review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions), [asset uploads](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect).
- [AltStore distribution](https://faq.altstore.io/developers/distribute-with-altstore-pal), [AltStore API](https://faq.altstore.io/developers/rest-api).
- Freedom feedback: [#8 package bytes and URLs](https://github.com/freedomstore/freedomstore/pull/8), [#12 preserve historical versions](https://github.com/freedomstore/freedomstore/pull/12), [#20 mismatched build number](https://github.com/freedomstore/freedomstore/pull/20), [#21 reused ADP](https://github.com/freedomstore/freedomstore/pull/21), [#25 broken hosting](https://github.com/freedomstore/freedomstore/pull/25).
- [Pinned Zapstore publisher](https://github.com/zapstore/zsp/tree/v0.4.17), [Zapstore trust model](https://zapstore.dev/docs/trust-model).

## Version artwork

Brand/version artwork is generated from the exact checkout's
`app/app.json` → `expo.version`. After bumping it, run `bun run assets:generate`,
review `app/assets/brand/index.html`, and commit the generated files with the
version change. The root install hook rebuilds artwork before native prebuild;
CI and the build controller reject stale output or a checkout dirtied by
regeneration. The EAS post-install hook verifies it again. No remote publication
is part of asset generation. See [the brand guide](../app/assets/brand/README.md).

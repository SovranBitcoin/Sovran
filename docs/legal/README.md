# Sovran legal documents

Status: **ready for publication**, reviewed 10 September 2026. The canonical `publicationReady` flag is true. This records document publication readiness, not legal certification, app-store approval, or completion of an infrastructure audit.

## One source of truth

Edit `app/shared/lib/legal/documents.json` in sovran-app. The app renders that bundled text offline. Run `bun run legal:sync` from sovran-app to generate `../sovran.money/public/legal/documents.json`, then `bun run legal:check` to verify parity. Never edit the generated website copy by hand.

The website serves `/terms` and `/privacy`, including readable HTML without JavaScript or login. Its JSON is public at `/legal/documents.json`. Nginx must resolve the prerendered `$uri/index.html` before falling back to the root SPA. The build checks legal fingerprints and fails if legal rendering fails. Publishing legal pages adds no app-release trigger.

The app release controller checks that approved bundled documents match the deployed website before starting EAS. Publish the website text before releasing an app update containing it. Development preview may use `publicationReady: false`; publication requires true and complete operator fields. The flag is not a compliance certificate.

## Review and confirmed facts

- The operator confirmed SOVRAN LTD, registered in England and Wales under company number 15895560, with registered office at 3rd Floor, 86–90 Paul Street, London, EC2A 4NE, United Kingdom, and monitored privacy email kelbie@sovran.money.
- The operator confirmed Railway Hobby hosting and no automatic production-log exports outside Railway. Railway documents seven days of accessible log history on Hobby, but says upgrades restore older logs. The policy therefore does not promise permanent erasure after seven days.
- Read-only Railway project metadata showed active website and `api.sovran.money` deployments in `europe-west4-drams3a` (Amsterdam). The mint had that region in latest-deployment metadata, but no active-deployment region was supplied. This does not establish Nagg services in other projects or backup/log storage locations.
- Railway's published DPA describes US processing and transfer safeguards, including SCCs and the UK Addendum where applicable. The policy does not imply Amsterdam deployment means EU-only processing.
- Nagg source records viewer public keys and last-seen activity to preserve relevant content. Its `known_viewers` schema configures 365-day expiry after last sighting. Database diagnostic tables separately configure three- or seven-day expiry. These settings were not presented as verified production deletion deadlines.
- Independent factual review approved publication after adding company-registration information, accurate mint-backing and redemption-deadline risks, clearer international-transfer information, a separate right-to-object paragraph and the ICO complaint route.

Retention for other operator-controlled records is described by purpose-based criteria, not invented fixed periods. These criteria guide operation; source inspection cannot certify actual retention, provider deletion, or every backup. Removing Sovran from new wallet defaults does not remove obligations for Sovran-operated services or ecash already issued.

## Agreement and recovery behavior

Each document's full content, operator details and publication flag are fingerprinted with SHA-256. Explicit confirmation stores both revisions and a timestamp in `settings-store.legalAcceptance`. Website changes alone cannot reprompt an older/offline app: deliver the changed documents in an installed app update.

The app uses Terms then Privacy in the original card layout. The checkbox and continue button remain outside the scroll area. Scrolling to the end is not required; each step still requires explicit confirmation. Back navigation is allowed; partial progress does not record acceptance. Settings renders the same documents. Privacy acknowledgment is not consent to every optional processing activity.

Legacy settings survive; the original `termsAccepted.date` remains the notification-history boundary. Malformed legal acceptance resets only that field. Unreadable stored JSON is preserved and exposes Retry and recovery access rather than overwriting it with defaults. The wider generic merge behavior for structurally invalid top-level blobs remains a separate limitation.

Recovery reuses Settings Profile Details with masked Show/Hide/Copy controls. Its read-only loader accesses existing verified keys, including imported profiles, without creating keys, fetching remote profiles or switching the active wallet. Backgrounding clears loaded values and invalidates pending reads. This is existing-key recovery, not full proof export or funds withdrawal; seed recovery cannot guarantee every ecash balance.

## Separate release and operational work

Publishing truthful legal documents is distinct from these ongoing responsibilities:

- Keep mint-specific redemption terms and service purchase/refund disclosures accurate. App terms do not cancel issuer or consumer rights.
- Apply retention criteria, handle privacy/deletion requests, maintain appropriate provider agreements and respond to abuse on operated services. Do not promise deletion across independent relays, recipients or blockchains.
- Correct Google Play Data safety: a blanket “No data collected or shared” is not supported by the app's network behavior. Check relevant exemptions and feature-specific disclosures against the production build.
- Complete store moderation/content declarations and native testing before app release. Unit tests do not prove device background masking, large-text layout or screen-reader behavior.
- Obtain qualified legal advice where the company's circumstances or regulated activities require it. This source-backed review does not guarantee enforceability.

These items are not represented as completed by removing the draft label. A full operational audit, a lawyer's certification and store submission were not prerequisites imposed by the user for publishing the pages.

## Sources

- [Company record](https://find-and-update.company-information.service.gov.uk/company/15895560) and [company website disclosures](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material).
- [ICO privacy-information guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/): identity, legal bases, recipients, retention periods or criteria, transfers and rights.
- [Railway logs](https://docs.railway.com/observability/logs#log-retention), [regions](https://docs.railway.com/deployments/regions) and [DPA](https://railway.com/legal/dpa).
- [Minibits Terms](https://minibits.cash/terms), [Privacy](https://minibits.cash/privacy), and [Cashu.me terms implementation](https://github.com/cashubtc/cashu.me/blob/main/src/pages/welcome/WelcomeSlide4.vue). Sovran's text is original and does not copy blanket no-data claims or broad liability waivers. No standalone policy was found in the inspected `cashubtc/wallet` tree.
- [Google Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311) and [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

## Verification

Focused tests cover document hashes, changed-document prompts, dual confirmation, legacy settings, hydration failure, imported recovery keys and stale/background reads. App iOS/Android type checks passed in the implementation review. Website legal and release-availability tests pass; the full client/SSR/prerender build passes. Website-wide TypeScript still reports existing errors outside these changes, including FAQ and shared UI components; this is not a clean whole-site type-check claim.

The independent delivery review found the Nginx static-route fallback defect described above and it was corrected before merge. A local Nginx HTTP check verified every legal paragraph without JavaScript and reproduced failure with the old configuration.

Website commit `4bb2214914b0096d38878bf1524571b35b4f80fb` was merged and pushed to `origin/main` on 10 September 2026. Railway automatically started deploying that commit. Live delivery verification is pending deployment completion; successful local builds alone do not establish the live website's revision. No production app build, store submission, Freedom Store PR or app release was triggered by this work.

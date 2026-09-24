# Product Claims

Source review: 2026-09-14, baseline `fc597d4a23cf64be27e31e32a4480ba3d3c63c94`
plus this working tree. This is a scoped copy review, not a security audit,
legal opinion, reserve attestation, device test, or live distribution check.
Primary implementation links below establish what was inspected; protocol links
establish protocol constraints, not proof of deployed behavior. Mutable upstream
documents and services need rechecking when a claim changes. No live store copy,
mint balance, private data, or server logs were fetched for this review.

Use alongside the code rules in [hunch.config.ts](hunch.config.ts) (including
`copy/honest` for microcopy), the
[artwork guide](press/artwork/README.md) for rendered copy,
[legal guide](docs/legal/README.md) for notices and [glossary](app/CONTEXT.md)
for domain terms. Change a claim here first, update its catalog and any relevant narrow phrase rule,
run claims/tests, then coordinate legal publication when relevant. The source
migration and its unfinished work are recorded in the
[consolidation decision](docs/architecture/site-consolidation.md).

## 1. Ecash And Custody

**Observed:** [CocoProvider](app/shared/providers/CocoProvider.tsx) and the
[wallet operations](wallet/src/operations) manage local proofs and mint requests.
[NUT-00](https://github.com/cashubtc/nuts/blob/main/00.md) defines mint-signed ecash;
[NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md) and
[NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md) separate issuance and
redemption. Control of a proof is not direct on-chain custody of its backing.
The bundled [terms](copy/legal/documents.json) identify SOVRAN LTD as the app
operator and explicitly do not assert that every mint is independent of Sovran.

**Decision:** short copy may say "Send cash in a message" when the accompanying
text identifies digital cash and reliance on its issuer. Do not describe the token
in that message as directly held bitcoin. Explain ecash once as digital cash issued
and redeemed by a mint; keep protocol internals out of headlines.

Say that the device holds keys and ecash proofs while the issuing
mint holds the backing funds and is responsible for redemption. A mint can be
unavailable, insolvent, dishonest, or impose restrictions; the app does not verify
reserves. This applies equally to a mint operated by Sovran or its app operator:
Sovran branding does not remove mint custody or issuer obligations. Do not call
the ecash balance non-custodial or self-custodial. Distinguish the app operator's
role from the mint operator's role without suggesting they must be different entities.

**Follow-up:** confirm the operator, jurisdiction, redemption terms, fees and
deadlines for each advertised mint, including any Sovran-branded mint. This review
does not establish which mints SOVRAN LTD currently operates, their reserves, or
their present availability. A rating, audit badge, or successful test is not proof
of backing. Use only small amounts one can afford to lose.

## 2. Blinding And Metadata

**Observed:** NUT-00 describes blinded issuance and unblinded proofs spent at the
mint. NUT-04/05 requests carry operation-specific data. The
[mint metadata store](app/shared/stores/global/mintMetadataStore.ts) and
[recovery discovery](app/features/settings/lib/recoveryDiscovery.ts) consume
discovery information, not proof of reserves. The
[privacy notice](copy/legal/documents.json) distinguishes blinding from metadata
exposure, including invoices, destinations, amounts, times, IP addresses and public
locking keys depending on the operation.

**Decision:** describe blinding as limiting links between issuance and spending,
not as hiding every transaction. Mints observe inputs spent together and the
requests they handle; services can correlate timing, amounts, network information,
and public Nostr activity. Do not claim anonymous or untraceable payments. Mint
names, descriptions, reviews, uptime checks and discovery filters are attributed
metadata, not endorsements, verified identity, solvency or future availability.

**Follow-up:** verify actual server logging, retention, network routing and
cross-service correlation before stronger privacy wording. Those deployment facts
were not measured here; the published notice is a disclosure, not independent evidence.

## 3. Recovery Is Conditional

**Observed:** [readRecoveryInformation](app/features/settings/lib/readRecoveryInformation.ts)
distinguishes root words, derived Nostr keys, imported private keys and Cashu seed
derivation. [SettingsRecoveryScreen](app/features/settings/screens/SettingsRecoveryScreen.tsx)
uses known/discovered mints, probes, keysets and restore operations; discovery is
filtered and bounded, not a complete history of the user's issuers.
[NUT-09](https://github.com/cashubtc/nuts/blob/main/09.md) requires mint restore
support; [NUT-13](https://github.com/cashubtc/nuts/blob/main/13.md) defines
deterministic secrets and counters. Neither promises restoration of every token
ever received or every kind of local record.

**Decision:** recovery words are sensitive and important, but words alone are not
a complete backup guarantee. Keep mint URLs, the appropriate profile/key material,
and suitable backups before deleting data. Imported identities need separate key
backups; a Nostr private key alone does not restore this app's Cashu wallet.
Recovery depends on the relevant mint, reachable supported records, derivation and
transaction history. Messages, imported bearer tokens, pending operations, and
local metadata need separate consideration. Losing backing at an insolvent mint
is not repaired by recovering keys. Sovran cannot reset lost words.

**Follow-up:** verify each recovery path against the installed SDK and supported
mints, including retired keysets, counter gaps, unavailable mints, interrupted
operations, imported profiles and existing backups. No recovery drill or funded
mint operation was run for this copy change. The backup flow verifies word recall,
not recoverability of every balance.

## 4. Nostr Messages

**Observed:** [nip17](app/shared/lib/nostr/nip17.ts) implements rumors, seals and
gift wraps; [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md),
[NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) and
[NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) define that path.
[NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) is a different,
legacy encrypted-message format with visible event participants.
[nip04Cache](app/shared/lib/nostr/nip04Cache.ts) stores decrypted strings;
[giftWrapCache](app/shared/lib/nostr/giftWrapCache.ts) stores unwrapped messages.
Both use [createPubkeyScopedCache](app/shared/lib/cache/createPubkeyScopedCache.ts),
which persists to AsyncStorage.

**Decision:** say supported Nostr DMs are encrypted on the client for recipients;
the app-view transports encrypted events instead of receiving decryption keys.
Do not describe the service as zero-knowledge. Routing/connection metadata,
recipient copies, compromised devices, separate media requests and local
decrypted caches remain relevant. Profile scoping is not encryption at rest.
Do not generalize NIP-17 protections to NIP-04, public rooms, BLE, or MLS transports.
NIP-44 explicitly lacks forward secrecy and post-compromise security: a compromised
identity key can expose retained past messages, including bearer ecash sent inside
them. Separate wallet/identity derivation does not remove that message risk.
NIP-17 gift-wrap routing exposes a recipient tag; do not confuse the outer random
signing key or randomized timestamp with verified real-sender identity or send time.

**Follow-up:** the memory-only/encrypted-cache target (follow-up F02 in
[docs/architecture/follow-ups.md](docs/architecture/follow-ups.md)) remains
implementation work. Audit each transport and deployment separately; this review
did not inspect running Nagg services, device databases, or remote retention.

## 5. Nostr Access And Delivery

**Observed:** [publishEvent](app/shared/lib/nostr/publish/publishEvent.ts) tracks relay
responses and bounded retries. [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)
permits relay rejection; [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)
does not compel every recipient or relay to erase a copy. The
[protocol guide](docs/protocols/nostr.md) documents local blocks and public reports.

**Decision:** describe key-based identity and relay choice, not immunity to
censorship or shutdown. A relay can refuse, delete, restrict or stop serving
content. Relay acceptance is not recipient receipt, reading, permanent storage,
or ecash redemption. Blocks hide supported local content; reports do not establish
an operated moderation queue or guaranteed removal.

**Follow-up:** verify reachability, reconnect behavior and actual moderation
operations independently. Store policy compliance cannot be inferred from protocol
support or local filtering alone.

## 6. Payments, Fees And Offline Handoffs

**Observed:** the [payment catalog](wallet/src/copy/defaults.ts) distinguishes
created, pending, claimed and redeemed states, including mint/device-offline
warnings. The [service-error catalog](app/shared/lib/errors/catalog.ts) says that
timeouts leave the payment outcome unconfirmed. NUT-05 and
[NUT-07](https://github.com/cashubtc/nuts/blob/main/07.md) distinguish payment and
proof state; token delivery alone establishes neither.

**Decision:** use those conservative domain catalogs rather than introducing a
second payment-state vocabulary in `copy`. Supported NFC/BLE paths can hand off
tokens offline; redemption and spendability checks need the relevant mint.
Geohash Nostr rooms still need network access. Fees, timing, liquidity, supported
units and availability vary by operation, device and mint. Do not promise zero
fees, instant finality or universal wallet compatibility.

**Follow-up:** native handoff and settlement need separate verification. Existing
catalog labels such as `timeline.paymentRequest.nostrSent.label` and
`toast.paymentRequest.delivered` still merit state-specific review; referencing a
catalog is not certifying every label. No wallet behavior changed here.

## 7. Distribution And Store Copy

**Observed:** [release/config.json](release/config.json) configures an Apple app
ID, Android bundle ID and distinct Apple/general locales. The
[Apple](release/apple.mjs), [Android](release/android.mjs),
[Freedom](release/freedom.mjs), [GitHub/Zapstore](release/publish.mjs) and
[site](release/site.mjs) controllers distinguish publication states. Configuration,
an app ID, a submission or a download URL is not proof that a release is available.

**Decision:** use version-, region- and channel-specific evidence before asserting
availability. Current review status for each channel is deliberately explicit:

| Channel         | Source evidence inspected                           | Availability established by this review                  |
| --------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Apple App Store | Configured app ID and review/publication controller | Not checked live; no current version or region asserted  |
| TestFlight      | EAS submission code in [build](release/build.mjs)   | No public invite or active build verified                |
| Google Play     | Production publisher and the ledger's 0.1.3 release | The universal APK Play generated and signed is verified; no region or listing checked |
| GitHub APK      | Release/asset publisher                             | 0.1.3 APK downloaded and verified on 2026-09-24           |
| Zapstore        | Signed-event and APK publisher                      | Live events and CDN APK verified; no in-app install tested |
| Freedom Store   | Catalog/PR controller                               | No merged catalog entry or regional eligibility verified |

Android is the one family where cross-channel updates are now an established
claim. On 2026-09-24 the published 0.1.3 artifact was downloaded from
`github.com` and from `cdn.zapstore.dev`; both are the same 247,607,844 bytes
(`2fca9101…1ca758a941`), signed by exactly one certificate
(`b598befc…751e59af`, RSA 4096, `CN=Android, O=Google Inc.`) with Google Play's
source stamp, which is Play's own generated universal APK rather than an
independently signed build. `com.sovranbitcoin` version code 24 installed onto a
clean Android 16 emulator image and reported that same certificate. Zapstore's
live kind 32267/30063/3063 events name the same hash, certificate, version code
and source commit. Because every Android channel serves one artifact under one
signing identity, an install from Play, the GitHub APK or Zapstore can be updated
by any of the others; [release/verify.mjs](release/verify.mjs) re-checks this from
public sources alone. Not established: no update was exercised through the Play
Store or the Zapstore client on a device, and the Play-served split install was
not inspected — the byte identity above is the evidence, not an observed
store-to-store upgrade.

**Follow-up:** obtain read-only channel evidence with timestamp, source URL,
locale, version/build and region before changing an availability label. No store
snapshot was supplied or invented. [store.json](copy/store.json) is English
editorially reviewed candidate copy, explicitly not publication-ready and not a
store snapshot. Length checks are necessary but do not prove store acceptance,
translation quality or visual fit. Do not wire it into release publishers until
locale mapping and reviewed-source pinning are designed and verified.

## 8. Source And Licensing

**Observed:** the root [LICENSE](LICENSE) is MPL-2.0; package manifests and
vendored notices describe additional components. This checkout also depends on
external packages, hosted services and separately sourced artwork.

**Decision:** name the specific repository or component and its applicable
license. Do not claim the product is fully open source. Source visibility does
not establish that all assets, build dependencies, server deployments, signing
infrastructure or store binaries are covered by one license or reproducible.

**Follow-up:** complete component/asset license and distribution audits before a
broader source claim. No dependency-license census or reproducible-build test was
performed for this change.

## 9. Copy Ownership And Enforcement

**Observed:** `copy/onboarding` owns the introductory English strings;
`copy/legal` exports the existing legal documents, whose revision hashing remains
with the app; `copy/site` belongs to the site consumer; `copy/claims` exposes the
[phrase policy](copy/claims.json). Payment and error state copy remains in its
existing domain owners. This is not a new localization runtime.

**Decision:** hard phrase rules block known overclaims; watch words request
human contextual review and are summarized rather than printed hundreds of times.
Exceptions identify a rule, exact file paths, and one complete contextual sentence.
Legal explanatory negations are not whole-file exemptions. In Markdown, explicit
editorial prohibitions are policy quotations, not affirmative product copy.
An ordinary quotation, code fence, or unrelated negation is not an exemption.

**Follow-up:** run `node copy/scripts/lint.mjs` and
`node --test copy/scripts/*.test.mjs`. The lexical checker covers authored text in
the declared surfaces, not binary images, generated output, all application copy,
dynamic string composition, every language, or deployed/store content. Optional
external snapshots are warning-only and their authenticity/freshness is not
verified. Missing surfaces and external evidence are reported. Passing this
checker is not substantive approval of a claim.

## 10. Other Surfaces And Review Rules

**Observed:** the [privacy notice](copy/legal/documents.json) describes AI prompts,
public location rooms, nearby communication and service operators. Protocol and
implementation presence are different from shipped channel availability.
Primary texts fetched on 2026-09-14 are recorded below. Mutable upstream
specifications are not a claim that the pinned app implements every current revision.

**Decision:** apply the following scoped rules even where no lexical detector can
establish their truth.

| Surface or domain | May say with evidence | Required qualification or prohibited inference |
| --- | --- | --- |
| Lightning | The wallet uses a mint's supported payment operations | Quotes, liquidity, routing and fees can fail or change; no speed or success guarantee. |
| Multiple mints | Choose issuers and spread exposure | Tokens remain issuer-specific; multiple mints do not guarantee backing or convertibility. |
| On-chain | Name a capability verified for the installed version and channel | Parsing BIP-321 or finding source screens does not establish a public send/receive release. |
| Nut Drop | Send to a compatible nearby peer | `deliverNearPayIfActive` in [sovranPaymentConfig](app/features/send/lib/sovranPaymentConfig.ts) uses a recipient-encrypted BLE message and requires advertised capability. This corrects the earlier public-broadcast description. Do not generalize this to public location rooms, Nostr DMs, or every mesh client; offline bearer ecash still carries redemption and key/device risks. |
| Routstr | Pay for supported model usage | The selected provider receives plaintext prompts and supplied context. Payment privacy is not prompt confidentiality. |
| NIP-05 | A domain maps a name to a public key | Do not describe this as verified personal identity or trustworthiness. |
| Zaps | A provider publishes a receipt | A receipt is provider-attested, not independently conclusive payment or reserve evidence. |
| Company | Use the operator details in the approved notices | Mint-operator duties and regulatory exposure need qualified advice. App terms cannot cancel issuer or mandatory consumer obligations. |
| Translations | Identify the locale actually reviewed | English fallback or a translated label is not complete localization. Do not publish unreviewed machine translations of risk/legal qualifications. |

Lead with a concrete benefit, then the material limit. Avoid protocol names in
short headlines where ordinary words work; explain necessary terms in body copy.
Keep one thought per sentence. Do not use exclamation marks, rhetorical questions,
rhythmic three-part slogans or empty claims of ease. Follow the installed stop-slop
guidance for AI-drafted prose. Store copy needs locale-specific field budgets and
current platform financial-feature review, not merely a passing string-length test.
Roadmaps distinguish planned, implemented in source, and released on a named channel.

**Follow-up:** complete the per-domain evidence inventory, legal/provider review,
store snapshots and native capture provenance before treating the full brief as
implemented. Current corrected violations and remaining owners are explicit below.

| Finding | Owner | Status |
| --- | --- | --- |
| Onboarding custody, correlation and censorship absolutes | `copy/src/onboarding.ts` | Corrected; component tests pass; native small-screen/large-text review still needed. |
| Phrase-only recovery promise | `copy/src/onboarding.ts` / backup flow | Corrected without changing recovery behavior. |
| App-view DM confidentiality overstatement | `docs/protocols/nostr.md`, `app/README.md` | Corrected; no claim of metadata hiding or encrypted local caches. |
| Claims-bearing artwork, including alternate strings | `press/artwork/source/copy.json` | Reviewed all 19 concepts; 16 changed in this follow-up. Source corrected; frame/render owner must regenerate affected outputs. This review did not render or recapture images. |
| Old site FAQ, release prose and unused templates | Old website / replacement-site activation | Old repo untouched; replacement source does not import those claims. Live remediation awaits activation. |
| Plausible disclosure and legal strengthening | `docs/legal/README.md` | Pending coordinated publication; replacement site has no analytics. |
| Current store/social wording | Store owners | Not fetched or published; candidate catalog is not evidence of live listings. |

## 11. Evidence And Artwork Review

"Observed" below means source-inspected, not exercised on a device or verified in
production. Read these limits with sections 1-10, not as independent approval badges.
There is no reserve attestation, verified reviewer identity, complete recovery drill,
or current store availability evidence in this review.

### Protocol evidence

All successful fetches in this table were observed on **2026-09-14**. Dates are
access dates, not professional approval or upstream revision dates.

| Source | Observed fact | May say | Must not infer / review trigger |
| --- | --- | --- | --- |
| [iscashucustodial.com](https://iscashucustodial.com/) | Distinguishes locally held tokens from mint-held reserve assets; warns of loss if the mint disappears. | You hold digital cash; its issuer holds any backing and must redeem it. | Cryptographic possession proves neither reserves nor direct custody of bitcoin. The page's layer-specific custody terminology is not an app-balance headline. |
| [Cashu homepage](https://cashu.space/) and [docs](https://docs.cashu.space/) | Describe wallets, mints and bearer ecash. Requested `cashu.space/docs` returned 404; the homepage links the working docs host. | Cashu is the ecash protocol used by the wallet. | Do not copy universal timing/finality slogans from ecosystem marketing. Protocol mechanics and app behavior take precedence. |
| [NUT-00](https://github.com/cashubtc/nuts/blob/main/00.md) | Mint signs blinded outputs; recipient normally swaps received proofs. V4 tokens identify one mint and unit. | Share digital cash as a token or message. | Sending a string is not verified redemption; the token is not a bitcoin UTXO. |
| [NUT-02](https://github.com/cashubtc/nuts/blob/main/02.md) | Keysets carry units, activity and input fees; inactive keys differ from optional final expiry. | Fees and refresh requirements depend on the mint/keyset. | Key retirement alone does not mean immediate invalidity. Upstream final-expiry behavior is not a legal waiver or evidence the installed SDK supports it; recheck version and issuer terms. |
| [NUT-07](https://github.com/cashubtc/nuts/blob/main/07.md) | Mint reports pending, spent or no record of pending/spent; state polling can aid correlation. | Check the payment or token state with its mint. | An unspent response is not a reserve check or proof the intended recipient redeemed it; checks can leak metadata. |
| [NUT-09](https://github.com/cashubtc/nuts/blob/main/09.md) | Restore returns signatures for previously signed blinded outputs when the mint retains and serves them. | Recovery uses records held by the mint. | Seed possession does not force a mint to respond or recreate missing records. |
| [NUT-13](https://github.com/cashubtc/nuts/blob/main/13.md) | Deterministic derivation is versioned and per-keyset; recovery searches counters and checks spent state. | Keep recovery words, mint URLs and appropriate backups. | Incoming tokens not regenerated from this seed, missing keys, search gaps and absent records can defeat recovery. Check installed derivation and mint support. |
| [NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md) | P2PK conditions are mint-enforced; unsupported conditions can be treated as bearer proofs. Lock/refund paths depend on tags and time. | Supported locks restrict who can redeem under specified conditions. | A lock is not encryption, a reserve guarantee or proof every send is locked. Verify capability, key, locktime and refund conditions per path. |
| [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) | Payload encryption has no forward secrecy or post-compromise security; network metadata remains. | Supported message content is encrypted for recipients. | Identity-key compromise can expose retained messages and their tokens. The specification's cited audit is not a Sovran security audit. |
| [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) and [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) | Rumor, seal and gift-wrap layers; recipient routing tags; randomized outer timestamps; per-recipient copies. | Client-encrypted Nostr DMs obscure some message metadata. | Broad benefit headings do not erase recipient tags, connection information or retained copies. Deletion/expiration is not cryptographic forward secrecy. Recheck each transport, relay and attachment path. |

### Implementation evidence

| Domain and inspected source | Fact | May say | May not say / remaining review |
| --- | --- | --- | --- |
| [Contact send](app/features/send/lib/sovranPaymentConfig.ts), `deliverContactDmIfActive` | Encodes ecash and passes it to the DM adapter; success means relay handoff. | Send digital cash in chat. | Do not equate relay acceptance with receipt, redemption or bitcoin settlement. |
| [DM wrapping](app/shared/lib/nostr/nip17.ts), [unwrap cache](app/shared/lib/nostr/giftWrapCache.ts), [cache storage](app/shared/lib/cache/createPubkeyScopedCache.ts) | Client encryption and recipient tags; unwrapped content is cached through AsyncStorage. | Supported encrypted DMs. | No promise of encrypted local message storage, hidden connection metadata or safe retention of bearer tokens. Cache remediation remains pending. |
| [Recovery loader](app/features/settings/lib/readRecoveryInformation.ts), [discovery](app/features/settings/lib/recoveryDiscovery.ts) | Imported keys and derived wallet seeds differ; discovery admits at most 100 filtered mints. | Back up words, mint URLs and imported keys. | Discovery is not a complete issuer history; successful word recall is not a restore drill. |
| [Mint audit projection](app/features/mint/lib/auditInfo.ts), [reviews cache](app/features/mint/data/mintReviewsCache.ts) | Shows operation counts/results, timing, ratings and comments. | Compare recorded checks and community reviews. | No verified reviewer usage, independent financial audit, operator vetting, backing or future uptime established. Owner must document listing criteria and affiliations. |
| [Receive screen](app/features/receive/screens/ReceiveScreen.tsx), [rail states](app/features/receive/lib/receiveRailItems.ts) | Multiple QR rails and distinct quote/request states, including expiry. | Share a code with a compatible wallet. | No universal wallet/rail support; an on-chain screen is not proof of a released capability or deposit under the user's own on-chain keys. |
| [Feed adapter](app/features/feed/data/facadeFeedAdapter.ts), [thread adapter](app/features/feed/data/facadeThreadAdapter.ts) | Ranked/recent modes, service-dependent ordering, paging and timeouts. | Follow people or explore a ranked feed; explore replies. | No absence of algorithms, authenticated engagement, complete network history or guaranteed ordering/delivery. |
| [AI send](app/features/ai/hooks/useAiSend.ts), [message assembly](app/features/ai/lib/assembleApiMessages.ts) | Selects a supported model/candidate chain and sends conversation context with bounded image attachments. | Choose a supported model and pay for usage. | Not every model or a fixed charge per answer. Provider fallback can change recipients; privacy wording must cover selected and fallback providers, retention and supplied context. |
| [Replacement-site metadata](site/src/pages/build.json.ts) and `site/src` inspection | Marks analytics withheld; inspected source had no analytics integration or preference-storage implementation. | Analytics is omitted from this replacement source. | Not evidence the live domain, host logs, injected scripts or prior site collect nothing. Deployment/request review remains required. |

### All 19 concepts

Reviewed every headline and subtitle in [artwork copy](press/artwork/source/copy.json),
including unselected alternatives. Selection indices and concept IDs stay intact.
Short copy must travel with material trust/risk information; do not crop away a
qualifying subtitle or treat the longer register as a substitute for public notice.

| Concept | Selected text / review result | Change and limit |
| --- | --- | --- |
| `app-overview` | "Money and messages, one app." / "Send digital cash, follow friends, and chat with AI." | Removed direct-bitcoin conflation from all alternatives. Explain mint trust in accompanying product material. |
| `wallet` | "Cash on your phone." / "Digital cash on your phone. Its value depends on the mint." | Removed immediate readiness and single-balance assumptions. |
| `receive-unified` | "Show a code. Get paid." / "Share a payment code with a compatible wallet." | Removed universal wallet and timing claims. |
| `send` | "Send from your wallet." / "Choose a contact or scan a payment code. Check the details before sending." | Removed universal recipients/routes; keeps the confirmation step. |
| `mint-trust` | "Check before you add money." / "Compare mint checks and reviews. Neither guarantees your funds." | Removed implied verified operator knowledge and financial vetting. |
| `mint-reviews` | "What others found." / "Read community reviews before choosing a mint. Reviews are not guarantees." | Removed implied authenticated users, independence and evidence of reserves. |
| `mint-updates` | "See what changed." / "See recorded changes to your mint, with dates and details." | Selected wording retained; alternative no longer implies verified operator identity. Records need not be complete or current. |
| `payments-instant` | "Pay like it's cash." / "Send digital cash. Fees and availability depend on your mint." | ID retained for renderer contracts; ID is not public timing copy. |
| `social-feed` | "Keep up with your people." / "Catch up with people you follow, or explore a ranked feed." | Removed algorithm denial, authenticated-engagement and blanket ad-free implications. |
| `social-thread` | "Follow the replies." / "Open a post to explore its replies and the conversation around it." | Removed completeness and universal ordering promises. |
| `social-dm` | "Send cash in a message." / "Send digital cash in chat. You still rely on its issuer to redeem it." | Fixes the reported bitcoin/ecash conflation; alternate encryption wording remains transport-scoped by this concept, not all chat. |
| `contacts` | "Pay by name." / "Find a friend, then review the payment before sending." | Removed one-tap completion implication; names are not verified identities. |
| `ai-chat` | "Chat with AI, pay as you go." / "Top up AI credits from your wallet. Your provider receives your prompts." | Removed all-model, per-answer and blanket no-account claims. |
| `ai-models` | "Choose a model. Pay for usage." / "Compare supported models. Prices and availability vary." | Same provider/cost limits; alternatives also corrected. |
| `themes-colors` | "Your wallet, your colors." / "Choose wallpapers and colors for your wallet." | Removed every-screen coverage promise. |
| `themes-artemis` | Selected headline/subtitle unchanged. | Describes collection/per-currency wallpaper; image provenance and rights still belong to frame/asset review, not claims lint. |
| `portal-artemis` | Selected headline/subtitle unchanged. | Decorative collection copy, not evidence of NASA endorsement or permission for every asset. |
| `stories` | Selected headline/subtitle unchanged. | Describes browsing posts; does not promise erasure, ephemerality or complete coverage. |
| `backup` | "Keep a way back." / "Save your recovery words and mint URLs. Recovery has limits." | Alternate explicitly calls out imported keys and incomplete restore. |

**Regeneration handoff:** frame agent owns regeneration and visual review for the
16 changed concept catalogs (including alternate-only changes), feature graphics and manifest/provenance. Do not assume existing PNG text
matches this source. No renderer or native capture was run in this follow-up;
disk constraints and current build-bound capture evidence remain unresolved.

**Enforcement:** the new rules target observed ecash/bitcoin conflations,
universal-capability slogans, mint-review overclaims and feed-ranking claims.
Tests seed the actual former strings into unselected artwork alternatives and
invoke the real CLI; qualified replacements stay allowed. No new exception or
whole-file exemption was added. These rules do not detect all misleading copy.

# Sovran legal documents

Status: the existing canonical `publicationReady` flag remains **true**. The 14 September 2026 source move changes no legal text, dates, operator details, or publication status. It is not a new legal approval, provider audit, app-store approval, or claim of lawyer review.

## One source of truth

The canonical source is `copy/legal/documents.json` in this repository. The app imports `copy/legal` and renders that bundled text offline. The site reads the same source; `/legal/documents.json` serves its exact bytes, without adding a `revisions` field. Never edit generated website output by hand.

From the repository root, `bun run legal:sync` builds the local `site/` into `site/dist/`; it does not write to a sibling checkout or publish anything. `bun run legal:check` compares `site/dist/legal/documents.json` byte-for-byte with the canonical source and runs the site's legal HTML build test. Build the site first. `bun run legal:publication-check` checks approval and required content locally; it does not inspect the deployed website or certify legal compliance.

The website must serve `/terms` and `/privacy` as readable HTML without JavaScript or login. Site renderers and build metadata compute revisions using the app's serialization below, not a field added to the canonical JSON. Static hosting must serve the generated legal HTML rather than a root-page fallback. Site publication is separate from app release.

The app release controller checks that approved bundled documents match the deployed website before starting EAS. Publish the website text before releasing an app update containing it. Development preview may use `publicationReady: false`; publication requires true and complete operator fields. The flag is not a compliance certificate.

**Shipped immutable-source compatibility:** the active release controller can build an older pinned source SHA. `release/legal.mjs` first reads `copy/legal/documents.json` from that source directory and, only on `ENOENT`, reads `app/shared/lib/legal/documents.json`. Invalid JSON, malformed documents, and other read errors do not select the legacy file. Keep this narrow exception while active releases can pin the old layout; review it when those releases retire. Missing fields cannot pass by comparing `undefined` with `undefined`. A public JSON `revisions` field is not required: the content and publication status are authoritative.

## Historical review record

The following records predate this move and describe the 10 September 2026 review. They have not been independently reverified against provider accounts or production infrastructure during the move. "Review" here does not mean qualified legal advice or lawyer approval.

- The operator confirmed SOVRAN LTD, registered in England and Wales under company number 15895560, with registered office at 3rd Floor, 86–90 Paul Street, London, EC2A 4NE, United Kingdom, and monitored privacy email kelbie@sovran.money.
- The operator confirmed Railway Hobby hosting and no automatic production-log exports outside Railway. Railway documents seven days of accessible log history on Hobby, but says upgrades restore older logs. The policy therefore does not promise permanent erasure after seven days.
- Read-only Railway project metadata showed active website and `api.sovran.money` deployments in `europe-west4-drams3a` (Amsterdam). The mint had that region in latest-deployment metadata, but no active-deployment region was supplied. This does not establish Nagg services in other projects or backup/log storage locations.
- Railway's published DPA describes US processing and transfer safeguards, including SCCs and the UK Addendum where applicable. The policy does not imply Amsterdam deployment means EU-only processing.
- Nagg source records viewer public keys and last-seen activity to preserve relevant content. Its `known_viewers` schema configures 365-day expiry after last sighting. Database diagnostic tables separately configure three- or seven-day expiry. These settings were not presented as verified production deletion deadlines.
- The prior review record reports publication approval after adding company-registration information, mint-backing and redemption-deadline risks, international-transfer information, a separate right-to-object paragraph and the ICO complaint route. This is a historical workflow record, not evidence of a professionally qualified reviewer or legal certification.

Retention for other operator-controlled records is described by purpose-based criteria, not invented fixed periods. These criteria guide operation; source inspection cannot certify actual retention, provider deletion, or every backup. Removing Sovran from new wallet defaults does not remove obligations for Sovran-operated services or ecash already issued.

## Agreement and recovery behavior

Each document's full content, operator details and publication flag are fingerprinted with SHA-256. Explicit confirmation stores both revisions and a timestamp in `settings-store.legalAcceptance`. Website changes alone cannot reprompt an older/offline app: deliver the changed documents in an installed app update.

The fingerprint input remains exactly `JSON.stringify({ operator, document, publicationReady })`, in that property order, with no whitespace or key sorting added. The move preserves these values and therefore does not require another acceptance prompt:

| Value | SHA-256 |
| --- | --- |
| Canonical file bytes | `ffaa48e2e6378c2931605c66ce00c4405aec82f8f96d57cbc08e42b65f4de7d4` |
| Terms revision | `f71f7d665b21a0322884c86e548ed4400836a6bf946d3511392bc9c20012f512` |
| Privacy revision | `2afbd0f2a5962bb839d7541c88f0e9467fe64718ce422fd2f995fd045a0c3692` |

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

## Pending strengthening and analytics review

These are proposals for a separately approved legal-text change, not changes authorized by the source move:

- Reconcile website-specific disclosures with the replacement site's actual behavior, including the existing language-preference local-storage statement. Confirm production behavior before changing the notice.
- Review whether service-specific mint redemption, paid-service cancellation/refund, complaints, and recovery limitations need more explicit notices at the point of use. Preserve mandatory consumer rights; do not introduce blanket waivers or guarantees.
- Reconfirm the service/provider inventory, purposes and legal bases, retention criteria, transfer arrangements, and rights-request handling against operator evidence. Do not turn a configured region or documented provider policy into a verified deletion or residency claim.
- Keep Plausible analytics withheld pending an explicit decision and disclosure review. The canonical policy has not been amended to authorize or describe a new analytics deployment. A cookie-free claim alone does not settle legal basis, transparency, or applicable consent requirements.

Plausible review sources read on 14 September 2026: [visitor data policy](https://plausible.io/data-policy) and [DPA](https://plausible.io/dpa). These are provider-authored descriptions, not verification of Sovran's configuration, an executed agreement, or provider operations. The data policy describes URL/referrer and device/location metrics, processing IP and User-Agent inputs into a daily salted identifier, and no persistent identifiers or cookies. The DPA describes controller/processor roles, customer notice obligations, deletion instructions, and EU processing. Review the selected hosted or self-hosted deployment, subprocessors, retention/backups, and transfer arrangements before making corresponding Sovran claims.

Before activation, inspect actual requests and configuration for page paths, campaign parameters, referrers, outbound-link/custom events, and any identifiers. Exclude wallet secrets, payment/order references, public-key identifiers, and sensitive URL data. Confirm the applicable legal basis and consent requirements, publish approved disclosures first, and separately verify the deployed behavior. None of those operational or legal steps is marked complete here.

## Claims Follow-Up Review

Reviewed on **14 September 2026** against `copy/legal/documents.json`, the
implementation evidence in [CLAIMS.md](../../CLAIMS.md#11-evidence-and-artwork-review),
and the public sources below. No canonical policy text, approval flag, operator
field, date or acceptance hash was changed. No provider accounts, secrets,
server logs, wallet contents or live settings were inspected. This is a specific
coverage assessment and drafting proposal, not a certification of actual processing.

### Coverage and gaps

Section references below refer to the current Terms or Privacy Policy in
`copy/legal/documents.json`, not to this guide.

| Priority / concern | Existing coverage | Gap and action |
| --- | --- | --- |
| High: issuer custody and loss | Terms 2 distinguishes local proofs from mint-held backing, disclaims reserve verification, names insolvency and possible deadlines. | Core disclosure is present. Surface it before funding and beside ecash-as-cash marketing; identify each advertised issuer and its terms. Do not weaken this into a generic software-risk disclaimer. |
| High: suggested mints and operator affiliations | Terms 2 says listings/recommendations/ratings are not reserve evidence and that not every mint is independent of Sovran. | More explicit distinction between technical checks, community opinion and operator vetting is useful (draft A). Owner must supply listing criteria, commercial relationships and actual mint operators. No facts about independence were established here. |
| High: app company also operating a mint | Terms 2 preserves issuer obligations, including Sovran-branded mints; Terms 7 preserves Sovran's own duties. | This is not a legal separation of app and issuer businesses. Use draft B and a mint-specific notice containing issuer identity, redemption process, fees, deadlines, complaints and shutdown handling. Confirm whether SOVRAN LTD operates each service; do not classify it as independent by default. |
| High: recoverability | Terms 3 already makes seed recovery conditional on mint/protocol/history, distinguishes imported identities and a Nostr key, and warns against assuming recovery of every token, message or balance. | Mint URLs and explicit pending-payment coverage are absent. Draft C makes these limits actionable without promising a full export feature or recovery from lost reserves. Native restore drills remain pending. |
| High: privacy processing map | Privacy 3-10 covers mints, Nagg viewer activity, Primal, relays, media, AI, location, eSIM, support, hosting, transfers and retention criteria. | Good categories, but the general list of legal bases in Privacy 9 is not a verified purpose-to-basis map. Owner must verify controller/processor roles, legitimate-interest assessments, fallback providers, retention implementation and transfer mechanisms per service. Document public-data sources and notice delivery for people whose data arrives from Nostr rather than directly. |
| High: website analytics and storage | Privacy 8 describes host requests and language preference storage, but does not describe Plausible analytics. | Replacement `site/src` omits analytics and preference storage; that is not live-domain evidence. Draft E is for the no-analytics replacement only after request/deployment verification. Keep analytics off until a separate approved disclosure/configuration decision; source relocation does not cure old live behavior. |
| Medium: message confidentiality | Privacy 2 says not all local data is encrypted; Privacy 5 qualifies recipient copies, metadata and media. | Explicitly connect NIP-44 key compromise and decrypted local message caches to message/token exposure (draft D). This improves notice but does not fix cache storage. |
| Medium: negligence and consumer rights | Terms 7 already preserves legally required care, fraud, death/personal injury from negligence, mandatory rights and access to courts. Terms 4 preserves cancellation/refund rights. | Retain these paragraphs. A broader no-liability clause would be a regression, not stronger protection. CRA 47/57 prohibit relevant exclusions, CRA 62 requires fairness, and CRA 65 bars excluding negligence causing death/personal injury. Scope depends on the actual contract; these provisions do not mean every financial loss is automatically compensable or every limitation automatically invalid. |
| Medium: third parties and paid services | Terms 4 and Privacy 1/9 distinguish provider terms from processing controlled by Sovran. | Verify default and fallback recipients, who sells credits/eSIMs, price/validity/compatibility/refund disclosures at purchase, and handling of historical eSIM orders. Labels and third-party boilerplate cannot transfer Sovran's own duties to users. |
| Medium: privacy complaints | Privacy 1/10 gives a contact route; Privacy 11 expressly gives the ICO route. | Make the right to complain directly to Sovran explicit, with an actual handling process (draft F). Current ICO guidance calls for accepting complaints through other channels too; a notice or a monitored email alone does not demonstrate that process works. |

### Owner-review paragraphs

These are proposed original paragraphs, **not approved live policy**. Publish none
of them merely because this file exists. A-D describe inspected boundaries; B also
needs service-operator identification. E and F require operational confirmation
before use. Integrate rather than duplicate existing paragraphs in the named sections.

**A. Terms 2, after the listed/recommended mint sentence:**

> A suggested mint is an option to consider, not a promise that its operator has been vetted or that your money is safe. Technical checks show how a service responded at a particular time; community reviews are other people's views. Neither proves the operator's identity, reserves or ability to redeem your ecash. Check who issues your ecash and read that issuer's terms before adding money. This does not limit our responsibility for our own statements or conduct.

**B. Terms 2, clarify app and issuer roles:**

> The same company may provide the app and operate a mint. Where SOVRAN LTD operates a mint, these app terms do not remove its responsibilities as the issuer of that mint's ecash. The mint's service notice should identify its operator and explain redemption, fees, any refresh or redemption deadlines, and how to raise a complaint. A Sovran name or logo is not evidence of reserves or a promise against loss.

Before using B, the owner must identify the operator of every Sovran-branded or
advertised mint and supply the actual service notice. Do not substitute this
paragraph for issuer terms or imply those terms/controls already exist. A protocol
expiry field does not itself establish an enforceable contractual forfeiture.

**C. Terms 3, expand the existing backup paragraph:**

> Keep your recovery words and a record of the mint URLs you used. Back up imported private keys separately. Recovery also needs the right wallet derivation and records that the relevant mint still makes available. Words alone may not restore received tokens, pending payments, messages or other local records. Recovering keys cannot replace backing lost by a mint. Check what your backups cover before deleting data or changing devices; never give recovery secrets to support.

**D. Privacy 5, after the supported-message paragraph:**

> A stolen messaging key can expose retained encrypted messages, including digital cash shared inside them. The app also caches decrypted messages on your device; these caches are not encrypted by Sovran. Message encryption does not protect copies on an unlocked or compromised device, or prevent a recipient from keeping or sharing them. Sharing cash in a message does not remove reliance on the issuing mint to redeem it.

**E. Privacy 8, replacement website paragraph, contingent on verified cutover:**

> The website does not use an audience analytics service or store a language preference in your browser. Its hosting and delivery providers still receive requests, which can include your IP address, requested URL, time and browser information. Following a download or other external link contacts the destination service under its own privacy practices. The app and other Sovran services have the separate data flows described in this policy.

E must not be published while the live site still uses analytics or preference
storage. Check hosting/injected scripts, request paths, redirects and eSIM order
URLs, not just source imports. Preserve accurate hosting/retention disclosures.
If analytics is chosen instead, replace E with a configuration-specific notice
covering purpose, data inputs, recipients, legal basis, retention, transfers and
choices. There is no approved analytics-on paragraph without those missing facts.

**F. Privacy 11, add a direct complaints route:**

> You can complain to SOVRAN LTD about how we use your personal information by emailing the contact address above. Include enough non-secret information for us to understand the concern. We will acknowledge your complaint within 30 days, investigate without undue delay, keep you informed and explain the outcome. You can also complain to the ICO; you do not have to use our contact route first.

Before using F, assign a responsible person and cover intake through support,
public social accounts and other channels; protect complainants' details and do
not demand extra identity evidence when it is unnecessary. The 30-day period is
for acknowledging complaints, not a replacement for information-rights deadlines
or permission to delay the investigation. The retained ICO route remains valid.

### Benchmarks and generators

These are comparisons of public wording, not endorsements of enforceability or
verification of another wallet's operations. Sources were fetched on **14 September
2026**; an upstream page's own displayed update date is not our review date.

| Source | What was actually observed | What to use for Sovran / what not to copy |
| --- | --- | --- |
| [Minibits Terms](https://minibits.cash/terms), [Privacy](https://minibits.cash/privacy), displayed update 30 June 2026 | Separates wallet company and voluntary test-mint operators; names mint-held reserves, a 12-month retired-key window, recovery-tool limits, LNURL records, push tokens and diagnostics. Also contains broad waivers and generalized consent language. | Useful benchmark for separating issuer/service roles and publishing actual refresh deadlines. Do not import its 12-month period, operator separation, diagnostic practices, blanket consent or broad loss exclusions as Sovran facts. Sovran's existing specific consumer-rights carve-outs are preferable. |
| [Phoenix README](https://github.com/ACINQ/phoenix/blob/master/README.md) | ACINQ describes a Lightning wallet, local keys and a 12-word recovery phrase; links its Terms and Privacy. Requests to the linked `/terms`, `/privacy` and `/faq` returned HTTP 403 here. The public repo tree did not yield substitute Terms/Privacy text. | Useful custody-model contrast, not a Cashu legal template. Phoenix does not establish that Sovran's mint-dependent recovery is equivalent. **Policy comparison remains unverified**; obtain readable official policies before drawing clause-level conclusions. No Phoenix policy date or approval is asserted. |
| [Cashu.me welcome terms source](https://github.com/cashubtc/cashu.me/blob/main/src/pages/welcome/WelcomeSlide4.vue), displayed update 20 December 2024 | Asserts web-server-only operation and no mint operation; includes a blanket accountability waiver, indemnity, mediation/arbitration and no-personal-data/GDPR assertions. | Useful inventory of token/mint risks, but **not an adequate template for Sovran**. Sovran has operated APIs and may operate mints; a client-side architecture does not prove hosts process no personal data. Do not copy blanket waivers, asserted regulatory exemption, or compulsory dispute costs. |
| [ICO privacy notice generator](https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/) | A small-organisation tool with sector options, including professional services; its page reports July 2026 updates and links complaints guidance. No answers were submitted and no notice was generated here. | Concrete choice: use the ICO generator as a completeness cross-check after the operator supplies its processing map. It is not enough alone for mint custody, Nostr public records/metadata, decrypted caches, AI fallbacks or app/issuer roles. Selecting a finance category is not regulatory authorization. |

**Recommendation:** keep and improve Sovran's bespoke Terms and feature-based
Privacy Policy using A-F and a verified service inventory. The existing text is a
better starting point for this app than replacing it with a generic generator or
another wallet's terms. Use the ICO tool/checklist for omissions; obtain targeted
UK advice on issuer activities, consumer purchase terms and any proposed liability
limits after the operational facts are assembled. No public template can certify
actual collection, execute a provider agreement, establish reserves, perform a
deletion or eliminate SOVRAN LTD's lawful duties.

### Publication decision

Preserving approved bytes is intentional, not a finding that all wording is
complete. Changing `copy/legal/documents.json` changes acceptance revisions and
can fail the pre-EAS live-parity gate for active pinned releases. Next: owner
reviews A-F, confirms the service/processing facts, coordinates in-flight release
pins and publishes the approved canonical revision on the active site; verify
live HTML/JSON parity before an app update containing the same text. An old app
will not acquire new notice text or record acknowledgment from a website update.
Do not silently rewrite tests to bless new legal bytes during source migration.

## Sources

- [Company record](https://find-and-update.company-information.service.gov.uk/company/15895560) and [company website disclosures](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material).
- [ICO privacy-information guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/): identity, legal bases, recipients, retention periods or criteria, transfers and rights.
- [Railway logs](https://docs.railway.com/observability/logs#log-retention), [regions](https://docs.railway.com/deployments/regions) and [DPA](https://railway.com/legal/dpa).
- [Minibits Terms](https://minibits.cash/terms), [Privacy](https://minibits.cash/privacy), and [Cashu.me terms implementation](https://github.com/cashubtc/cashu.me/blob/main/src/pages/welcome/WelcomeSlide4.vue). Sovran's text is original and does not copy blanket no-data claims or broad liability waivers. No standalone policy was found in the inspected `cashubtc/wallet` tree.
- [Google Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311) and [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

Additional primary sources fetched for this follow-up on **14 September 2026**:

- [ICO privacy-information requirements](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/): purpose, lawful basis, recipients, retention periods or criteria, transfers, public-data sources and rights. The page flags ongoing review following the Data (Use and Access) Act; do not present the general checklist as a complete current legal opinion.
- [ICO complaint preparation](https://ico.org.uk/for-organisations/how-to-deal-with-data-protection-complaints/how-do-we-prepare-to-handle-data-protection-complaints/): direct complaint route, accepting complaints through other channels, informing people, acknowledgment and investigation processes, and processor assistance without transferring controller responsibility.
- Consumer Rights Act 2015 [section 47](https://www.legislation.gov.uk/ukpga/2015/15/section/47), [section 57](https://www.legislation.gov.uk/ukpga/2015/15/section/57), [section 62](https://www.legislation.gov.uk/ukpga/2015/15/section/62), [section 65](https://www.legislation.gov.uk/ukpga/2015/15/section/65): relevant digital-content/services exclusions, unfair terms and negligence limits. The applicable contract and facts still need assessment; experimental branding is not an exemption.
- Cashu NUT-00/02/07/09/11/13, custody explainer, Cashu documentation, and Nostr NIP-44/17/59 are individually attributed in the [claims evidence table](../../CLAIMS.md#protocol-evidence). Protocol authors' marketing headings and cited protocol audits are not legal or security approval of Sovran.

## Verification

Follow-up on 14 September 2026: `node --test copy/scripts/*.test.mjs release/tests/legal.test.mjs`
passed **32 tests** (27 copy, 5 release/legal),
including the original canonical byte hash and both acceptance revisions.
`node copy/scripts/lint.mjs` reported no hard violations; contextual review
warnings and absent external snapshots remain explicit. These checks did not
render artwork, inspect live processing or run a native recovery test.

The source-move regression tests pin the original file hash and both acceptance revisions, cover raw public JSON without revisions, reject missing/malformed matching content, and exercise both pinned-source layouts with stubbed downloads. Run `node --test release/tests/legal.test.mjs release/tests/build.test.mjs` from the root and the focused `legalDocuments.test.ts` app Jest test from `app/`. Local site verification is `bun run legal:sync` followed by `bun run legal:check`. These checks do not publish or establish live deployment parity.

### Historical delivery verification (10 September 2026)

The following describes the former sibling website, not verification of the replacement `site/` build:

Focused tests cover document hashes, changed-document prompts, dual confirmation, legacy settings, hydration failure, imported recovery keys and stale/background reads. App iOS/Android type checks passed in the implementation review. Website legal and release-availability tests pass; the full client/SSR/prerender build passes. Website-wide TypeScript still reports existing errors outside these changes, including FAQ and shared UI components; this is not a clean whole-site type-check claim.

The independent delivery review found that Nginx needed to resolve prerendered `$uri/index.html` before the root SPA fallback, and that defect was corrected before merge. A local Nginx HTTP check verified every legal paragraph without JavaScript and reproduced failure with the old configuration.

Website commit `4bb2214914b0096d38878bf1524571b35b4f80fb` was merged and pushed to `origin/main` on 10 September 2026. Railway automatically started deploying that commit. Live delivery verification is pending deployment completion; successful local builds alone do not establish the live website's revision. No production app build, store submission, Freedom Store PR or app release was triggered by this work.

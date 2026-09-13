# Feature sweep review — 13 September 2026

This is the request-to-implementation inventory for PR #268. It separates source
and automated checks from native/device evidence. Prior session decisions were
reconciled against the working code: public client-signed Vertex with shared
caching replaces self-hosting; Favourites means Mint Reviews; updates are optional;
backup verification checks every word; one artwork pipeline owns all formats.

## Corrections in this pass

- Optional **Please update** with close, swipe and back; reminders are scoped to
  the advertised version. The registry still supports explicitly forced prompts.
- Search and profile fallbacks now request Vertex enrichment without losing
  existing names, pictures, counts or search hits on refresh failure.
- Avatar uploads require native re-encoding even for GIF/unknown inputs; failed
  decoding stops upload. Native byte-level metadata verification remains separate.
- Relay/cache pagination continues after short pages if their cursor advances;
  explicit exhaustion and repeated cursors still stop it. A live Primal profile
  probe returned bundled likes/replies/reposts/zap counts; profile adapter tests
  preserve them. A raw relay alone does not provide authoritative aggregate counts.
- NFC diagnostics no longer emit bearer-token APDU hex or untrusted native error
  text; malformed NLEN/chunk lengths fail before parsing.
- The native harness inventory now includes 141 scenarios/245 platform pairs;
  outdated count pins, filter selectors, and CTA AX checks were corrected.
- The tracked development launcher uses the current checkout and forwards Expo
  options. The example environment now uses the shared Nagg deployment.
- Wallet demo currencies are presentation-only. Real payment unit/mint selectors
  retain live capabilities. Removed carousel pages no longer reserve blank space.
- Tall artwork pack/triptych layouts use more of the canvas. Recovery copy avoids
  promises of complete funds/message restoration. Phone status bars are retained.

## Backend verification

Nagg `v2` commit `7e7410f` deployed successfully to the authorized Railway project
`23bebc10-9b29-4edd-aae8-5d0a3850b306`, environment
`e264a196-34e8-4ebc-b80b-9bfd7eb4657b`. No other project was queried.

- `/app/latest-version` advertises `0.1.3`; no forced minimum is configured.
- `/app/rates` gives each provider one vote and rejects large two-provider
  disagreement. Response caching no longer extends expired snapshots. USD/EUR
  have a Nostr source plus mempool; GBP remains explicitly single-source.
- All 12 curated models exist in the active Routstr fallback's model catalog.
  A paid streaming completion/refund was not exercised in this review.
- Both ucash auditor functions and the legacy auditor responded successfully;
  discovery includes Sovran mint data and ucash uptime. Wallpapers respond live.
- Public Vertex uses client-signed requests and shared caching, with no server
  private signing key. The service runs `mint,app,vertex`, restricted event kinds
  and info-level logs. Scores still depend on upstream availability and credits.
- Go suite and focused race tests passed before deployment; live rates responses
  after deployment show independent-provider confidence and no response-cache hit.

## Checklist census

| Requested outcome | Source / tests present | Status / important limit |
|---|---|---|
| Kind-0 name/PFP editor, HTTPS URL, local file, optimistic update | SettingsEditProfileScreen, publishOwnProfileMetadata; settingsEditProfile, publishOwnProfileMetadata, ownProfileMetadataStore tests | Present and targeted tests pass; avatar metadata bypass fixed. Real relay publish/upload and native metadata-byte audit still needed. |
| Recovery polish, hide benchmark controls | SettingsRecoveryScreen showDevControls = experimental && !gateMode; settingsRecoveryGateConfirmation | Present; forced recovery never shows controls. Experimental developer mode retains diagnostic controls. |
| Seed recovery on retained Keychain / failed Android Keystore | secureStorage, AppGate, keyRecovery, profileSessionOrchestrator; appGateReinstallDetection, secureStorageLifecycle, nostrKeysImportedFallback, appGateRecoverySession | 15-suite security/profile/AI set passes. app/docs/reinstall-recovery.md explicitly states native reinstall/backup scenarios unverified and Android manifest change requires new binary. |
| Every seed word backup verification, old opt-out no longer suppresses new flow | BackupFlowProvider, verifyPlan, BackupVerifyScreen/DoneScreen; backupFlow, backupVerifyPlan, ctaPersistence/Selection | Present: all 12 positions, revision 2, demo cannot certify, background/unfocused hides words, direct done route guarded. No screen-capture prevention dependency; do not claim screenshot blocking. |
| Optional prompt modals and queue | CtaScreen, CtaHost, CTA_DEFINITIONS, modalScreens; ctaScreen/Host/Selection/Persistence | Fixed and 55 tests pass. Native gesture verification still outstanding. |
| Image momentum dismissal | image-overlay/dismissDecision + AnimatedImageOverlay; imageOverlayDismissDecision | Present; parent independently reviews. |
| Following/account switch menus and long profile lists | ActionMenuHost, MenuScrim, actionMenuHandoff | Present; parent independently reviews. No reproduced rare-device guarantee. |
| Mint info top polish/status icon | MintInfoScreen/MintIcon; mintInfoScreenSource, avatarStatusDot | Present; targeted source test passes. Visual quality requires screenshots. |
| Transaction filter styling | FiltersScreen; filtersScreen tests | Present; tests pass. |
| DM loading geometry, adaptive marquee header | ChatScreen, MarqueeText; chatScreenLoading, marquee, marqueeText | Present; tests pass. Native long-text/large-font motion still requires device validation. |
| DM message avatar and ecash bubble margins | ChatScreen, CashuTokenBubble; chatScreenAvatar, cashuTokenBubbleGeometry | Present; tests pass. |
| Send-via recommendation based on last inbound message | sendMessageRecommendation, dmLastMessageStore; sendMessageRecommendation/Menu | Present; tests pass. |
| Received-this-month sats clipping | MonthlyChart; MonthlyChart tests | Present; tests pass. |
| Drawer gesture exclusion when deeper page open | drawerGesture; drawerGesture tests | Present; parent independently reviews. |
| Waterfall infinite feed, dedupe, following/recent/popular | nostr feed-pager, facadeFeedClient, HomeFeed | Present; parent independently reviews cursor/failure behavior. Relay history remains finite/provider-dependent. |
| Story captions/video pause interactions | StoryCaption, StoriesCarousel, storyCaption; storiesCaption/storyCaption tests | Present; tests pass. Native gesture/video animation proof outstanding. |
| Notifications Apps legal acceptance | appNotificationRows, NotificationsScreen; appNotificationRows | Present; tests pass. |
| Routstr submit, lineup drift, scroll | useAiSend, routstr API + refreshLineup, AiChatScreen; aiSendRecovery, routstr402BalanceSync, routstrChangeHeader, routstrLineupRefresh, aiChatScroll | Present; tests pass. app/docs/diagnostics/routstr-client.md explicitly preserves manual paid-stream/restart/refund checks. Backend agent owns live upstream/catalog validation. |
| Media settings separate PFP management | SettingsMediaScreen avatar/post split; mediaServerStore, ownedMediaStore | Present; tests pass. Default Blossom is blossom.primal.net, configurable per profile. |
| Vertex score shown on search and profile | searchProfiles, useNostrProfile, profile metrics, contact rows | Missing fallback refresh fixed. Backend agent verifies service/credit availability; scores are not guaranteed when provider unavailable/budget/consent disables reads. |
| Profile NIP-05 late-load shift | UserProfile identity row; userProfileIdentityRow | Present; tests pass. |
| Profile feed engagement counts | UserFeed/facade/loadUserFeed changes | Reviewed in the final pass. |
| Numo multi-unit NFC and preferred vs required | wallet machine changes and app/patches/README.cashu-mints-preferred.md | Backend agent owns NFC/parser review. Preferred receiving intentionally disabled: current durable claim cannot safely accept unknown/unlisted mint. Must not call this full preferred receive implementation complete. |
| Onchain discovery currency wording/filter | MintCurrencyTabs, useMintSearchMapper, availableCurrencies | Present; parent reviews receive/onchain flows. |
| Token-copied emoji timing | AnimatedEmoji preload; animatedEmoji tests | Present; tests pass. |
| Favourites page polish | Prior clarified decision maps to MintReviewsScreen/RatingStars/RatingBarChart | Present; mintReviewsScreen tests pass. Parent confirms prior Claude decision. |
| BIP-321 rails and switches below copy | receiveRailPresentation, bip321 rail selection integration | Present; parent independently reviews. |
| Settings content shift | SettingsScreen; settingsScreen tests | Present; tests pass. |
| App latest-version fetch / prices through nagg / no sovran API | backendConfig/apiClient/pricelistFeed changes | Parent/backend agent owns live config and remaining Sovran API audit. |
| Artwork variants, phone chrome, Artemis wallpaper and mock currencies | marketing/artwork and mocks | Artwork agent owns review/implementation; no validation claim from this agent. |
| Main local dev checkout / open PR / passing complete gates | Parent owns checkout mapping, full test/lint/typecheck/knip, PR/push | Not completed by this agent. |


# Optimizer ledger

Machine-maintained by `bun run optimize`. Humans edit only statuses
(`wontfix`) and the Never-flag list.

## Never flag

(none yet)

## Coverage log

| Date | Lenses | Scope | Evidence |
| --- | --- | --- | --- |
| 2026-07-31 | content-shift, nostr-efficiency, lists-media | notifications (feat/notifications-unified), feed/thread surfaces, cashu DM transport + tier waterfall | log-doctor renders/perf/spans/waste/tiers/stats/visual/shift-timeline on latest log.txt session (idle segment + interactive segment) — full report: [reports/2026-07-31.md](reports/2026-07-31.md) |
| 2026-07-31 | render-perf, state-machines, startup-memory | standing background services (coco subscriptions, NPC sync, pricelist, image prefetch), entry chain, wallet home/transactions, mint list, PaymentMachine + app seam | log-doctor stats/renders/perf/waste/coco/gc/startup on latest session (68-min idle; no cold-launch waterfall, no Hermes gc data) — full report: [reports/2026-07-31-2.md](reports/2026-07-31-2.md) |
| 2026-07-31 | animations, keyboard-focus, dismiss-parity | app-wide interaction surfaces (composer, onboarding, mint add/list, settings network, theme flow, transactions timeline, thread reply) | log-doctor perf/timeline/errors on 40MB tail of latest session; keyboard/dismiss lenses static-only (no keyboard/dismiss instrumentation) — full report: [reports/2026-07-31-3.md](reports/2026-07-31-3.md) |

## Findings

| Fingerprint | Status | Sev | Date | Title |
| --- | --- | --- | --- | --- |
| nostr-efficiency/shared/lib/cashu/paymentRequestNostrTransport.ts#pollOnce-no-cursor | open | P0 | 2026-07-31 | DM poll refetches identical 50-envelope page every 15s (no cursor, refresh:true defeats all caching) |
| nostr-efficiency/shared/lib/cashu/paymentRequestNostrTransport.ts#poll-lifecycle | open | P1 | 2026-07-31 | DM poll runs forever after first Receive visit — no backoff, no AppState gating |
| content-shift/features/feed/hooks/useThread.ts#cachedThreadSeed | open | P0 | 2026-07-31 | Thread cache seed applied post-commit — full skeleton frame on every cached-thread revisit |
| content-shift/features/feed/components/nostr/image-overlay/ImageBlock.tsx#aspectRatio | open | P0 | 2026-07-31 | aspectRatio lazy init never re-runs on FlashList recycle — settled notes resize on onLoad |
| lists-media/features/feed/data/facadeNotificationsAdapter.ts#resolvedNotificationsToResult | open | P1 | 2026-07-31 | Every notifications session update mints all-new item objects — all mounted rows re-render, even on invisible pool-count changes |
| content-shift/features/feed/components/nostr/NoteContent.tsx#QuotedPostCard | open | P1 | 2026-07-31 | Quoted-post chip swaps to full card with no reserved space (cold loads / missing page-0 quotes) |
| nostr-efficiency/shared/lib/cashu/paymentRequestNostrTransport.ts#poll-timeout | open | P1 | 2026-07-31 | DM poll inherits 30s default timeout on a 15s cadence; sequential tier engine stalls fallback |
| content-shift/shared/lib/contentShiftLog.ts#overlap-analysis | open | P2 | 2026-07-31 | Visual-mode overlap/orderBreak analysis compares stale rects and truncates keys to 18 chars — manufactures phantom duplicate keys |
| startup-memory/shared/lib/cashu/manager.ts#subscriptions-config | open | P1 | 2026-07-31 | Coco Manager built without subscriptions config + pause API unused — post-WS-drop 5s HTTP polling for life of pending state, no AppState gating |
| startup-memory/shared/lib/cashu/npc.ts#sync-interval-gating | open | P1 | 2026-07-31 | NPC sync 25s interval re-arms unconditionally even with healthy websocket; never AppState-paused; plugin pause API unused |
| render-perf/features/mint/screens/MintListScreen.tsx#renderItem-identity | open | P1 | 2026-07-31 | isExecuting flips churn renderItem/extraData identity — every visible mint row re-invoked with fresh MintIdentity; ContactRow effect keyed on raw object refires |
| startup-memory/features/whitenoise/WhitenoiseProvider.tsx#eager-marmot-import | open | P2 | 2026-07-31 | marmot-ts (ts-mls + hpke) evaluated at every launch via unconditional root-provider import; instantiation lazy, module eval not |
| state-machines/wallet/src/machine/createMachine.ts#reset-mid-commit-metadata | open | P2 | 2026-07-31 | Reset landing mid-commit skips machine-callback metadata bridging (scan link, geotag, PR payer-role annotation) — payment record/toast safe via coco events |
| dismiss-parity/features/theme/screens/ThemePreviewScreen.tsx#draft-discard-button-only | open | P1 | 2026-07-31 | Theme draft discard wired to Cancel button only — gesture dismissal leaves dirty draft active; reopen resumes abandoned edits as pending changes |
| keyboard-focus/features/composer/ui/PostComposer.tsx#alt-text-modal | open | P1 | 2026-07-31 | Alt-text editor: RN Modal + autoFocus input with no in-Modal keyboard avoidance; backdrop tap silently discards typed text |
| keyboard-focus/shared/ui/composed/ModalLayoutWrapper.tsx#keyboard-blind-scroll-footer | open | P1 | 2026-07-31 | Shared scroll container + BottomButtons footer keyboard-blind (no persistTaps, no sticky footer) — ClaimUsername onboarding exemplar: swallowed first tap + occluded Continue |
| keyboard-focus/features/mint/screens/MintAddScreen.tsx#search-list-persistTaps | open | P1 | 2026-07-31 | Mint search results list lacks keyboardShouldPersistTaps under autoFocus search — first tap on a result only dismisses the keyboard |
| keyboard-focus/features/settings/screens/SettingsNetworkScreen.tsx#add-relay-form | open | P2 | 2026-07-31 | Add-relay form in plain ScrollView: no persistTaps, no keyboard-aware wrapper, submit button occluded (Done-key submit is the only clean path) |
| animations/features/mint/components/MintCurrencyTabs.tsx#layout-prop-collapse | open | P2 | 2026-07-31 | Scroll-linked collapse animates six layout props incl. fontSize per frame (confined to first 50px band; small subtree) — transform-based collapse would be layout-free |

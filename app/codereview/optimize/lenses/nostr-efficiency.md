# Lens: Nostr data-layer efficiency

Scope: `nostr/src/` (tiers, recipes, transport, facade), `features/feed/data`,
DM/gift-wrap handling, profile hydration. Architecture context: REST via the
nagg indexer is the primary read path; relays serve live data, DMs, and
fallback tiers (`nostr/src/tiers/`). Load `sovran-feed`. Dedup work already
exists — your job is what it *misses*, not re-describing it.

## Redundant fetch

- **REST-vs-relay double fetch**: the same note arriving via a REST recipe and
  a live subscription needs id-keyed dedup at the shared store boundary.
  Detect: separate ingestion paths writing to state without a common
  id-keyed upsert.
- **Refetch without windowing**: pull-to-refresh / foreground-resume should
  send `since: lastSeen` (small overlap for clock skew), not re-issue the
  original window. Detect: refresh paths reusing the initial filter/recipe
  params verbatim; missing high-water marks.
- **Per-row fetch amplification**: profile/reactions/zap counts fetched
  per-note from relays when REST aggregates exist. Detect: relay queries
  inside list-row hooks; kind-0 fetches not batched
  (`{kinds:[0], authors:[…]}` or dataloader-style debounce).
- **Replaceable events**: kinds 0, 3, 10002, 3xxxx — keep max-`created_at`
  only; multiple relays return divergent "latest". Detect: store writes
  overwriting replaceables without a `created_at` compare.
- **NDK grouping defeated**: `groupable:false`/`groupableDelay:0` on feed or
  profile subs without justification; components each opening near-identical
  filters at mount instead of piggybacking.
- Repeated identical requests are directly measurable:
  `log-doctor waste --min-repeats 3` — treat its signatures as ground truth.

## Subscription lifecycle

- Every subscribe needs an owner and a stop: `ndk.subscribe`/`subscribeMany`
  in a component or hook without `.stop()` in effect cleanup leaks; subs
  created in event handlers or module scope need an explicit lifecycle owner.
- One-shot reads (thread backfill, profile hydrate) want `closeOnEose:true`;
  a long-lived sub whose filter has a past `until` or fixed `limit` is a
  one-shot leaking as a stream.
- Bounded filters only: every REQ needs `ids`/`authors`/tags or
  `since`+`limit`. `{kinds:[1]}` unbounded invites a firehose.
- Handlers attach at subscribe time (`onEvent`/`onEvents`/`onEose` options) —
  `sub.on('event', …)` after creation races the synchronous cache hit, and
  cached events arrive as one `onEvents` batch, not per-event.
- **Backgrounding**: on `AppState` background, pause; on foreground,
  reconnect with backoff + jitter and resubscribe live filters with
  `since=lastEvent` — not all historical filters from scratch. Reconnects must
  be NetInfo-gated (no retry storm in airplane mode). Detect: absent AppState
  handling around transport; retry loops without backoff.
- Relay URL normalization: `wss://relay.x/` vs `wss://relay.x` duplicates
  connections. Detect in transport/pool code.

## CPU cost

- **Signature verification is the top CPU line in nostr clients.** Verify off
  the JS thread or sample per-relay (NDK `signatureVerificationWorker`,
  validation ratios); never re-verify events already persisted/cached, and
  don't verify events from the trusted nagg REST path. Dedup by event id
  **before** verify/parse/store — cross-relay duplicates are the common case.
- Gift-wrap DMs: every kind-1059 costs two NIP-44 decrypts and can't be
  filtered by sender. Persist decrypted rumors keyed by wrap id (never decrypt
  twice), decrypt off the UI thread / in idle chunks, resubscribe with a
  persisted high-water mark — remembering wrap timestamps are randomized up
  to 2 days back, so overlap the `since` window. Sorting DMs by wrap
  `created_at` instead of rumor timestamp is a correctness bug.
- Parse once at ingest: `JSON.parse(event.content)` (kind-0 metadata!) or tag
  parsing inside render/selectors/memo bodies = repeated work per frame.
  Detect: parse calls in components rather than the ingest path.
- Kind-5 deletes and replaceable supersession handled once in the store
  layer, not per-consumer.

## Evidence

```bash
npx tsx codereview/log-doctor/index.ts waste --latest --min-repeats 3
npx tsx codereview/log-doctor/index.ts tiers --latest
npx tsx codereview/log-doctor/index.ts network --latest
rg -n "subscribe\(" nostr/src features/feed --type ts -A 2
rg -n "closeOnEose|groupable" nostr/src features
rg -n "JSON\.parse" features/feed nostr/src
rg -n "AppState" nostr/src shared
rg -n "verifyEvent|verifySignature|validation" nostr/src
```

## Do not flag

- The tier fallback architecture itself (deliberate; `tiers/audit.ts` exists).
- nagg server-side behavior — separate repo, separate review.
- The 255-byte DM cap / bitchat transport constraints (by design).

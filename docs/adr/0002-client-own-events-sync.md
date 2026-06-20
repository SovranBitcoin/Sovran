# 2. Client-side own-events relay sync owns viewer-state

Date: 2026-06-20
Status: Accepted (supersedes ADR 0001's "viewer-state belongs in nagg")

## Context

ADR 0001 recorded that authoritative viewer-state (did *I* like / repost / quote
/ reply; do I follow this profile) should come from nagg app-view payloads. On
reflection we want the opposite: viewer-state should be **relay-direct and
client-owned**, not routed through nagg. nagg carries only aggregate counts
today; per-viewer state from nagg would need new schema + a ClickHouse pivot,
and would still lag our own optimistic actions.

Before this change, own-state was learned **scattered and incompletely**:
- likes/reposts: per-screen subscriptions scoped to on-screen `eventIds` (no
  global index — couldn't answer "did I like X" off-screen);
- follows (kind:3): fetched only when you opened your own profile;
- profile (kind:0): a one-shot boot sync;
- replies: not tracked at all.

## Decision

Add **`useOwnEventsSync`** — one long-lived, app-level relay subscription for all
our own events `{ authors:[me], kinds:[0,1,3,5,6,7] }` — as the single owner of
"keep my own state synced". It does **not** use nagg. A pure `partitionOwnEvents`
splits the batch and dispatches each kind into its existing **canonical store**:

- kind 0 → `profileStore` metadata
- kind 3 → `nostrSocialStore` contacts/follows (+ settle follow optimism)
- kind 1 → `ownContentStore.ingestSeen` + reply e-tags → `repliedByEventId`
- kind 6/7 → `nostrSocialStore` global-upsert likes/reposts
- kind 5 → `nostrSocialStore.applyOwnDeletions`

The two stores stay **separate** (clean domain split: authored content vs
engagement/social graph); the sync feeds both — no third store. The canonical
engagement maps gain a **recency cap** (the sync can backfill thousands of
events) and a new **`repliedByEventId`** index for the "you replied" highlight.
`useNostrEngagement` drops its per-screen subscription and reads the now-global
store (keeping the optimistic toggle). The profile-screen kind:3 sub and the
boot kind:0 sync are removed (subsumed).

## Consequences

- Viewer-state is correct for any post the sync has covered — not just on-screen
  ones — and never depends on nagg or a live per-screen sub.
- One subscription replaces three scattered ones (a reuse/consolidation win).
- Bounded: a backfill window + recency-capped compact indices keep storage and
  rehydrate bounded; engagement older than the window/cap won't highlight (rare).
- The nagg viewer-state work (ADR 0001) is **dropped**.

## Alternatives considered

- **nagg viewer-state (ADR 0001)** — cross-repo, lags optimistic actions, and
  still needs client reconciliation; superseded.
- **Keep per-screen subs** — leaves the off-screen gap and duplicate subs.
- **Merge the two stores** — rejected; incompatible lifecycles/retention.

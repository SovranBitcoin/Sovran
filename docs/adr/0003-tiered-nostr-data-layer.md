# 3. Resilient three-tier Nostr data layer behind one nagg-ts facade

Date: 2026-06-20
Status: Accepted (supersedes ADR 0002's seeding mandate; keeps its store-authority mandate)

## Context

Every Nostr read in the app reaches the network through ad-hoc, surface-specific
paths: `naggFeedClient` branches between a REST app-view and a GraphQL fallback
inline; own-state comes from one hardcoded relay subscription (`useOwnEventsSync`,
ADR 0002); mint reviews have two unrelated read paths (colada GraphQL and a
raw-NDK discovery hook); DMs, notifications, and the social graph each assemble
events their own way. Each surface knows about transport, picks relays, and
validates (or fails to validate) on its own. There is no graceful degradation: if
nagg is unavailable a surface simply breaks rather than falling back.

We want to honestly advertise the product as decentralised while keeping the
nagg-first UX when things work. Three independently-operated sources exist:

- **nagg** — our own app-view (we run it): fully bundled, ranked, gold UX.
- **Primal cache** — Primal runs it; we build only a client adapter. "Almost as
  good" (server-owned algo feeds, bundled responses, ordering manifest).
- **raw relays** — many operators: "a bit rough" but functional; the honest floor.

## Decision

Make `@sovranbitcoin/nagg-ts` the single, opinionated **facade** for every Nostr
read. It is expressed in sovran-app domain terms (feed, thread, notifications,
conversations, social graph, own viewer-state, mint reviews) and internally
selects the best available tier — **nagg → Primal → raw relays** — with fallback,
bundling, ordering, Zod validation, dedupe, and cache-write all hidden inside it.
**Callers never choose a tier or assemble events.** The one explicit exception is
live listening (the "Load new" seam), where a caller may ask for a relay
subscription for genuinely-new items.

Structural commitments (the shared contract lives in `@sovranbitcoin/schemas`
`nostr-data-layer.ts`):

- **One enriched bundle per read** — notes + author profiles + aggregate stats
  + optional per-viewer action overlay, joined client-side by id.
- **Viewer-INDEPENDENT counts (`NoteStats`) stay separate from the per-VIEWER
  overlay (`NoteActions`)** — counts are cacheable and shared; the overlay is not.
- **Server-authoritative `OrderingManifest`** — the client renders strictly by an
  ordered id list, a structural defense against the list reshuffling. The relay
  floor synthesizes one from a stable sort key.
- **One Zod parse per tier at ingest**, inside nagg-ts — no tier can corrupt the
  shared cache, and app code never validates raw events.
- **Calm streaming** on the relay floor (settle window + stable-sort insert +
  resolve-on-EOSE) so even the roughest tier delivers a coherent set, not a
  reshuffling stream.

GraphQL is retired once the REST `/nostr/thread` app-view reaches ranking parity
(`authoredReplyChain` + `rankedReferencedBy`) — the one remaining GraphQL-only
surface.

### Relationship to ADR 0002

ADR 0002 stands where it said the **local store is authoritative** (optimistic
last-writer-wins, the store is the merge target). What this ADR changes is the
**seed/backfill source**: instead of a hardcoded relay subscription, own
viewer-state seeds from the tiered facade (`getOwnHistory`, lazy cursor paging).
The relay subscription survives as the bottom tier and the live-delta listener,
merged through the same LWW gate so a facade backfill and a relay delta cannot
fight.

## Consequences

- App + colada code shrinks: a screen asks for a ready-to-render result and never
  branches on transport. The `naggFeedClient` transport fallback moves down into
  nagg-ts and gains the Primal + relay tiers.
- Graceful degradation everywhere, with honest, accepted ceilings: For-You and
  grouped notifications degrade on raw relays; the cache tier can't per-peer-bucket
  NIP-17 DMs (the sender is sealed); Primal can't list my-likes / my-reposts.
- The fragmented engagement stores consolidate into a viewer-independent stats
  store and a single authoritative per-viewer overlay, fed identically regardless
  of which tier answered.
- Backend work (nagg): REST thread parity, an ordering manifest, paginated
  own-events read endpoints + by-author indexes, a 1059-by-`#p` DM index, and a
  per-mint NIP-87 aggregate. These land first as prerequisites.

## Alternatives considered

- **Keep transport-branching in the app, nagg-ts stays transport-only** —
  rejected; it re-leaks transport into every surface and forces colada to
  duplicate fallback logic. The facade-owns-tiers design keeps callers trivial.
- **One combined record carrying counts + viewer-state** — rejected; conflates
  cacheable viewer-independent counts with per-viewer state, breaking the shared
  cache and reintroducing reshuffle when counts update.
- **Two tiers only (defer Primal)** — considered; the Primal adapter is pure
  client code (Primal operates the server) with no infra cost, so all three tiers
  ship together for a real second tier and a stronger decentralisation story.

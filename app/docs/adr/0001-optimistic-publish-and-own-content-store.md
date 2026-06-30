# 1. Optimistic publishing, a local own-content store, and viewer-state ownership

Date: 2026-06-20
Status: Accepted

## Context

Posting felt slow. The composer awaited `resolveOn: 'all-settled'` and kept the
UI blocked until the *slowest* relay either acknowledged or exhausted the full
retry budget (10s/relay × up to 3 rounds). Publishing was already parallel with
warm connections — the cost was waiting for everyone, not serial writes.

Separately, the app had no local record of the notes we authored. A just-posted
note wasn't readable until it round-tripped through relays/nagg, so a thread
opened to it could show "Post not found", and there was no fast "View" affordance
after posting. Cross-cutting viewer-state (did *I* like/repost/quote/reply; do I
follow this profile) was computed entirely client-side from relay subscriptions.

## Decisions

1. **Optimistic publishing.** Add a third publish-seam mode, `optimistic`:
   resolve the caller the instant the first relay accepts (so the composer can
   dismiss), and finish the fan-out + retries in the background. If the first
   round accepts nowhere, resolve `all-failed` immediately so the composer stays
   open with the draft intact — and abandon the background work (no zombie
   publish for a post the user will retry). The seam guarantees its returned
   promise always settles (a throw in the background resolves `all-failed`).
   `first-ok`/`all-settled` behavior is unchanged; replaceable lists (kind:3,
   kind:10002) and polls keep `all-settled`.

2. **Local own-content store.** Introduce `ownContentStore`, a per-profile,
   persisted, `event.id`-keyed cache of own kind:1 notes. It is recorded
   optimistically on publish, reconciled by exact id (a signed note already
   knows its id), and read as a note-by-id fallback by the thread reader so
   "View" opens instantly and "Post not found" is fixed for own content.
   Cross-client convergence is **passive**: own notes the app already encounters
   (feed/thread reads) are ingested — no dedicated always-on subscription.

3. **Viewer-state belongs in nagg (future).** The authoritative source for
   per-viewer engagement/follow state should be nagg app-view payloads across
   feed/thread/profile endpoints (the viewer pubkey is already passed), reducing
   reliance on client relay subscriptions. This is scoped as a separate nagg
   repo change, not part of this app-side work.

## Consequences

- Posting feels instant; a slow/dead relay no longer blocks the UI.
- A just-posted note is locally viewable; the post toast's "View" opens its
  thread with no relay round-trip.
- A failed publish leaves no phantom (the optimistic entry is removed).
- The store is bounded (FIFO cap on `confirmed`, grace age-out for `local`) and
  profile-isolated (scoped storage + per-entry author filter).
- Viewer-state still comes from relay subscriptions until the nagg work lands;
  this ADR records the intended direction so the two don't diverge.

## Alternatives considered

- **Switch the composer to `first-ok`** — fast, but drops the wide fan-out notes
  need; rejected in favor of `optimistic` (first-ok responsiveness *with*
  background reach).
- **Generic note-by-id cache for all notes** — larger, riskier feed-wide
  refactor; deferred. The store is scoped to own content, where the value
  (instant View, no relay dependency) is highest.
- **Dedicated own-notes subscription** — eager convergence at the cost of an
  always-on subscription; rejected for passive ingest, which matches "store what
  we already see".

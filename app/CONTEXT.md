# Context — sovran-app glossary

Canonical domain terms for this app. Glossary only — no implementation
details, no specs. Add a term the moment it's resolved; keep entries short.

## Amount entry

**Amount tint** — the color of the large amount number on the amount-entry
surface. Encodes the _validity_ of the entered amount, **not** the transaction
direction: neutral foreground on send and receive alike, red only in a genuine
problem state. In the fiat path the typed digits take the full tint and the
unfilled decimal prefill ("00") is dimmed.

**Notice** — the transient, danger-tinted line shown directly under the amount
when the entry can't proceed (e.g. "Insufficient balance"). Derived from the
disabled-`Next` reason. The Amount tint turns red in lockstep with a Notice.

**Warning** — the persistent, warning-tinted disclaimer under the amount (e.g.
the Nut-Drop "sent over public mesh, anyone can claim" note). Distinct from a
Notice: a Warning is an always-on caveat, not a condition-driven error.

**Genuine problem state** — an amount-entry condition where input is present
but the amount cannot proceed (insufficient balance, out of range, or it
**exceeds the spendable balance**). Surfaced as a Notice and/or an
`exceedsBalance` signal from the payment engine, and mirrored by a red Amount
tint. Distinct from merely-incomplete input (empty field), which stays a
neutral placeholder.

**exceedsBalance** — an amount-entry signal from colada: the entered amount is
larger than the spendable balance. Needed because an over-balance ecash send
still resolves (it rounds down to the balance) and so produces no blocking
Notice — only lightning, which can't round down, would otherwise reveal the
shortfall. Drives the red Amount tint independently of a Notice.

## Publishing & own content

**Publish seam** — `shared/lib/nostr/publish/publishEvent.ts`, the single path
every Nostr write routes through. One engine (`fanOut` over `publishRound`),
three `resolveOn` modes.

**resolveOn modes** — `first-ok` (resolve once any relay accepts, then stop),
`all-settled` (run the full retry budget for widest reach; replaceable lists),
`optimistic` (resolve on the first accept, finish fan-out + retries in the
background).

**Assured vs settled** — _assured_ = delivery is guaranteed (first relay
accepted) and the UI may proceed; _settled_ = the full background fan-out
(retries + recipient relays) has finished. Optimistic publishing resolves the
caller at _assured_ and continues to _settled_ in the background.

**Background / recipient (outbox) relays** — a mentioned user's NIP-65 read
relays. They need a network lookup, so they're resolved off the critical path
and folded into the background fan-out via `PublishOptions.backgroundRelays`.

**Own content** — notes/replies/quotes (kind:1) authored by the active profile,
held in `ownContentStore` (`shared/stores/profile/ownContentStore.ts`): a
per-profile, persisted, id-keyed local cache. Serves instant "View" of a
just-posted note and a note-by-id fallback for the thread reader.

**Status (pending → local → confirmed)** — `pending`: publish in flight;
`local`: delivery assured but not yet echoed back by a relay/app-view;
`confirmed`: seen from a relay/app-view. A failed publish is removed (no phantom).

**Settle-by-id** — own content reconciles by exact `event.id` (a signed note
already knows its id), so a relay echo is the same key — no timestamp/content
heuristics, unlike engagement state.

**Passive ingest** — recording own kind:1 notes the app already encounters
(feed/thread reads) into `ownContentStore`, giving cross-client convergence
without a dedicated always-on subscription. Seam: `ingestOwnContent`.

**Viewer-state** — a viewer's relation to a post (did _I_ like / repost / quote /
reply; do I follow this profile). The local store stays authoritative (optimistic
LWW, ADR 0002), but its **seed source** is now the tiered facade, not a hardcoded
relay sub — see **tiered facade** and ADR 0003 (which supersedes ADR 0002's
relay-only seeding while keeping its store-authority mandate).

**Own-events sync** — `useOwnEventsSync` (`shared/lib/nostr/ownsync/`): one
long-lived app-level relay subscription for all our own events
`{ authors:[me], kinds:[0,1,3,5,6,7] }` that hydrates the canonical own-state
stores so they're authoritative everywhere. The single owner of "keep my own
state synced"; replaces the former per-screen engagement subs, profile-screen
contact sub, and boot kind:0 sync. `partitionOwnEvents` is the pure routing.

**Global upsert** — `nostrSocialStore.ingestOwnLikes/Reposts/Replies`: merge our
own engagement keyed by target, newest-per-target, recency-capped
(`MAX_ENGAGEMENT_ENTRIES`). Unlike the removed scoped `syncLikesFromRelay`, it
never deletes by an on-screen target set; deletions come via `applyOwnDeletions`
(our kind:5). The canonical maps are the source of truth, overlaid by optimistic
toggles.

**Replied index** — `nostrSocialStore.repliedByEventId` (target id → our reply):
drives the "you replied" comment-icon highlight, populated from our own kind:1
reply e-tags by the own-events sync.

## Tiered Nostr data layer

**Tiered facade** — `@sovranbitcoin/nagg-ts`, the single opinionated entry point
for every Nostr read. Expressed in app domain terms (feed, thread, notifications,
conversations, social graph, own viewer-state, mint reviews); internally selects
the best available **tier** and hides fallback, bundling, ordering, validation,
dedupe, and cache-write. Callers never choose a tier or assemble events. See
ADR 0003.

**Tier** — one of three independently-operated read sources, tried in order:
**nagg** (we operate; gold, fully bundled + ranked) → **Primal cache** (Primal
operates, we build only a client adapter; almost as good) → **raw relays** (many
operators; the rough-but-functional floor). A tier that can't answer a given read
returns `unsupported` and the facade falls through to the next.

**Bundle** — one enriched response per read: notes + author profiles + aggregate
stats + (optionally) the per-viewer action overlay, joined client-side by id.
Replaces N round-trips with one batch.

**NoteStats vs NoteActions** — the load-bearing split. **NoteStats** = viewer-
INDEPENDENT aggregate counts (likes/reposts/replies/zaps), cacheable and shared
across viewers, held in the stats store. **NoteActions** = the per-VIEWER overlay
("which of THESE did I like/repost/…"), never cacheable across viewers, held in
the single authoritative viewer-state store. Adding a new engagement type is a
field on each, not three new maps.

**Ordering manifest** — a server-authoritative ordered id list (`FeedRange`
style) returned alongside the unordered bundle. The client renders strictly by it,
index by index; ids absent from the manifest aren't rendered. A structural defense
against the list reshuffling under your thumb. The relay floor synthesizes one
from a stable sort key (created_at).

**Live seam** — the ONE place a caller explicitly asks for relays: a listener that
surfaces a "Load new" pill for items newer than the current page (feeds-recent,
follow deltas, own-state deltas). nagg owns history/pagination; the listener only
cares about items newer than the page, never backfill.

**Own-history endpoints** — the paginated nagg own-events read family (authored,
replies, likes, reposts, zaps-sent, bookmarks, follows, mutes, relays), cursor =
`(created_at, id)`, lazy paging. Seeds the viewer-state store on cold start and
lets the user scroll back past the local cap. nagg is the only tier that covers
all action types; Primal lacks my-likes / my-reposts, so those fall through to
relays.

**Seen state** — one timestamp "seen-up-to" published as a NIP-78 kind-30078
app-data event so it syncs across devices via relays AND is readable on the
backend-free relay tier. Unread = `count(created_at > seenUntil)`.

## Thread reading

**Thread anchor** — the tapped/focused note a thread opens on. It stays visually
fixed while the parent chain prepends above it (the T1 full-thread update) and
replies append below. Achieved by `initialScrollIndex` (land on the note) +
`maintainVisibleContentPosition` (bare → `{ data: true, size: true }`: `data`
compensates the parent prepend, `size` absorbs measurement reconciliation) +
the **focus reserve**. The thread never auto-pins to the bottom — it omits the DM
`ChatScreen`'s `initialScrollAtEnd` / `alignItemsAtEnd` / `maintainScrollAtEnd`.
See ADR 0004.

**Focus reserve** — `focusReserve`: extra `paddingBottom` the thread adds so the
focused note can be scrolled to (and held at) the top. mVCP's prepend
compensation is clamped at the max scroll offset, so without room below, a short
thread drops the note when parents load, the scroll snaps, and the note can't be
refocused. The reserve = `viewport − (rows below the note × approx height)`,
shrinking to 0 as replies fill the screen. Owned in `ThreadView` (not the
library's opaque `anchoredEndSpace`) so it's deterministic and logged
(`thread.reserve`). See [[Thread anchor]] and ADR 0004.

## Service error presentation

**Service error presentation** — curated user-facing copy derived from an original
error and explicit service context (`routstr`, `cashu`, `nostr`, `nagg`, or `app`).
Owned by `shared/lib/errors`; used by popups and inline error text. Presentation
IDs and text never determine retries, payment outcomes, or recovery. Cashu errors
may originate in Coco or a mint implementation such as CDK or Nutshell.

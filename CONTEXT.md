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
reply; do I follow this profile). Authoritative source is the client-side
own-events relay sync (NOT nagg) — see **own-events sync** and ADR 0002 (which
supersedes ADR 0001's nagg approach).

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

## Thread reading

**Thread anchor** — the tapped note (`target`) is the thread list's stable
anchor. The view lands on it (scrolled past the parent chain); parents fill in
off-screen above and replies below, and neither moves the target under the
thumb. See ADR 0003.

**maintainVisibleContentPosition** — the LegendList prop that owns thread
position stability: it pins the first visible row so a parent prepend or a
row's height snap doesn't shift the anchor. Distinct from `maintainScrollAtEnd`
(chat-style auto-pin), which the thread deliberately omits so loading replies
never auto-scrolls the reader.

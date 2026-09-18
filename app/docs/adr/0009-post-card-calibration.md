# ADR 0009 — Post card calibration

**Status:** accepted, 2026-09-14
**Scope:** `app/features/feed` post card, action bar, repost header, quoted card, feed tabs

## Context

The feed and post card had the right shape (avatar gutter, no card chrome,
hairline separators, four actions) but read as unpolished. Source-mining
Bluesky, Primal, Damus, Ice Cubes, Phanpy and Amethyst, plus a design-rule
pass (HIG, Material, Threads, Refactoring UI), showed the gap was ten small
defaults every polished client had replaced: zero counts rendered, filled
icons from four families at rest, body louder than the name (Oxygen ships
Regular/Bold only), `1d ago` with a bold dot, bold-and-dim links, nine grey
stops on one card, no press feedback or like animation, a staggered row
entrance, a `space-between` action bar with 11px thread counts, and a
36px avatar over a 1px divider.

## Decision

- **One typography module.** [postTypography.ts](../../features/feed/lib/postTypography.ts)
  owns every size, line height, geometry constant and ink alpha the card
  surfaces use. Name and body are both 15/20; meta and counts 13/18. Avatar
  40, gap 10, card 16 / 12 top / 8 bottom. Literal sizes in card components
  are a regression.
- **Mona Sans on the feed surface** via `Text family="mona"`. It is already
  bundled for amounts and is the only family with a real SemiBold; Oxygen
  stays the app default (hunch rule ui/shared-parts).
- **Three-step ink ladder** — `postInk.primary` 0.9 (name, body),
  `secondary` 0.5 (time, counts, idle glyphs, repost line, dots),
  `tertiary` 0.25 (borders, unavailable cards). Links, mentions and hashtags
  use the theme `accent` at regular weight — one signal, not bold + dim.
- **One icon family (Tabler)** for actions: outline at rest, the `-filled`
  twin plus the action's accent when active. Per-action accents live in
  `brandColors` (`LIKE_ACCENT` joins `COMMENT_ACCENT`/`ZAP_ACCENT`).
- **Action bar spreads across the text column** (`space-between`, like X,
  Primal and Damus): every visible gap is equal whatever the counts' widths,
  the first glyph sits on the text keyline and the zap lines up under the
  "more" button. A first pass used Bluesky's four equal columns in a 320-wide
  band; on device the gaps then depended on count width and the zap floated
  mid-row, so it was replaced (2026-09-14). Counts hidden at zero (loading →
  placeholder bar, unavailable → `—`), `tabular-nums`, semibold when active.
  Light impact haptic + `PressScale` on press; the like burst (Bluesky's
  keyframes) plays only for a like the viewer tapped and never under reduced
  motion; `LayoutAnimationConfig skipEntering` keeps FlashList recycling from
  replaying it.
- **No mount motion on rows.** The staggered slide-in is gone; motion only
  follows user action.
- **Timestamps are `terse`** (`5m`, `3h`, `2d`, `1w`, `Mar 4`) on rows via
  `formatRelativeUnixSeconds`; `compact` keeps `ago` for prose.
- **Cold load = skeleton rows** on the home feed (as the profile feed and
  thread already did), never a centred spinner.
- **Tab selection reads in the type** (semibold + full ink vs secondary
  ink), not only the pill.

## Consequences

- `PostCard`/`RepostCard` lost `index`/`skipAnimation`; call sites and the
  props builders no longer thread a list index for animation.
- `POST_ACTION_ICON_SIZES` is now `{ compact: 18, regular: 20 }` numbers;
  the image-overlay panel uses the same family and hidden zeros.
- Deferred to a follow-up decision: image mosaic and tall-image cap with a
  hairline media border, link preview cards, "N new posts" pill and
  scroll-to-top, a shared minute tick for timestamps, thread-connector
  unification (dotted in thread vs solid in feed), tappable hashtags, tab
  bar hide-on-scroll.

## Addendum — action taps and optimistic counts (2026-09-14)

- **Action taps never open the thread.** A disabled RN `Pressable` (a like
  still publishing) does not claim the responder, so its tap fell through to
  the card's gesture-handler tap. The action bar now latches suppression on
  touch start, and `useCardTapGesture` adds a root `probe`
  (`onStartShouldSetResponder`, only asked when no descendant claimed the
  touch) so any nested control blocks the card without extra wiring. The open
  decision waits one macrotask because gesture-handler recognition can outrun
  the RN touch events for the same touch. Reply opens the thread explicitly on
  every variant instead of relying on fall-through.
- **One overlay, one base.** The optimistic like/repost/zap overlay is global,
  but was added as a delta to each surface's own counts, so a feed like was
  double-counted by a fresher thread and an unlike there landed wrong.
  [engagementOverlay.ts](../../features/feed/lib/engagementOverlay.ts) pins the
  shown count toward the expected count (at least after a like or zap, at most
  after an unlike) over the entity cache's counts, and settles directionally,
  never while the viewer's own-event sync still disagrees.
- **Toggles are intent, not requests.** A like or repost tap only flips the
  optimistic intent in the store, and the button is never disabled while a
  publish is in flight. One module-scope loop per action
  ([engagementToggle.ts](../../features/feed/lib/engagementToggle.ts)) publishes
  the reaction or its kind:5 retraction until the network matches the latest
  intent, so like → unlike straight away ends as "like, then delete" and
  like → unlike → like as a single like. A pending intent left by an app close
  resumes when a surface showing the note mounts. On failure the overlay shows
  what the network holds.
- **Reply focuses the reply box.** A card's reply button opens the thread with
  `focusReply=1`; the thread focuses its reply bar once the push settles and
  the target post has loaded. In the thread, the target's reply button focuses
  the bar; a reply row's button still opens the composer for that reply.

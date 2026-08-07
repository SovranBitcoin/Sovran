# Lens: lists & media (FlashList v2, expo-image)

Scope: feed/thread/transactions/mint lists — anywhere `FlashList`, the shared
`List` seam, or `ScrollView` renders collections. This repo is on
@shopify/flash-list **2.3** (v2 semantics: no size estimates,
`maintainVisibleContentPosition` on by default).

## FlashList v2 correctness & cost

- Deprecated v1 props are no-ops and signal stale cargo-cult: grep
  `estimatedItemSize`, `estimatedListSize`, `estimatedFirstItemOffset`,
  `onBlankArea`, `disableAutoLayout`, `MasonryFlashList`, `CellContainer`.
- Recycling leaks item state: `useState`/`useRef` inside `renderItem`
  components whose initial value derives from `item` bleeds across rows
  (checkbox state, video position, input text, revealed-spoiler flags).
  Detect: `useState(item.` or state keyed to "this row" without
  `useRecyclingState`/key reset.
- `keyExtractor` must be identity-stable — index keys plus feed prepends break
  MVCP and force full-row re-renders. Detect: `(item, index) => index`,
  `key={index}`.
- Mixed row shapes (post / repost / skeleton / ad / header) need
  `getItemType` or the recycling pools thrash. Detect: multi-branch
  `renderItem` without it.
- Heavy per-row work: date formatting, linkify/regex, `JSON.parse`, tag
  parsing inside item render. Hoist to ingest/data layer or memoize by id.
- `<ScrollView>{items.map(` for unbounded data mounts every row. Flag.
- Reordering data under MVCP causes jumpiness — cross-reference the
  content-shift lens for prepend/anchor findings; don't double-report.

## expo-image in lists

- Recycled cells show stale images without `recyclingKey={item.id}`. Detect:
  `<Image` inside `renderItem` without `recyclingKey`.
- Avatars/feed media want `cachePolicy="memory-disk"` (default is disk-only);
  above-fold images want `priority`. Detect: remote `uri` in hot lists with
  neither.
- Full-resolution originals into avatar-sized slots — look for sized-variant /
  thumbhash/blurhash support in the media pipeline before flagging as
  unfixable.
- Dynamic query strings on `uri` bust the cache per render. Detect: template
  literals building `uri` with volatile params.

## Evidence

```bash
rg -n "estimatedItemSize|estimatedListSize|onBlankArea|disableAutoLayout|MasonryFlashList|CellContainer" app features shared
rg -n "keyExtractor=\{?\(?.*index" features
rg -n "recyclingKey" features            # inverse: Image-in-renderItem without it
rg -n "getItemType" features
npx tsx codereview/log-doctor/index.ts visual --latest      # row rects, overlaps, virtual positions
npx tsx codereview/log-doctor/index.ts perf   --latest
```

## Do not flag

- The known `freezeOnBlur` + FlashList interaction — already tracked
  (2.0.2→2.3.2 bump); only report if you find a *new* concrete corruption path.
- Lists of bounded, small cardinality inside ScrollView (settings rows).

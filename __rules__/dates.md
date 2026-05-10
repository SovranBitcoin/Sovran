# Dates and times — the rules

Every user-facing date or time string in the app is rendered through one of **two** functions in `shared/lib/date.ts`. Pick one of two functions, then pick one of a handful of named styles. Don't reach for anything else — opaque options bags drift, locked-down style names stay consistent across screens.

```ts
formatDate(input, style)      // absolute timestamps
formatRelative(input, style)  // "ago" / day-anchored timestamps
```

## Locale resolution — automatic

The active locale is resolved per call:

1. If the user has set an in-app language override (`settingsStore.language` ≠ `'en'`), use it.
2. Otherwise use the **device locale** from `expo-localization` (iOS / Android system preference).
3. Fall through to `'en'` only if both are unavailable.

So an American user sees `Mar 16, 2026, 3:42 PM`, a British user sees `16 Mar 2026, 15:42`, a German user sees `16. März 2026, 15:42`. There's no per-call `locale` parameter — and there shouldn't be. Add one if (and only if) you have a string that genuinely needs to be locale-frozen, in which case use `style: 'iso'`.

## `formatDate(input, style)` — absolute timestamps

| `style` | Example (en-US) | Example (en-GB) | Use for |
|---|---|---|---|
| `'time'` | `3:42 PM` | `15:42` | Time of day |
| `'short-date'` | `Mar 16, 2026` | `16 Mar 2026` | Compact date in a row, badge, or pill |
| `'long-date'` | `March 16, 2026` | `16 March 2026` | Section headers, profile "joined" lines |
| `'short-date-time'` | `Mar 16, 2026, 3:42 PM` | `16 Mar 2026, 15:42` | Default for transaction rows, "this happened on X at Y" |
| `'iso'` | `03/16/2026 15:42:00` | (same) | Locale-frozen `MM/DD/YYYY HH:MM:SS` — debug screens, transaction-state timelines that need second precision, recovery export rows |

`'iso'` is the only style that ignores the user's locale. Don't use it for general user display.

## `formatRelative(input, style)` — relative / day-anchored

| `style` | Example | Use for |
|---|---|---|
| `'verbose'` | `5 minutes ago`, `yesterday`, `in 3 days` | Presence indicators ("last seen"), one-shot timestamps with room to breathe |
| `'compact'` | `now`, `5m ago`, `3h ago`, `2d ago`, `1w ago`, then `Mar 16` after 4w | Dense surfaces (feed posts, hover chips) — single short line |
| `'chat-bubble'` | `15:42` today, `Yesterday` up to 48h, short date older | Chat message bubbles (consistent across BitChat / White Noise / DM / AI) |
| `'conversation-list'` | `Today at 15:42`, `Yesterday at 15:42`, full short date+time older | Conversation-list rows that have to disambiguate days at a glance |

## Don't

- ❌ `date.toLocaleTimeString(...)` / `date.toLocaleDateString(...)` / `date.toLocaleString(...)` in feature code. They re-allocate an `Intl` formatter per render and won't honor the resolution rules above.
- ❌ `new Intl.DateTimeFormat(...)` inline. The cache in `date.ts` is shared across the app — extend it instead.
- ❌ Hand-rolled "X minutes ago" math. Use `formatRelative(x, 'verbose')` or `formatRelative(x, 'compact')`.
- ❌ Importing or extending `coco-payment-ux/FormattedTimestamp` for new sovran-app code. That class belongs to coco-ux.
- ❌ Adding a new `style` value because none of the existing ones quite fit. First check whether your screen really needs a different presentation, or whether it should just adopt one of the existing styles. **Constraining the style set is the entire point.** Only add when the new presentation is genuinely shared by ≥2 surfaces.

## When you do need a new style

Add it to `AbsoluteDateStyle` or `RelativeDateStyle` in `shared/lib/date.ts`, extend the dispatcher, and document the intended surface in this table. Keep names intent-shaped (e.g. `'badge'`, `'log-line'`) — never option-shaped (e.g. `'with-seconds'`).

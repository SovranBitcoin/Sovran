# Formatting

The library exports two formatting primitives — [`FormattedTimestamp`](#formattedtimestamp) and [`FormattedString`](#formattedstring). Both extend their base types (`Number` and `String`) so they work everywhere a normal value does, but expose formatting methods for display.

Entry fields returned from [`useScreenActions`](/guide/architecture#thin-screens) are already instances of these types — no manual wrapping needed. The locale comes from [`getLocale`](#locale) on the provider's [`screenActionsBridge`](/guide/getting-started#provider).

## Locale

Both formatters are locale-aware. The locale flows from the provider through [`decorateEntry`](/guide/getting-started#handlers-operations-notifications) — screens don't pass it manually.

```ts
screenActionsBridge={{
  getLocale: () => i18n.language,
}}
```

[`FormattedTimestamp`](#formattedtimestamp) uses the locale for all date formatting via `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat`. [`FormattedString`](#formattedstring) uses it for RTL-aware truncation in [`beforeAt`](#rtl-and-beforeat) mode.

When `getLocale` is not provided, both default to `'en'`.

### What changes per locale

| Locale | `FormattedTimestamp`                 | `FormattedString`                       |
| ------ | ------------------------------------ | --------------------------------------- |
| `'en'` | `"Mar 16, 2026"`, `"2 hours ago"`    | `"very...name@npub.cash"`               |
| `'de'` | `"16. Mär. 2026"`, `"vor 2 Stunden"` | Same as `'en'`                          |
| `'ja'` | `"2026年3月16日"`, `"2 時間前"`      | Same as `'en'`                          |
| `'ar'` | `"١٦ مارس ٢٠٢٦"`, `"قبل ساعتين"`     | RTL `beforeAt`: `"...مرحبًا@npub.cash"` |

## FormattedTimestamp

Extends `Number` with locale-aware date formatting. Constructed with a Unix timestamp (milliseconds) and the locale from the provider.

```ts
import { FormattedTimestamp } from 'coco-payment-ux';

const ts = new FormattedTimestamp(Date.now(), 'en');
```

### Getters

```ts
ts.relative; // "2 hours ago", "just now", "in 3 days"
ts.short; // "Mar 16, 2026"
ts.full; // "March 16, 2026, 3:45 PM"
ts.datetime; // "03/16/2026 15:45:00"
```

| Getter     | Format                      | Use case                             |
| ---------- | --------------------------- | ------------------------------------ |
| `relative` | `"2 hours ago"`             | Transaction lists, activity feeds    |
| `short`    | `"Mar 16, 2026"`            | Detail screens, compact date display |
| `full`     | `"March 16, 2026, 3:45 PM"` | Full transaction details             |
| `datetime` | `"03/16/2026 15:45:00"`     | Debug info, logs, exports            |

All getters use `Intl.DateTimeFormat` with the locale from the provider, so date formatting adapts automatically — month names, number systems, and date order all follow the locale conventions.

### How relative works

Uses `Intl.RelativeTimeFormat` when available, with a fallback for environments that don't support it:

```ts
entry.createdAt.relative;
// < 60 seconds  → "just now"
// < 60 minutes  → "5 minutes ago"  (en) / "vor 5 Minuten" (de)
// < 24 hours    → "2 hours ago"    (en) / "قبل ساعتين"    (ar)
// ≥ 1 day       → "3 days ago"     (en) / "3日前"          (ja)
```

Future timestamps work too — `"in 3 days"`, `"in 2 hours"`.

### Still a Number

Arithmetic, comparisons, and `Date` construction all work:

```ts
entry.createdAt + 0; // raw milliseconds
entry.createdAt > otherEntry.createdAt; // comparison
new Date(entry.createdAt.valueOf()); // Date object
```

## FormattedString

Extends `String` with smart truncation. Constructed with a string value, an optional default [`TruncateMode`](#truncation-modes), and the locale from the provider.

```ts
import { FormattedString } from 'coco-payment-ux';

const token = new FormattedString('cashuBpGF0aHR0cHM...', 'middle', 'en');
```

### Truncation

```ts
token.truncate(6); // "cashuB...cHM..." (uses default mode)
token.truncate(6, 'middle'); // "cashuB...cHM..."
token.truncate(10, 'end'); // "cashuBpGF0..."
token.truncate(10, 'start'); // "...aHR0cHM="
```

Returns the original string if it's already short enough — no trailing `...` on strings that fit.

### Truncation modes

| Mode         | Behaviour                                            | Example                 |
| ------------ | ---------------------------------------------------- | ----------------------- |
| `'middle'`   | Keeps `n` chars from start and end, joins with `...` | `"cashuA...xYZ"`        |
| `'end'`      | Keeps first `n` chars, appends `...`                 | `"cashuA..."`           |
| `'start'`    | Keeps last `n` chars, prepends `...`                 | `"...xYZ"`              |
| `'beforeAt'` | Truncates only before `@`, keeps domain intact       | `"longus...@npub.cash"` |

### Default modes on entry fields

The library sets sensible defaults when constructing entry fields, so calling `.truncate(n)` without a mode does the right thing:

| Field         | Default mode | Why                                          |
| ------------- | ------------ | -------------------------------------------- |
| `tokenString` | `'middle'`   | Tokens are identifiable by prefix and suffix |
| `mintUrl`     | `'middle'`   | Domain start and TLD are both useful         |
| `npcAddress`  | `'beforeAt'` | Domain after `@` should always be visible    |
| `operationId` | `'middle'`   | Hash-like identifiers                        |

### beforeAt mode

Designed for NPC / lightning addresses where the domain is meaningful:

```ts
const addr = new FormattedString('verylonglightningname@npub.cash', 'beforeAt');

addr.truncate(4); // "very...name@npub.cash"
addr.truncate(8); // "verylonglightningname@npub.cash" (short enough, no truncation)
```

Only the local part (before `@`) is truncated. If there's no `@`, falls back to `'middle'` mode.

### RTL and beforeAt

For RTL locales (`ar`, `he`, `fa`, `ur`, `ps`, `sd`, `yi`), `beforeAt` adapts its truncation direction. Since RTL text reads right-to-left, the visual "start" of the local part is at the string's end in byte order. The truncation keeps the visual start visible:

```ts
const ltr = new FormattedString('verylongname@npub.cash', 'beforeAt', 'en');
ltr.truncate(4); // "very...name@npub.cash"  (middle — keeps both ends)

const rtl = new FormattedString('مرحبًابالعالمالعربي@npub.cash', 'beforeAt', 'ar');
rtl.truncate(4); // "...العربي@npub.cash"    (keeps visual start of RTL text)
```

| Locale direction            | `beforeAt` behaviour                                             |
| --------------------------- | ---------------------------------------------------------------- |
| LTR (`en`, `de`, `ja`, ...) | Middle truncation — keeps start and end of local part            |
| RTL (`ar`, `he`, `fa`, ...) | Start truncation — keeps end of local part (visual start in RTL) |

This happens automatically when `getLocale` returns an RTL language — no extra configuration needed.

### Still a String

All standard string operations work:

```ts
entry.tokenString.startsWith('cashu'); // true
entry.mintUrl.includes('example'); // true
entry.tokenString
  .length // full length
`Token: ${entry.tokenString}`; // full string in template
```

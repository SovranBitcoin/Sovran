# log-doctor — overview

A CLI that turns a raw Sovran session log into compact, LLM-readable summaries.
You capture structured logs from a dev session, then ask log-doctor focused
questions ("what broke?", "why is startup slow?", "where did layout shift?")
instead of scrolling through 20k log lines.

- **Tool:** `sovran-app/codereview/log-doctor/index.ts` (run with `bun run`)
- **Input:** a `log.txt` in `sovran-app/` (or piped on stdin)
- **Output:** dense text/markdown/json, sized to fit an LLM context window

---

## 1. How we write logs in the app

All logging goes through the scoped logger barrel at
`shared/lib/logger.ts`. You never `console.log`.

### The logger API

```ts
import { paymentLog, feedLog, log } from 'shared/lib/logger';

paymentLog.info('payment.send.start', { mintUrl, amount });
feedLog.debug('feed.shift.note.height', { key, deltaHeight });
log.error('nostr.relay.connect.failed', { relay, reason });
```

- Five levels: `debug` / `info` / `warn` / `error` / `fatal`.
- Every call takes a **dot-separated event name** (`payment.send.start`) plus a
  flat **params** object. The event name is the queryable key — log-doctor
  filters and groups on it.
- **Pre-made child loggers** carry a module tag so events sort cleanly:
  `nfcLog, cashuLog, nostrLog, walletLog, paymentLog, feedLog, apiLog,
  storeLog, aiLog, chatLog, bitchatLog, wnLog, popupLog, mapLog`. Make your own
  with `log.child({ module: 'x' })`.

### Timing & spans

```ts
await log.timed('coco.recovery', () => recover(), { warnThresholdMs: 1000 });

const span = paymentLog.startSpan('payment.melt', { mint }, { warnAtMs: 2000 });
span.end({ ok: true }); // logs payment.melt.end with duration_ms
```

`timed`/`startSpan` auto-emit `.start`/`.end` entries with `duration_ms` and
**auto-escalate** to WARN/ERROR when an op runs slow (defaults 1s/5s). This is
what feeds the `slow` mode.

### What each entry looks like

Entries are structured JSON (`LogEntry` in `loggerCore.ts`):

```jsonc
{
  "ts": "...",            // ISO timestamp
  "_t": 4611.2,           // monotonic ms since app start (skew-free; subtract two to get a gap)
  "level": "warn",
  "event": "perf.js_thread_blocked",
  "src": { "file": "...", "func": "...", "line": 42 },
  "params": { "blocked_ms": 2702.7 },
  "duration_ms": 51.5,    // present on span ends
  "device": { "platform": "ios", "logSessionId": "..." }
}
```

### Secret redaction (automatic)

The logger compacts and redacts before anything is written, so dumps are safe
to paste into an LLM:

- Fields named like secrets (`*nsec`, `*privateKey`, `mnemonic`, `seed`,
  `*token`, `password`, `authorization`, …) are replaced with
  `{ _kind, len }` — never the value.
- Values matching secret patterns (nsec, cashu token, JWT, PEM, 32-byte hex)
  are branded by kind, not printed.
- Embedded secrets inside larger strings are scrubbed (you'll see `[mint_url]`,
  `[error]` placeholders in real output).
- Long strings are truncated to a short preview.

**Rules when adding logs:**
- Use scoped loggers from `shared/lib/logger`; never `console.log`.
- Event names are queryable prefixes: `payment.*`, `nostr.*`, `wallet.*`,
  `perf.*`, `theme.*`, `feed.*`, `visual.*`.
- Never log raw secrets, raw ecash tokens, full invoices, or imported nsecs.
- Narrow unknown errors with `redactError(e)`; don't dump arbitrary nested objects.

### Getting logs out of the app

The console transport prints JSON; an on-device **file transport** mirrors every
entry to `log.txt` so logs survive dev-server disconnects
(`applyFileLogging`, `exportLogFile`, `getLogFileInfo` in `loggerFile.ts`). You
can also call `log.dumpForLLM({ format: 'md' })` to flush the in-memory ring
buffer to a paste-ready string.

To feed log-doctor: capture a dev session's stdout to `sovran-app/log.txt`
(e.g. `expo start 2>&1 | tee log.txt`), or paste a `dumpForLLM()` dump into that
file. log-doctor reads `log.txt` by default, or stdin when piped.

---

## 2. Running log-doctor

```bash
cd sovran-app

bun run codereview/log-doctor/index.ts <mode> [options]   # reads ./log.txt
cat some-logs.jsonl | bun run codereview/log-doctor/index.ts stats
```

> `npm run log-doctor -- <mode>` is the documented alias, but in this repo the
> npm/npx path currently hits a dependency-override error, so use `bun run`.

**`--latest` is the flag you'll use most** — it keeps only the most recent app
session (it detects restarts via `_t` resets), so you're not mixing three runs.

---

## 3. The modes

24 modes. They fall into a few families.

### Triage / overview
| Mode | Tokens | What it shows |
|------|--------|----------------|
| `budget` | tiny | Token cost of every mode for *this* log + what fits in which context window. Run it first. |
| `stats` | ~1K | Event frequency, slowest ops, error rate, timing gaps, noise/duplicate detection. |
| `devices` | small | Device/session labels in a mixed-device log file. |
| `timeline` | ~5K | One line per entry with delta timing. Pair with `--event`. |
| `full` | ~5–23K | All entries, deduped/trimmed. `--format md` is ~40% cheaper than json. |
| `diff` | varies | Compares latest session vs previous to isolate failure-specific entries. |

### Failure & performance
| Mode | Tokens | What it shows |
|------|--------|----------------|
| `errors` | large | warn/error/fatal entries. **Clustered by default** — near-identical errors collapse to exemplar + count + first/last; `--all`/`--no-cluster` restores the full per-entry listing with `--context N`. |
| `slow` | ~5–18K | Gaps between consecutive entries exceeding `--threshold` ms (default 500). Note: measures *log-line gaps*, not op durations — use `perf` for durations. |
| `startup` | ~1.5–5K | Init waterfall, stage timing, gate sequence. |
| `gc` | varies | Hermes memory trend, GC pressure, JS-thread blocks, leak detection. |
| `perf` | varies | Per-event latency distribution (**p50/p95/p99 + sparkline**) from `params.ms` / `_perf`-tagged ops, plus slow-op and network/compute breakdowns. |
| `renders` | ~200 | Re-render counts + why-did-update hints. |

### Domain-specific
| Mode | What it shows |
|------|----------------|
| `coco` | Coco/Colada wallet module breakdown, issues, mint requests. |
| `payment` | Payment/receive/redeem timeline grouped by operation id. |
| `toasts` | Toast lifecycle grouped by toast/payment id. |
| `crypto` | Crypto/cashu amount + proof operations. |
| `network` | Request/response pairs with latency. |
| `ws` | WebSocket health, subscription analysis, message rates. |
| `feed` | Feed/thread GraphQL, page mapping, reply seed/render flow. |
| `flows` | Reconstruct cross-async traces via `flowId` in ctx. |
| `ops` | General operation/span breakdown. |
| `screens` | Screen navigation flow + content snapshots + durations. |
| `redaction` | Read-side secret-redaction audit: counts `{_kind}` brands + `<REDACTED:…>` markers, and heuristically flags raw values that look **un-redacted** (high-signal: nsec/xprv/cashu-token/jwt/email; low-signal: npub/note/64-hex). Reports event names, never values. |

### Visual / content-shift (the big one for UI jank)
`visual` reads layout telemetry — row rects, item-size changes, virtual-position
snapshots, overlaps, container-boundary violations, sticky-header markers, large
jumps — and flags content-shift bugs. Narrow it with `--scope`, `--component`,
`--key`, `--item-type`.

```bash
bun run codereview/log-doctor/index.ts visual --latest
bun run codereview/log-doctor/index.ts visual --latest --scope 'thread\.'
bun run codereview/log-doctor/index.ts visual --latest --component PostComposerToolbar
bun run codereview/log-doctor/index.ts timeline --event 'visual\.layout|\.shift\.' --latest
```

### Device control (separate tool)
`phone` drives a real iPhone over WebDriverAgent (`tap`, `tap-id`, `tree`,
`shot`, `swipe`, plus a `phone test` DSL runner). Not a log analyzer — it's how
you *generate* a fresh session to then inspect.

---

## 4. Key options

| Flag | Effect |
|------|--------|
| `--latest` | Most recent session only. Use almost always. |
| `--event <pattern>` | Filter to events matching substring/regex. |
| `--threshold <ms>` | Duration cutoff for `slow` (default 500). |
| `--context <n>` | Entries around each error in `--all` mode (default 3). |
| `--all` / `--no-cluster` | `errors` mode: list every entry instead of clustering. |
| `--token-budget <n>` | Auto-prune output to fit N tokens. |
| `--since/--until <ms>` | Time-window filter on `_t`. |
| `--limit/--offset` | Paginate huge sessions. |
| `--format json\|yaml\|md` | Output format for `full`. |
| `--no-inst` | Strip instrumentation (render.count, state.change). |
| `--device/--platform/--session` | Filter a mixed log. |
| `--scope/--component/--key/--item-type` | Narrow `visual`. |

---

## 5. Worked examples (real output)

### `budget` — what's affordable on this session
```
TOKEN BUDGET ANALYSIS:
  Total entries: 19939

MODE TOKEN COSTS (approximate):
  renders     162 tokens  █
  stats      1035 tokens  █
  startup    1452 tokens  █
  ...
  screens   25207 tokens  ████████
  errors   124694 tokens  ████████████████████████████████████████

FITS IN CONTEXT WINDOW:
  Small prompt (8K): renders, stats, startup, network, slow, timeline, coco, full (md), feed
```
*Takeaway: `errors` is huge here — narrow it before reaching for it.*

### `stats --latest` — frequency + timing snapshot
```
=== LOG SESSION STATISTICS ===
Device: {"platform":"ios","appVersion":"0.1.0","osVersion":"26.1",...}
Entries: 19939   Time span: 55.3s
BY LEVEL: DEBUG 14076  INFO 4769  WARN 1087  ERROR 7

TOP APP EVENTS:
   1744x  visual.layout.measure
   1392x  history.filters.matchesFilters
    980x  init.timing
TIMING: Largest gap 33860ms ; Median gap 0ms
```
*Takeaway: `history.filters.*` fires ~1.4k times — a re-computation hotspot.*

### `errors --latest --context 1` — what went wrong, with neighbours
```
>>> WARN transactions.filter.slow      duration_ms=51.56 input=82 output=75
>>> WARN perf.js_thread_blocked        blocked_ms=2702.7 expected_ms=200 actual_ms=2902.7
>>> WARN coco...failed_to_check_inflight_proofs_for_mint  mintUrl=[mint_url] error=[error]
    DEBUG coco...mint_response_error    status=429 errorData="Rate limit exceeded."
```
*Takeaway: a 2.7s JS-thread block + mint 429s. Note `[mint_url]`/`[error]` are
redacted automatically.*

### `startup --latest` — init waterfall
```
STARTUP WATERFALL:
   1786ms ████████████████ updateStage (18.3s)
   3559ms █████ SplashMorph (2.4s)
   6211ms ██████████ Coco-bg.receiveRecovery (13.9s)
MILESTONES:  App ready: 1818ms   Total init span: 18323ms
```
*Takeaway: `receiveRecovery` dominates init — the place to optimize.*

---

## 6. Typical workflows

**Audit-prep sweep (fits < 30K tokens together):**
```bash
bun run codereview/log-doctor/index.ts stats  --latest
bun run codereview/log-doctor/index.ts errors --latest --context 5
bun run codereview/log-doctor/index.ts slow   --latest --threshold 200
bun run codereview/log-doctor/index.ts coco   --latest
```

**The loop (from the `sovran-quality` skill):**
1. Find the relevant event namespace / symptom.
2. Run the **narrowest** query first (`--event`, `--scope`, `--latest`).
3. Correlate output with code paths and store/request state.
4. Add scoped logs only if they make future diagnosis cheaper.
5. Remove noisy or secret-risk logs before shipping.

See also: `skills/sovran-quality/references/log-doctor.md` and
`codereview/README.md` for token budgets and audit.md/fix.md integration.

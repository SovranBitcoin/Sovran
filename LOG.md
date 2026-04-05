# Log Doctor

Preprocesses structured JSON logs from the app's logger into token-efficient formats for LLM analysis.

## Quick start

```bash
# Copy app logs into log.txt (from dumpForLLM() or console), then:
npm run log-doctor -- stats           # overview first
npm run log-doctor -- slow            # find bottlenecks
npm run log-doctor -- errors          # find problems
npm run log-doctor -- timeline        # full flow with deltas

# Or pipe directly:
cat log.txt | npm run log-doctor -- timeline --limit 50
```

The script auto-reads `sovran-app/log.txt` if no stdin is piped.

## Modes

| Mode | Use for | Token cost |
|------|---------|------------|
| `stats` | First pass — noise detection, event frequency, timing gaps | ~200 tokens |
| `timeline` | See the full execution flow with pre-computed delta timing | ~40/entry |
| `errors` | Jump to warn/error/fatal with N entries of context | varies |
| `slow` | Find gaps > threshold between consecutive log entries | ~60/gap |
| `renders` | Aggregated mount/render counts, detect excessive re-renders | ~30/component |
| `screens` | Screen navigation flow, content snapshots, durations | ~40/screen |
| `startup` | Init waterfall, stage timing, gate sequence, milestones | ~200 tokens |
| `coco` | Coco wallet module breakdown, issues, mint requests | ~200 tokens |
| `network` | API calls, websocket events, fetch timing | ~30/request |
| `full` | Complete JSON but with consecutive duplicates collapsed | ~150/entry |

## Recommended workflow

1. **`stats`** — bird's-eye view. Identifies noise (>15% of logs is one event), largest timing gaps, error counts.
2. Based on stats output, drill into the relevant mode.
3. Use `--since` / `--until` / `--event` to narrow scope.

## Options

```
--threshold <ms>    Slow mode: minimum gap to report (default: 500)
--context <n>       Errors mode: entries before/after each error (default: 3)
--limit <n>         Page size (default: 200)
--offset <n>        Skip first N entries — paginate with "Next: --offset N" hint (default: 0)
--no-device         Omit device info block
--no-inst           Exclude instrumentation events (render.count, state.change, etc.)
--since <ms>        Only entries after this _t value
--until <ms>        Only entries before this _t value
--event <pattern>   Filter to events matching regex (falls back to substring)
--latest            Only analyse the most recent app session (auto-detects restarts)
```

## Noise reduction

The logger has a built-in 50ms dedup window: when the same event name fires multiple times within 50ms, subsequent entries are collapsed into the first with a `_dedup` count. Warnings/errors are never deduped. This is configured via `dedupWindowMs` in `createLogger()`.

For semantic dedup (e.g. "don't log if the computed value didn't change"), use a ref-based check in the component — the logger's timing dedup can't know whether values are meaningfully different.

## What to audit

**Performance**: Run `stats` then `slow --threshold 200`. Look for PBKDF2 seed derivation, network waterfalls, sync operations blocking the JS thread, and excessive re-renders.

**Startup**: Run `startup` to see the init waterfall — which stages take longest, where the critical path is, and when the app becomes ready.

**Bugs**: Run `errors --context 5`. Check for unhandled promise rejections, null reference errors, state inconsistencies.

**Wallet internals**: Run `coco` for a module-by-module breakdown of coco-core activity — warnings, mint requests, proof state changes. Requires `CocoLogger` (not `ConsoleLogger`).

**Re-renders**: Run `renders` for per-component render counts, why-did-update analysis with actionable hints, state churn, and data hook update frequency.

**User flows**: Run `screens` to see screen navigation flow with mount/unmount timing and content snapshots. Or use `timeline --event "gate|navigate|wallet.action"` (regex) to trace milestones.

**Noise**: Run `stats`. Check "DUPLICATE RUNS" for repeated identical events. Any event >15% of total logs should be rate-limited or deduplicated.

## Getting logs into log.txt

In the app's debug console, call `log.dumpForLLM()` to get the ring buffer contents as newline-delimited JSON. Paste into `sovran-app/log.txt`.

Alternatively, copy structured JSON log output from the Metro terminal directly.

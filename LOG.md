# Log Doctor

Preprocesses structured JSON logs from the app's logger into token-efficient formats for LLM analysis.

## Quick start

```bash
# Copy app logs into log.txt (from dumpForLLM() or console), then:
npm run log-doctor -- stats           # overview first
npm run log-doctor -- slow            # find bottlenecks
npm run log-doctor -- errors          # find problems
npm run log-doctor -- timeline        # full flow with deltas
npm run log-doctor -- diff            # compare failing vs working session
npm run log-doctor -- budget          # see token cost of each mode

# Compact output for pasting into LLMs:
npm run log-doctor -- full --format md              # ~56% fewer tokens than JSON
npm run log-doctor -- full --format md --token-budget 8000  # fit in context window

# Or pipe directly:
cat log.txt | npm run log-doctor -- timeline --limit 50
```

The script auto-reads `sovran-app/log.txt` if no stdin is piped.

## Modes

| Mode | Use for | Token cost |
|------|---------|------------|
| `stats` | First pass — noise detection, event frequency, timing gaps, template variability | ~200 tokens |
| `timeline` | See the full execution flow with pre-computed delta timing | ~40/entry |
| `errors` | Jump to warn/error/fatal with N entries of context | varies |
| `slow` | Find gaps > threshold between consecutive log entries | ~60/gap |
| `renders` | Aggregated mount/render counts, detect excessive re-renders | ~30/component |
| `screens` | Screen navigation flow, content snapshots, durations | ~40/screen |
| `startup` | Init waterfall, stage timing, gate sequence, milestones | ~200 tokens |
| `coco` | Coco wallet module breakdown, issues, mint requests | ~200 tokens |
| `network` | API calls, websocket events, fetch timing | ~30/request |
| `full` | Complete entries, deduplicated — supports `--format yaml\|md` | ~150/entry (json), ~90/entry (md) |
| `diff` | Compare latest session against previous to isolate failure-specific entries | ~200 tokens |
| `flows` | Reconstruct cross-async traces via flowId — shows causal chains | ~40/event |
| `ws` | WebSocket connection health, subscription analysis, message rates | ~200 tokens |
| `gc` | Hermes memory trend, GC pressure, JS thread blocks, leak detection | ~200 tokens |
| `budget` | Token cost meta-analysis — shows which modes fit in which context windows | ~200 tokens |

## Recommended workflow

1. **`budget`** — see token costs and pick the right mode for your context window.
2. **`stats`** — bird's-eye view. Identifies noise (>15% of logs is one event), largest timing gaps, error counts, and template variability.
3. Based on stats output, drill into the relevant mode.
4. Use `--since` / `--until` / `--event` to narrow scope.
5. For crash debugging, use `diff` to compare the failing session against the last working one.
6. For async operation issues, use `flows` to reconstruct causal chains.

## Options

```
--threshold <ms>      Slow mode: minimum gap to report (default: 500)
--context <n>         Errors mode: entries before/after each error (default: 3)
--limit <n>           Page size (default: 200)
--offset <n>          Skip first N entries — paginate with "Next: --offset N" hint (default: 0)
--no-device           Omit device info block
--no-inst             Exclude instrumentation events (render.count, state.change, etc.)
--since <ms>          Only entries after this _t value
--until <ms>          Only entries before this _t value
--event <pattern>     Filter to events matching regex (falls back to substring)
--latest              Only analyse the most recent app session (auto-detects restarts)
--format <fmt>        Output format for full mode: json (default), yaml, md
--token-budget <n>    Max approximate tokens — output is pruned to fit
```

## Output formats (`--format`)

The `full` mode supports three output formats to control token efficiency:

- **`json`** (default) — NDJSON, one entry per line. Most tokens but machine-parsable.
- **`md`** — Pipe-delimited table with a header row. ~56% fewer tokens than JSON. Best for pasting into LLMs.
- **`yaml`** — Inline YAML list. Best LLM comprehension accuracy for nested data (per ImprovingAgents benchmark).

The same formats are available in `dumpForLLM()` in the app:
```typescript
log.dumpForLLM()                          // NDJSON (default, strips redundant ctx + ts)
log.dumpForLLM({ format: 'md' })          // pipe-delimited, ~56% fewer tokens
log.dumpForLLM({ format: 'yaml' })        // inline YAML (strips default ctx)
log.dumpForLLM({ errorsFirst: true })     // errors at top, timeline below
```

`dumpForLLM()` automatically:
- Computes `delta_ms` between consecutive entries (no LLM timestamp math needed)
- Strips the default `ctx` (emitted once in header, not per-entry)
- Strips redundant `ts` from JSON format (already represented by `_t`)
- Compresses `src` to `func:line` when the file is a bundle path

## Token budget (`--token-budget`)

When pasting output into an LLM, use `--token-budget` to prevent context window truncation:

```bash
# For Claude (200K context), reserve 75% for output:
npm run log-doctor -- full --format md --token-budget 150000

# For a focused analysis prompt (~10K budget):
npm run log-doctor -- errors --token-budget 8000
```

Use `budget` mode to see the actual token cost of each mode for your current log data.

## Session diff (`diff` mode)

Compares the latest session against the previous one to isolate failure-specific entries. Based on LogSage's diff technique — entries present in the failing session but absent from the baseline are the diagnostic signal.

```bash
# Run app twice (once working, once failing) with logs to log.txt, then:
npm run log-doctor -- diff
```

Output shows:
- Event types **only in the current session** (new errors, new code paths)
- Events **significantly more frequent** in the current session (retry storms, error loops)
- Events **missing from the current session** (expected steps that didn't happen)

## Flow tracking (`flows` mode)

The logger provides `startFlow()` for tracing user actions across async boundaries. The `flows` mode reconstructs these traces:

```typescript
import { startFlow, paymentLog } from '@/shared/lib/logger';

const flow = startFlow('payment.send', paymentLog);
flow.log.info('preparing', { amount, mint });
await doSwap();
flow.log.info('broadcasting');
flow.end({ success: true });
```

```bash
npm run log-doctor -- flows
```

Output shows each flow as a timeline with relative timing, outcome (COMPLETED/ERROR/IN-PROGRESS), and all events in the causal chain.

## WebSocket analysis (`ws` mode)

Dedicated mode for WebSocket health — critical for coco mint subscriptions:

```bash
npm run log-doctor -- ws
```

Shows connection lifecycle (opens/closes/errors/reconnects), subscription health (matched vs unmatched responses, queued messages), and message rates per host.

Wire up the logger's `createWSLogger()` factory for full lifecycle tracking:
```typescript
import { createWSLogger, cashuLog } from '@/shared/lib/logger';
const wsLog = createWSLogger(cashuLog);
```

## Memory & GC analysis (`gc` mode)

Shows Hermes heap trend, GC pressure, and JS thread blocks:

```bash
npm run log-doctor -- gc
```

Enable by calling in the app:
```typescript
import { logHermesStats, startThreadMonitor } from '@/shared/lib/logger';
logHermesStats();       // periodic heap snapshots
startThreadMonitor();   // JS thread freeze detection
```

Detects memory leaks (monotonic heap growth) and correlates thread blocks with nearby events.

## Runtime diagnostics

The logger exports several diagnostic utilities. Call them during app initialization:

```typescript
import {
  startThreadMonitor,    // JS thread freeze detection
  logHermesStats,        // Hermes memory & GC stats
  captureUnhandledRejections, // Promise rejection tracking
  logAppState,           // App foreground/background transitions
  createWSLogger,        // WebSocket lifecycle logging
  logTransition,         // State machine transition logging
} from '@/shared/lib/logger';

// In your app bootstrap:
startThreadMonitor();
logHermesStats();
captureUnhandledRejections();
logAppState();
```

## Noise reduction

The logger has a built-in 50ms dedup window: when the same event name fires multiple times within 50ms, subsequent entries are collapsed into the first with a `_dedup` count. Warnings/errors are never deduped. This is configured via `dedupWindowMs` in `createLogger()`.

The stats mode includes **template-based dedup analysis** — it groups entries by event name and shows which param keys vary, helping identify events that should be rate-limited or collapsed.

## What to audit

**Performance**: Run `stats` then `slow --threshold 200`. Look for PBKDF2 seed derivation, network waterfalls, sync operations blocking the JS thread. Run `gc` for memory leaks and thread blocks.

**Startup**: Run `startup` to see the init waterfall — which stages take longest, where the critical path is, and when the app becomes ready.

**Bugs**: Run `errors --context 5`. Check for unhandled promise rejections, null reference errors, state inconsistencies.

**Crash debugging**: Run `diff` to compare the failing session against a working one. Focus on the "ONLY IN CURRENT SESSION" section.

**Async operations**: Run `flows` to see cross-boundary traces. Look for flows stuck in IN-PROGRESS or ERROR state.

**WebSocket issues**: Run `ws` for connection health, subscription matching, and message rates.

**Wallet internals**: Run `coco` for a module-by-module breakdown of coco-core activity. Requires `CocoLogger`.

**Re-renders**: Run `renders` for per-component render counts, why-did-update analysis with actionable hints.

**Noise**: Run `stats`. Check "EVENT TEMPLATES" and "DUPLICATE RUNS". Any event >15% of total logs should be rate-limited.

**Token planning**: Run `budget` to see which modes fit in your target context window.

## Getting logs into log.txt

In the app's debug console, call `log.dumpForLLM()` to get the ring buffer contents. Use `log.dumpForLLM({ format: 'md' })` for ~56% fewer tokens. Paste into `sovran-app/log.txt`.

Alternatively, copy structured JSON log output from the Metro terminal directly.

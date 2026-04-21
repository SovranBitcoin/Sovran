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
| `phone` | Drive a real iPhone via WebDriverAgent — tap, type, screenshot, accessibility tree (subcommands) | n/a (device I/O) |

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

## Background theme performance

The image background theming system is instrumented for performance analysis. Use these filters to isolate background-related events:

```bash
# All background/theme events:
npm run log-doctor -- timeline --latest --event "bg\.|theme\.|image\."

# Blur transitions during tab navigation:
npm run log-doctor -- timeline --latest --event "bg\.blur"

# Image loading performance:
npm run log-doctor -- timeline --latest --event "image\.(loaded|prefetch)"

# Render frequency of background components:
npm run log-doctor -- renders --latest
```

**Events logged:**

| Event | Level | What it tells you |
|-------|-------|-------------------|
| `bg.blur.transition` | INFO | Blur mode change (none/partial/full/gradient) on tab focus |
| `bg.view.render` | DEBUG | AnimatedBackgroundView render — theme, isImageTheme, blurTint |
| `bg.sprite.render` | DEBUG | SpriteView render — whether image theme is active |
| `bg.sprite.motion.start/stop` | DEBUG | DeviceMotion subscription lifecycle |
| `theme.css_vars.applied` | INFO | CSS variable update timing (varCount, duration_ms) |
| `image.loaded` | DEBUG | Image load with dimensions, duration_ms, cache type |
| `image.prefetch` | DEBUG | Individual image prefetch timing |
| `image.prefetch.batch` | DEBUG/WARN | Batch prefetch (warns if >200ms) |
| `render.count` (AnimatedBackgroundView) | DEBUG | Render count from useRenderLogger |
| `render.count` (ScrollableGradientOverlay) | DEBUG | Render count from useRenderLogger |

**What to look for:**
- `bg.blur.transition` frequency — should only fire on tab changes, not every render
- `image.loaded duration_ms` — first load vs cached (should be <50ms cached)
- `bg.view.render` count — excessive re-renders indicate missing memoization
- `theme.css_vars.applied duration_ms` — should be <5ms; spikes indicate layout thrashing

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

## Driving the device (`phone` mode)

The `phone` mode lets log-doctor (and any LLM agent calling it via Bash) drive
a real iPhone running the dev build — tap buttons, type text, dump the
accessibility tree, take screenshots — talking to a WebDriverAgent REST server
on `localhost:8100`. The same WDA also backs the `mobile-mcp` MCP server, so
both Claude Code (live, in conversation) and `phone` mode (shell-driven) can
drive the device safely without fighting over sessions.

**Setup is in [`docs/device-automation.md`](../../docs/device-automation.md)** —
that's the comprehensive guide covering one-time install, daily bring-up,
target architecture, and the long list of things that can go wrong. **Read it
once.** This section just covers the day-to-day commands.

### Daily bring-up

```bash
npm run dev
```

That's it. `scripts/dev.sh` runs Metro in the foreground and brings WDA up in
the background via `scripts/start-wda.sh`. If no iPhone is connected, WDA
bring-up skips gracefully and Metro starts as normal.

To bring WDA up without Metro: `npm run dev:wda`. Tail the bring-up log:
`tail -f wda.log`.

### Subcommands

```bash
npm run log-doctor -- phone help              # full reference
npm run log-doctor -- phone status            # WDA health
npm run log-doctor -- phone tree              # accessibility tree, testID-first
npm run log-doctor -- phone tree --all        # also include unlabeled containers
npm run log-doctor -- phone tap-id <testID>   # PREFERRED: tap by accessibility id
npm run log-doctor -- phone tap "<text>"      # FALLBACK: tap by visible label
npm run log-doctor -- phone tap-xy <x> <y>    # LAST RESORT: tap by coordinates
npm run log-doctor -- phone text "<input>"   # type into focused field
npm run log-doctor -- phone shot [path]       # save a PNG screenshot
npm run log-doctor -- phone home              # press home button
npm run log-doctor -- phone dismiss-modal     # swipe down to dismiss top sheet
npm run log-doctor -- phone swipe <dir>       # swipe up|down|left|right
```

### Verified end-to-end flows (`phone test`)

End-to-end tests live in `tests/*.sov` files at the repo root and use the
**Sovran Test DSL** — a line-oriented, verb-first language designed for this
codebase. See [`tests/README.md`](../../tests/README.md) for the full reference.

```bash
npm run log-doctor -- phone test              # list discovered tests
npm run log-doctor -- phone test <name>       # run a single test
npm run log-doctor -- phone test all          # run every test
npm run log-doctor -- phone test parse <file> # parse-only debug, prints AST
```

A passing run stamps a `# verified: <date> — <device>` line inside the test
block in place — file formatting is otherwise byte-identical, so your
comments and whitespace are preserved.

Quick example:

```
test "Create mint quote via keypad and verify pending entry"

  launch com.sovranbitcoin.dev
  tap #wallet-receive when visible
  tap #receive-fixed-amount when visible
  keypad 1
  tap #amount-next
  wait for screen #screen-mint-quote

  dismiss
  wait for screen #screen-wallet
  capture #transaction-mint-* suffix as $mintId

end
```

Selectors: `#testID` (preferred), `"text"` (fallback), `#prefix*` (wildcard).
Variables: `capture ... as $name`, interpolated as `${name}` or `$name`.
Control flow: `if visible / if not visible / repeat N times / define / run`.
Wallet ops: `wallet send cashu N as $token`, `wallet send bolt11 $invoice`,
etc. — these shell out to `cocod` (Cashu wallet daemon, must be running).

### Targeting priority — testID-first, always

The order matters and `phone` mode actively pushes you up it:

1. **`tap-id <testID>`** is the right answer 95% of the time. Stable across
   copy edits, i18n, theme changes, and layout reflows.
2. **`tap "<text>"`** is a fallback. When it has to use this path because no
   testID exists, it prints a loud nudge with the exact `rg` command to find
   the source and the recommended testID name to add. Fix it once, never see
   the nudge again.
3. **`tap-xy <x> <y>`** is the last resort. Always emits a nudge.

`ButtonHandler` and the `Button` primitive both already accept a `testID`
prop — adding one is a one-line change at the call site. Convention is
kebab-case `<screen>-<action>`, e.g. `receive-fixed-amount`, `send-confirm`,
`mint-add`. **Metro Fast Refresh picks up new testIDs immediately**, no
rebuild needed.

### Env overrides

| Variable | Default | Purpose |
|---|---|---|
| `WDA_BASE_URL` | `http://localhost:8100` | Override if you forwarded WDA to a different port |
| `WDA_PORT` | `8100` | Used by `start-wda.sh` |
| `IOS_UDID` | first device from `ios list` | Pin to a specific device |
| `WDA_BUNDLE_ID` | auto-discovered | Override the WDA runner bundle ID |

### Troubleshooting

The full troubleshooting list is in
[`docs/device-automation.md`](../../docs/device-automation.md#troubleshooting).
Common quick hits:

| Symptom | Fix |
|---|---|
| `WDA unreachable at http://localhost:8100` | `npm run dev:wda` (idempotent), or check `wda.log` |
| testIDs not showing up in `phone tree` | Metro hasn't hot-reloaded yet, or the element is unmounted |
| `phone tap "Receive"` taps a transaction history row | Add a testID to the global Receive button — `phone tap` will tell you exactly what to do |
| Driving the wrong app (prod vs dev) | Defaults to `com.sovranbitcoin.dev`. Override with `SOVRAN_BUNDLE_ID=...` |

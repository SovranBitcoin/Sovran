# codereview/

Tooling and prompts for code-quality review.

```
codereview/
├── audit.md             # read-only review prompt — produces __audits__/NN.json
├── fix.md               # write-capable counterpart — turns audits into PR-sized diffs
├── analyze-structure/   # repo-wide structural metrics + lookalikes subcommand
│   ├── index.mjs              # CLI dispatch + structural reports
│   ├── lookalikes-mode.mjs    # `lookalikes` subcommand entry
│   ├── extract.mjs            # exports / imports / identifiers
│   └── metrics.mjs            # LOC, complexity, type-smells, components, depth
├── log-doctor/          # session-log preprocessing for LLM debugging
│   ├── index.ts               # CLI dispatch + 18 modes
│   └── test-dsl/              # phone-test runner used by `phone` mode
└── shared/              # ignore lists, source utils, walker, ANSI, args
    ├── ignore.mjs       # IGNORE_DIRS, IGNORE_FILES, TS_EXTS, isTestPath
    ├── walk.mjs         # walkFiles
    ├── source.mjs       # stripCodeNoise, findMatchingBrace, line-index helpers
    ├── ansi.mjs         # dim/bold/yellow/red/green/cyan/magenta
    └── args.mjs         # getNumericArg, getStringArg
```

`npm run audit`, `npm run fix`, `npm run analyze-structure`, and
`npm run log-doctor` invoke these by their canonical paths. There are no
`scripts/` shims — paths in audit.md / fix.md / commands below match
exactly what gets run.

## Common conventions

These hold across all three tools so you don't have to re-derive flag
shapes per tool.

| Convention                     | What it means                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Positional first arg**       | Scopes the run. For `analyze-structure` and its `lookalikes` subcommand, it's a path (subtree to scan). For `log-doctor`, it's a mode name (`stats`, `errors`, `slow`, …). |
| `--json`                       | Machine-readable output — present everywhere. Pipe through `jq` to filter.                                                                                                 |
| Compact output for LLM context | `analyze-structure --llm` (~5K tokens), `log-doctor full --format md` (~6K).                                                                                               |
| `--no-<report>`                | Suppress a default-on report to compress output.                                                                                                                           |
| `--<threshold> N`              | Numeric tuning flag. Each tool documents its set below.                                                                                                                    |

Output too large to reason with? Pipe through `head -200`, narrow with
grep, or scope harder. Never paste raw 100k-line output into a finding,
slice plan, or commit message.

## When to reach for which

| Symptom or question                               | Tool                           | Mode / flag                     |
| ------------------------------------------------- | ------------------------------ | ------------------------------- |
| "Where should we refactor next?"                  | `analyze-structure`            | `--llm` (score block)           |
| "Which files are too coupled?"                    | `analyze-structure`            | default — fanin/coupling/cycles |
| "Does this one file show up in any hotspot?"      | `analyze-structure`            | `--focus path/to/file.ts`       |
| "Where are the duplicate names?"                  | `analyze-structure lookalikes` | default reports                 |
| "Two values look the same — are they?"            | `analyze-structure lookalikes` | `--by-value '#FF0000'`          |
| "What's `red` defined as in this repo?"           | `analyze-structure lookalikes` | `--by-name red`                 |
| "Did this file change touch any near-duplicates?" | `analyze-structure lookalikes` | `--focus path/to/file.ts`       |
| "What broke in the last session?"                 | `log-doctor`                   | `errors --latest --context 5`   |
| "Why is the app slow on launch?"                  | `log-doctor`                   | `startup --latest`              |
| "What screens did the user hit before crashing?"  | `log-doctor`                   | `screens --latest`              |
| "Is there a memory leak?"                         | `log-doctor`                   | `gc --latest`                   |
| "Which mode fits in my context window?"           | `log-doctor`                   | `budget`                        |

## analyze-structure

Repo-wide structural metrics. One CLI, two modes:

- **default** — structural / depth / quality / symbol / concept reports plus
  the `--llm` compact summary (which includes the structural-health score).
- **`lookalikes` subcommand** — cross-file declaration similarity reports
  (name collisions, value collisions, color near-matches, name similarities,
  focus / by-name / by-value / inventory lookups).

Both share the file walker, source utilities, and ignore lists from
`shared/`. The default mode also pulls per-file metrics from
`metrics.mjs` and structural extraction from `extract.mjs`.

### Dense-output recipes

```bash
# 1. Score block only (~300 tokens) — pick a slice, judge "did this help?"
node codereview/analyze-structure/index.mjs --llm | sed -n '/^Overall:/,/^# Repo/p'

# 2. Top of LLM summary (~2K tokens) — score + headline counts + top hotspots.
node codereview/analyze-structure/index.mjs --llm | head -180

# 3. Full LLM summary (~5K tokens).
node codereview/analyze-structure/index.mjs --llm

# 4. Subtree only.
node codereview/analyze-structure/index.mjs features/payments --llm
node codereview/analyze-structure/index.mjs coco-payment-ux --llm

# 5. Single dimension — disable everything else for max signal-to-noise.
node codereview/analyze-structure/index.mjs --llm \
  --no-fanin --no-coupling --no-cycles --no-orphans --no-colocate \
  --no-component --no-typesafety

# 6. Focus on one file — full repo pass, then filter to sections that
#    cite it. Sections without per-file rows (Score, totals, Instability
#    per folder) pass through unchanged. Silence in a hotspot section
#    means the file genuinely has no signal in that dimension.
node codereview/analyze-structure/index.mjs --llm --focus features/foo/Bar.tsx
```

### lookalikes subcommand recipes

```bash
# Default reports (whole repo).
node codereview/analyze-structure/index.mjs lookalikes

# Subtree only.
node codereview/analyze-structure/index.mjs lookalikes features/payments

# Targeted lookups (each <500 tokens). Use when an existing finding cites
# a literal value or identifier and you want to know where else it lives.
node codereview/analyze-structure/index.mjs lookalikes --by-name red
node codereview/analyze-structure/index.mjs lookalikes --by-value '#FF0000'

# Focus mode — full reports filtered to pairs involving one file.
node codereview/analyze-structure/index.mjs lookalikes --focus shared/theme.ts

# Inventory dump — every variable name in the repo, alphabetised.
# ~40K tokens; pipe through grep to narrow.
node codereview/analyze-structure/index.mjs lookalikes --dump variables | grep -i color
```

### Tuning flags

**Default mode**

| Flag                     | Default | What it does                            |
| ------------------------ | ------- | --------------------------------------- |
| `--component-lines`      | 300     | Component size warning threshold        |
| `--complexity-threshold` | 25      | Cognitive-complexity warning threshold  |
| `--hook-max`             | 7       | Max hooks per component before warning  |
| `--shallow-min-exports`  | 4       | Minimum exports to qualify as "shallow" |
| `--reach-top`            | 25      | Top-N high-reach files to surface       |
| `--leakage-threshold`    | 0.6     | Jaccard threshold for leakage clusters  |

Opt-in (off by default): `--history --since 6` (months of git history),
`--reach`, `--leakage`, `--vocab-drift`, `--architecture` (uses
`.architecture.json`), `--boundary <a> <b>`.

**`lookalikes` subcommand**

| Flag                                                     | Default | What it does                                      |
| -------------------------------------------------------- | ------- | ------------------------------------------------- |
| `--color-distance`                                       | 30      | Max RGB distance for color near-matches           |
| `--name-distance`                                        | 2       | Max Levenshtein for name similarities             |
| `--min-collision`                                        | 2       | Only show collisions with ≥N alternatives         |
| `--no-color-near` / `--no-name-near` / `--no-collisions` | —       | Skip a category to compress output                |
| `--include-tests`                                        | off     | By default `__tests__` and `*.test.*` are skipped |
| `--show-noise`                                           | off     | Include single-letter / generic names             |

## log-doctor

Reads structured JSON logs (from `dumpForLLM()` or piped input). Token
costs below come from `npx tsx codereview/log-doctor/index.ts budget` on
a typical session — your numbers will differ.

| Mode               | Typical tokens | What it shows                            |
| ------------------ | -------------- | ---------------------------------------- |
| `renders`          | ~266           | Re-render counts, why-did-update hints   |
| `stats`            | ~1.1K          | Event frequency, slowest ops, error rate |
| `coco`             | ~3K            | Coco wallet module breakdown             |
| `network`          | ~4K            | Request/response pairs with latency      |
| `timeline`         | ~5K            | One-line-per-entry with delta timing     |
| `startup`          | ~5K            | Initialization waterfall, gate sequence  |
| `full --format md` | ~6K            | Pipe-delimited dense summary             |
| `slow`             | ~18K           | Operations exceeding threshold           |
| `screens`          | ~70K           | Screen flow + content snapshots          |
| `errors`           | ~90K           | Errors with full context                 |

### Recipes

```bash
# Default audit-prep sequence — fits in <30K tokens together.
npx tsx codereview/log-doctor/index.ts stats   --latest
npx tsx codereview/log-doctor/index.ts errors  --latest --context 5
npx tsx codereview/log-doctor/index.ts slow    --latest --threshold 200
npx tsx codereview/log-doctor/index.ts coco    --latest

# Cap any mode at a token budget — output is auto-pruned to fit.
npx tsx codereview/log-doctor/index.ts errors --token-budget 8000

# Pagination for huge sessions.
npx tsx codereview/log-doctor/index.ts timeline --limit 200 --offset 0
```

### Tuning flags

| Flag                            | Default   | What it does                                                 |
| ------------------------------- | --------- | ------------------------------------------------------------ |
| `--latest`                      | off       | Only the most recent session (detects `_t` resets)           |
| `--no-inst`                     | off       | Strip instrumentation events (render.count, state.change, …) |
| `--threshold <ms>`              | 500       | Duration threshold for `slow` mode                           |
| `--context <n>`                 | 3         | Entries before/after each error                              |
| `--token-budget <n>`            | unlimited | Auto-prune output to fit                                     |
| `--event <pattern>`             | —         | Filter to events matching substring                          |
| `--since <ms>` / `--until <ms>` | —         | Time-window filter                                           |
| `--format json\|yaml\|md`       | json      | Output format for `full` mode                                |

## How audit.md and fix.md use these

**audit.md, Pass 1:**

1. `analyze-structure --llm` (score block first) — picks a dimension.
2. `analyze-structure lookalikes <subtree>` (focused) — checks for duplicate-pattern clusters.
3. `log-doctor stats/errors/slow/coco --latest` — pulls runtime evidence.

**fix.md** does the same plus a mandatory cross-link rule: when picking
a slice, findings whose files appear in the lowest-scoring
`analyze-structure` sub-dimension OR in `lookalikes` collision reports
are bundled together so one slice closes the audit _and_ improves
structure. The Phase 4 plan template has a "Structural signal folded in"
line; self-check 10b enforces it.

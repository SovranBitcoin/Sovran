# codereview/

Tooling and prompts for code-quality review. Three CLIs that produce
machine-readable signals, two prompts that drive the review/fix workflow.

```
codereview/
├── audit.md           # read-only review prompt — produces __audits__/NN.json
├── fix.md             # write-capable counterpart — turns audits into PR-sized diffs
├── analyze-structure/ # repo-wide structural metrics (fan-in, cycles, complexity, …)
├── lookalikes/        # cross-file declaration similarity (collisions, near-matches)
├── log-doctor/        # session-log preprocessing for LLM debugging
└── shared/            # ignore lists, source utils, walker, ANSI, args
```

The three scripts share `shared/` for ignore lists, `stripCodeNoise`,
the file walker, ANSI colors, and CLI helpers. `npm run
analyze-structure` and `npm run log-doctor` invoke them by their
canonical paths under `codereview/`.

## When to reach for which

| Symptom or question                               | Tool                | Mode / flag                     |
| ------------------------------------------------- | ------------------- | ------------------------------- |
| "Where should we refactor next?"                  | `analyze-structure` | `--llm` (score block)           |
| "Which files are too coupled?"                    | `analyze-structure` | default — fanin/coupling/cycles |
| "Where are the duplicate names?"                  | `lookalikes`        | default reports                 |
| "Two values look the same — are they?"            | `lookalikes`        | `--by-value '#FF0000'`          |
| "What's `red` defined as in this repo?"           | `lookalikes`        | `--by-name red`                 |
| "Did this file change touch any near-duplicates?" | `lookalikes`        | `--focus path/to/file.ts`       |
| "What broke in the last session?"                 | `log-doctor`        | `errors --latest --context 5`   |
| "Why is the app slow on launch?"                  | `log-doctor`        | `startup --latest`              |
| "What screens did the user hit before crashing?"  | `log-doctor`        | `screens --latest`              |
| "Is there a memory leak?"                         | `log-doctor`        | `gc --latest`                   |
| "Which mode fits in my context window?"           | `log-doctor`        | `budget`                        |

## Dense-output recipes

Every recipe below is sized for an LLM context window. Token estimates are
approximate — actual output scales with repo size / log volume.

### analyze-structure

```bash
# 1. Score block only — lowest-cost signal, ~300 tokens.
#    Use this when picking a slice or judging "did the refactor help?"
node codereview/analyze-structure/index.mjs --llm | sed -n '/^Overall:/,/^# Repo/p'

# 2. Top of LLM summary — score + headline counts + top hotspots, ~2K tokens.
node codereview/analyze-structure/index.mjs --llm | head -180

# 3. Full LLM summary — every report, compacted, ~5K tokens.
node codereview/analyze-structure/index.mjs --llm

# 4. Subtree only — scope the analysis to one feature.
node codereview/analyze-structure/index.mjs features/payments --llm

# 5. Single dimension — disable other reports for max signal-to-noise.
node codereview/analyze-structure/index.mjs --llm \
  --no-fanin --no-coupling --no-cycles --no-orphans --no-colocate \
  --no-component --no-typesafety
```

`--llm` is the LLM-friendly compact format. `--json` is the same data
machine-readable. Default human format is for terminal reading and is too
large for context windows.

Tuning flags worth knowing:

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

### lookalikes

```bash
# 1. Inventory dump — every variable name in the repo, alphabetised.
#    ~40K tokens; pipe through grep to narrow.
node codereview/lookalikes/index.mjs --dump variables | grep -i 'color'

# 2. By-name lookup — every definition of a single identifier, with file:line.
#    <500 tokens for typical names.
node codereview/lookalikes/index.mjs --by-name red

# 3. By-value lookup — every place a literal value is bound.
#    <500 tokens. Useful for hex colors, magic numbers, default strings.
node codereview/lookalikes/index.mjs --by-value '#FF0000'

# 4. Focus mode — full reports filtered to pairs involving one file.
#    Sized to whatever the file's footprint is, usually <5K tokens.
node codereview/lookalikes/index.mjs --focus shared/theme.ts

# 5. Subtree only — limit the scan radius.
node codereview/lookalikes/index.mjs features/payments
```

Tuning flags:

| Flag                                                     | Default | What it does                                      |
| -------------------------------------------------------- | ------- | ------------------------------------------------- |
| `--color-distance`                                       | 30      | Max RGB distance for color near-matches           |
| `--name-distance`                                        | 2       | Max Levenshtein for name similarities             |
| `--min-collision`                                        | 2       | Only show collisions with ≥N alternatives         |
| `--no-color-near` / `--no-name-near` / `--no-collisions` | —       | Skip a category to compress output                |
| `--include-tests`                                        | off     | By default `__tests__` and `*.test.*` are skipped |
| `--show-noise`                                           | off     | Include single-letter / generic names             |

### log-doctor

Reads structured JSON logs (from `dumpForLLM()` or piped input). Token
costs below come from `npx tsx codereview/log-doctor/index.ts budget` on a
typical session — your numbers will differ.

| Mode        | Typical tokens | What it shows                            |
| ----------- | -------------- | ---------------------------------------- |
| `renders`   | ~266           | Re-render counts, why-did-update hints   |
| `stats`     | ~1.1K          | Event frequency, slowest ops, error rate |
| `coco`      | ~3K            | Coco wallet module breakdown             |
| `network`   | ~4K            | Request/response pairs with latency      |
| `timeline`  | ~5K            | One-line-per-entry with delta timing     |
| `startup`   | ~5K            | Initialization waterfall, gate sequence  |
| `full (md)` | ~6K            | Pipe-delimited dense summary             |
| `slow`      | ~18K           | Operations exceeding threshold           |
| `screens`   | ~70K           | Screen flow + content snapshots          |
| `errors`    | ~90K           | Errors with full context                 |

Recipes:

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

Tuning flags:

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

`audit.md` runs in Phase 0:

1. `analyze-structure --llm` (score block) — picks a dimension.
2. `lookalikes` (focused) — checks for duplicate-pattern clusters.
3. `log-doctor stats/errors/slow/coco --latest` — pulls runtime evidence.

`fix.md` does the same plus a cross-link rule: when picking a slice,
findings whose files appear in the lowest-scoring `analyze-structure`
sub-dimension OR in `lookalikes` collision reports are bundled together
so one slice closes the audit _and_ improves structure.

See those prompts for the full workflow.

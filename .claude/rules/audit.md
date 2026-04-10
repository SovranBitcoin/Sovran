# LLM-powered PR review for a React Native wallet codebase

**A multi-pass review pipeline with a dedicated judge agent is the single most effective architecture for automated PR audits.** HubSpot's production deployment of this pattern achieved an **80%+ developer approval rate**, and Ellipsis's multi-stage filtering pipeline produces the lowest false-positive rate among commercial tools. For a 100–500 file React Native/Expo wallet app with Zustand, Cashu ecash, and Nostr integration, the optimal system combines a summarize-then-review-then-judge pipeline, domain-specific review dimensions weighted by financial risk, and structured JSON output with severity-gated posting. The concrete prompt templates and implementation patterns below can be wired into a GitHub Actions workflow immediately.

---

## 1. The three-pass review architecture outperforms single-shot prompting

Research across academic papers (Meta's semi-formal reasoning, Microsoft's CORE framework) and production systems (HubSpot's Sidekick, Ellipsis) converges on a consistent finding: **multi-pass review with a dedicated filtering stage reduces false positives by 50–70%** compared to single-pass approaches. The optimal architecture has three stages.

**Pass 1 — Discovery** casts a wide net. A comprehensive reviewer prompt finds all potential issues with high recall, accepting some noise. Use a detailed 400+ word prompt with explicit review dimensions — research shows detailed prompts dramatically outperform short generic ones like "do a brief code review." Temperature **0.2–0.3** keeps output deterministic.

**Pass 2 — Judge filtering** is the highest-ROI component. HubSpot calls this "arguably the single most important factor" in their system's effectiveness. A separate LLM call evaluates each finding against accuracy, actionability, and substantiveness criteria. Findings that fail any criterion are removed. This single addition transformed their developer reception from majority-dismissed to 80%+ approval.

**Pass 3 — Prioritization and deduplication** merges findings about the same root cause, orders by severity, groups by file, and formats for posting. Use a cheaper model here (e.g., Claude Haiku or GPT-4.1-mini) since the task is formatting, not reasoning.

**When to use single-pass instead:** PRs under 100 lines of changed code, config-only changes, or documentation PRs. Add the judge pass even for single-pass reviews — the cost of one extra API call (approximately 15 seconds and a few cents) pays for itself in developer trust.

### The discovery prompt template

```
You are a code reviewer for a React Native / Expo SDK 55 mobile wallet app
written in TypeScript. The app uses Zustand v5 for state management,
expo-router for navigation, react-native-reanimated v4 for animations,
and implements the Cashu ecash protocol with Nostr (NIP-60/NIP-44) integration.
The backend uses Hono on Bun.

## Your task
Analyze the PR diff below and identify ALL potential issues. Be thorough —
it is better to flag something that turns out to be fine than to miss a
real bug. Focus on NEW code (lines starting with '+') and only issues
INTRODUCED by this PR.

## Review dimensions (in priority order)
1. SECURITY: Key material in state/logs, ecash token leakage, input
   validation on payment amounts, SecureStore usage, NFC data exposure
2. CORRECTNESS: Logic errors, null/undefined risks, incorrect
   conditionals, off-by-one errors, missing edge cases
3. ASYNC/CONCURRENCY: Race conditions in payment flows, stale closures,
   missing AbortController cleanup, unguarded double-tap on transaction
   buttons, floating promises
4. ZUSTAND HYGIENE: Unstable selectors (inline objects/arrays/functions),
   missing useShallow, selecting entire store, sensitive data in
   persisted state, missing persist migration version
5. REACT NATIVE PERFORMANCE: Shared value reads on JS thread, missing
   'worklet' directives, non-memoized renderItem/gesture objects, bridge
   thrashing, unnecessary re-renders from missing React.memo boundaries
6. EXPO-ROUTER: Missing initialRouteName in unstable_settings, auth
   bypass via deep links, modal dismiss not cleaning up payment state,
   router.push where router.replace is needed
7. TYPESCRIPT: any-casts, @ts-ignore without justification, non-null
   assertions (!.), missing return types on async functions, catch
   blocks not narrowing unknown
8. ACCESSIBILITY: Missing accessibilityLabel/Role on interactive
   elements, touch targets < 44pt, no platform parity checks

## Rules
- Do NOT comment on formatting, import ordering, or naming preferences
- Do NOT suggest adding comments or documentation unless critical
- If you are unsure about context you cannot see, say "Worth verifying"
  rather than asserting a bug
- For each finding, specify the exact file path and line number(s)

## PR context
Title: {{pr_title}}
Description: {{pr_description}}
Changed files: {{file_list_with_change_counts}}

## Diff
{{diff_content}}

## Output format
Return a JSON array of findings:
[
  {
    "id": "F-001",
    "severity": "critical|major|minor|nitpick",
    "category": "security|correctness|concurrency|zustand|performance|navigation|typescript|accessibility",
    "confidence": 0.0-1.0,
    "file": "src/path/to/file.ts",
    "start_line": 42,
    "end_line": 45,
    "title": "One-line summary",
    "description": "Why this is a problem and what the impact is",
    "suggested_fix": "Concrete code or actionable instruction",
    "evidence": "The specific code pattern that triggers this concern"
  }
]
```

### The judge prompt template

```
You are a senior engineer filtering AI code review findings to remove noise.
Your goal: keep only findings that a competent developer would find genuinely
useful. Every false positive erodes developer trust.

## Evaluation criteria
For each finding, answer:
1. ACCURACY — Is this technically correct given the visible code context?
2. ACTIONABILITY — Does it suggest a specific, implementable fix?
3. SUBSTANTIVENESS — Is this a real bug, security issue, or performance
   problem? Or is it a stylistic preference / theoretical concern?
4. CONTEXT-AWARENESS — Could this be intentionally designed this way?
   Does the framework/library handle this automatically?

## Decision rules
- KEEP if it passes ALL four criteria
- REMOVE if it fails ANY criterion
- DOWNGRADE severity if the finding is real but lower-impact than stated
- For confidence < 0.6: REMOVE unless it's a security finding
- For category "nitpick": REMOVE unless it prevents a bug

## Input
Original findings: {{pass1_findings}}
Full file context for referenced files: {{file_contexts}}

## Output
Return a JSON object:
{
  "kept": [ ...findings with original IDs ],
  "removed": [
    { "id": "F-003", "reason": "Framework handles this via middleware" }
  ],
  "modified": [
    { "id": "F-005", "change": "Downgraded from critical to minor",
      "reason": "Input is already validated upstream in validateAmount()" }
  ]
}
```

---

## 2. Eight review dimensions calibrated for a wallet app's risk profile

Not all review dimensions carry equal weight in a financial application. **Security and concurrency bugs can cause irreversible loss of funds**, making them categorically different from style or performance concerns. The review system must encode this priority hierarchy explicitly in prompts and in the posting threshold for each category.

### Security: the non-negotiable layer

Ecash tokens are **bearer instruments** — anyone who sees a token string can spend it. This makes Cashu token handling analogous to handling credit card numbers, not session tokens. The reviewer must flag: any `console.log`, error reporter (Sentry), or analytics call that could capture token strings; any ecash proof stored in Zustand's persisted state (use `partialize` to exclude); any Nostr `nsec` private key stored anywhere except `expo-secure-store` with `requireAuthentication: true` and `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; any NFC data exchange that transmits tokens in cleartext without NIP-44 encryption; and any payment amount input that accepts non-integer, negative, NaN, or Infinity values.

### Zustand v5 selector stability

Zustand v5 uses **`Object.is` strict equality** for selector comparison by default. This means any selector returning a new reference (inline array, object, or fallback function) causes infinite re-renders and crashes with "Maximum update depth exceeded." The three most common anti-patterns to catch are: `useStore(s => [s.a, s.setA])` (inline array — fix with `useShallow`), `useStore(s => s.items.filter(predicate))` (filter inside selector — select raw data, filter outside), and `useStore(s => s.action ?? () => {})` (inline fallback — hoist the fallback to a module-level constant). Every `useStore()` call without a selector function should be flagged as selecting the entire store.

### Reanimated v4 worklet correctness

Reanimated v4 requires the **New Architecture (Fabric)** and extracts worklets to `react-native-worklets`. Critical checks: the Babel plugin `react-native-worklets/plugin` must be **last** in the plugins array; every callback passed to gesture handlers must include a `'worklet'` directive as its first line; `useAnimatedGestureHandler` is removed in v4 (must use Gesture Handler 2 API with `Gesture.Pan()`, `Gesture.Tap()` etc.); reading `sharedValue.value` on the JS thread blocks until the value is fetched from the UI thread; and any navigation call from a worklet must use `runOnJS` or `scheduleOnRN`, not direct `router.back()`.

### Async and concurrency in payment flows

Double-tap on a "Pay" or "Melt" button without an inflight guard can cause double-spend attempts. The canonical pattern uses a ref-based guard (`payingRef.current`), a `try/finally` block to reset it, functional state updates (`setBalance(prev => prev - amount)`) to avoid stale closures, and `AbortController` cleanup in every `useEffect` that makes network calls. NFC sessions must be explicitly cancelled on component unmount. Zustand `subscribe` calls must return unsubscribe functions consumed in effect cleanup. Token swap, mint, and melt operations should be serialized through a mutex or queue.

### Expo-router, TypeScript, accessibility, and patch-package

For **expo-router**: every `_layout.tsx` with a Stack needs `unstable_settings` with `initialRouteName` so back-navigation works on deep links; auth state must be checked in the root layout with `<Redirect>` for unauthenticated users; and modal screens must reset payment state on dismiss. For **TypeScript**: flag every `as any`, `@ts-ignore`, and `!.` non-null assertion; catch blocks must narrow `unknown` with `instanceof Error`; payment-related functions require strict numeric types. For **accessibility**: every `Pressable` and `TouchableOpacity` needs `accessibilityLabel` and `accessibilityRole`; touch targets must be ≥ 44pt; payment amounts need descriptive labels (`Balance: ${amount} sats`). For **patch-package**: each patch file should be under 50 lines, reference an upstream issue URL, and have a `postinstall` script in `package.json`.

---

## 3. Processing 100–500 file PRs without losing signal

Large diffs overwhelm LLMs through two mechanisms: the "lost in the middle" effect (models attend more to the start and end of context, missing content in the middle) and simple information overload causing shallow analysis. **The solution is a summarize-then-review pipeline with aggressive filtering and semantic grouping.**

### Step 1: Filter before any LLM call

Remove all files that provide no review value. This typically eliminates 20–40% of changed files:

```typescript
const SKIP_PATTERNS = [
  /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
  /\.snap$/, // test snapshots
  /\/generated\//, /\.gen\.ts$/,
  /\.(png|jpg|svg|gif|ico|woff|ttf|eot)$/,
  /\/dist\//, /\/build\//, /\/\.expo\//,
  /\.d\.ts$/, // type declaration files (unless hand-written)
];
```

### Step 2: Summarize the full PR

Send only file names with change counts (additions/deletions) and the PR description to generate a **structural summary**. This summary becomes system context for all subsequent file-level reviews, giving the model "reviewer memory" of the overall intent.

```
Given this PR metadata, generate a concise structural summary:

PR: {{title}}
Description: {{description}}
Files changed ({{count}} total):
{{#each files}}
  {{status}} {{path}} (+{{additions}} -{{deletions}})
{{/each}}

Respond with:
1. INTENT: What is this PR trying to accomplish? (2-3 sentences)
2. RISK AREAS: Which changes are highest-risk? (rank top 5 files)
3. GROUPINGS: Cluster related files by logical change unit
4. SKIP CANDIDATES: Files that are boilerplate/config/generated
```

### Step 3: Priority-based file ordering with token budgets

Allocate review depth by risk tier. PR-Agent's compression strategy — which fits files into the context window in priority order, adding patches until reaching a token buffer — is the most proven approach:

| Priority | File types | Token budget | Review depth |
|---|---|---|---|
| P0 | Auth, payments, key management, ecash flows | 40% of budget | Full diff + surrounding context |
| P1 | Core business logic, API handlers, Zustand stores | 30% of budget | Full diff |
| P2 | UI components, navigation, animations | 20% of budget | Additions only |
| P3 | Tests, config, docs, migrations | 10% of budget | Skim for obvious issues |

### Step 4: Map-reduce for cross-file synthesis

Review individual files (or semantic groups) in parallel, then run a **reduce pass** that aggregates findings, deduplicates across files, and checks whether issues flagged in one file are actually addressed by changes in another. This catches a class of false positives that per-file review cannot: "missing null check" in file A when file B added the validation upstream.

```
You have reviewed {{file_count}} files individually. Below are the
aggregated findings. Perform cross-file analysis:

1. DEDUPLICATE: Merge findings about the same root cause
2. CROSS-CHECK: Are any findings invalidated by changes in other files?
3. INTEGRATION: Are there cross-file issues not visible in per-file review?
   (e.g., renamed exports with stale imports, changed type signatures
   with unchecked callers, state shape changes without migration)
4. PRIORITIZE: Final ranking by severity

Individual file findings:
{{per_file_findings}}

Changed file list with groupings:
{{file_groupings_from_summary}}
```

---

## 4. Output format that drives action, not noise

The output format determines whether developers engage with or ignore the review. **Three design principles matter most**: severity-gated posting thresholds so trivial findings never appear, file:line precision for one-click navigation, and suggested fixes as committable code diffs rather than prose.

### Severity definitions calibrated for a wallet app

```
CRITICAL: Blocks merge. Security vulnerability with clear attack vector,
  data loss risk, funds loss, crash in payment flow.
  → Always post. Always require explicit acknowledgment.

MAJOR: Should fix before merge. Logic error in business flow, race
  condition, missing error handling on transaction, auth bypass on
  deep link.
  → Always post. Require response (fix or explicit "accepted risk").

MINOR: Recommended fix. Suboptimal pattern, missing memo boundary,
  TypeScript looseness, accessibility gap.
  → Post only if confidence ≥ 0.7.

NITPICK: Optional. Style suggestion, naming alternative.
  → Never post automatically. Include only in summary table.
```

### Machine-parseable output schema

```json
{
  "review": {
    "verdict": "REQUEST_CHANGES | APPROVE | COMMENT",
    "summary": "2-3 sentence summary of findings and overall PR quality",
    "risk_level": "low | medium | high | critical",
    "stats": {
      "files_reviewed": 45,
      "files_skipped": 12,
      "critical": 1, "major": 3, "minor": 5, "nitpick": 2
    }
  },
  "findings": [
    {
      "id": "F-001",
      "severity": "critical",
      "category": "security",
      "confidence": 0.92,
      "file": "src/wallet/cashu/melt.ts",
      "start_line": 87,
      "end_line": 89,
      "title": "Ecash proofs logged to console in melt flow",
      "description": "console.log on line 88 outputs the full proof array including secret values. Anyone with device log access can extract and spend these tokens.",
      "impact": "Direct funds loss if logs are captured by crash reporter or exposed via USB debugging",
      "suggested_fix": "```diff\n- console.log('Melting proofs:', proofs);\n+ console.log('Melting proof count:', proofs.length);\n```",
      "evidence": "console.log('Melting proofs:', proofs) on line 88"
    }
  ]
}
```

### Posting strategy that builds trust

PR-Agent's approach of presenting most suggestions in a **summary table** rather than inline comments significantly reduces PR footprint. Only critical and major findings should appear as inline comments with suggested code changes. Minor findings appear in a collapsible summary section. Nitpicks are suppressed entirely. The **"no comment" option is powerful** — systems that leave no comments when code is clean build far more trust than those that always find something to say.

---

## 5. How the commercial tools compare on what matters

Six tools dominate the LLM PR review space, each with a distinct architectural philosophy. **PR-Agent is the best starting point for customization** because its prompts are fully open-source and auditable. **Ellipsis achieves the lowest false-positive rate** through its multi-agent decomposition with dedicated filtering pipeline. **CodeRabbit has the deepest context awareness** but suffers from comment fatigue.

**PR-Agent (Qodo Merge)** uses role prompting ("You are PR-Reviewer") with Pydantic-defined YAML output schemas. Its prompts are in TOML files under `pr_agent/settings/` — the most transparent prompt architecture available. Its compression strategy is the gold standard for handling large diffs: adaptive, token-aware file patch fitting with a custom diff format that prioritizes additions over deletions. Weakness: primarily operates on the diff, so it can miss cross-file architectural issues. **Free and self-hostable**, supports GPT, Claude, Gemini, and DeepSeek.

**Ellipsis** decomposes review into **dozens of smaller specialized agents** that run in parallel (one per issue type), each with a shared Code Search subagent. Its four-stage filtering pipeline — deduplication, confidence threshold, hallucination detection with attached evidence, and comment editing — is the most sophisticated noise-reduction system available. Uses Turbopuffer as a vector store for incremental repository indexing. Weakness: GitHub-only, $40/seat.

**CodeRabbit** uses a hybrid pipeline-agentic architecture with multi-model orchestration, AST parsing, and **40+ deterministic code analyzers** alongside LLM analysis. It generates walkthrough summaries with architectural flow diagrams and learns from team feedback over time. Weakness: highest comment volume among tools (~58% actionable rate vs. 84% for custom agent approaches), which can overwhelm developers.

**GitHub Copilot Code Review** shifted to an **agentic tool-calling architecture** in March 2026, reading full diffs, examining surrounding code, and exploring the repository structure. It fuses LLM analysis with CodeQL security scanning and ESLint. The killer feature is auto-fix hand-off to the Copilot coding agent, which creates a stacked PR with implemented fixes. Weakness: surface-level compared to dedicated tools, premium request limits (300/month on Business), single-repo context only.

**Sourcery** runs a chain of specialized LLM reviewers and generates visual architecture diagrams. Good Python heritage but high noise rate in practice — one evaluation found ~50% noise and ~25% bikeshedding. **Codacy** is primarily a mature static analysis platform (49 languages, 12+ years) with an AI layer bolted on; its AI features are less advanced than newer tools but its deterministic rule coverage is comprehensive.

### What to steal from each tool

- **From PR-Agent**: The compression strategy and YAML-structured output prompting
- **From Ellipsis**: The multi-stage filtering pipeline and confidence-based posting thresholds
- **From CodeRabbit**: Context enrichment philosophy — assemble the right context rather than writing clever prompts
- **From Copilot**: Deterministic tool integration (run ESLint/TypeScript compiler alongside LLM)
- **From HubSpot's Sidekick**: The judge agent as a mandatory second pass

---

## 6. Self-review, adversarial validation, and learning from feedback

### The judge agent pattern (implement this first)

HubSpot's production deployment proved that **a two-stage process is the single most important factor** in review quality. Their judge evaluates each comment against succinctness, accuracy, and actionability. Before adding the judge, their most common failure was unhelpful feedback — verbose, congratulatory, or nitpicky. Prompt tuning alone could not fix it because improvements in one area caused regressions elsewhere. The judge provided an independent quality gate.

### Adversarial author-defense pass

For medium-to-high severity findings, prompt the LLM to role-play as the PR author defending the code. This catches false positives that arise from missing context:

```
You are the developer who wrote this code. For each finding below,
argue why it might be a false positive:
- Could this be intentional given surrounding code context?
- Does the framework/library handle this automatically?
- Is the reviewer missing context about how this code is called?
- Is this a theoretical concern with no practical exploit path?

For each finding:
- DEFENSE: Your argument
- STRENGTH: weak | moderate | strong
- VERDICT: LIKELY_FALSE_POSITIVE if defense is strong

Findings: {{findings}}
Code context: {{full_file_context}}
```

**Caution**: LLMs are systematically overconfident in debates — research shows models start at 72.9% confidence (vs. a rational 50% baseline) and escalate rather than calibrate. Use this pass to flag potential false positives for human review, not to automatically dismiss findings.

### Multi-model ensemble for high-stakes PRs

The **k-review pattern** sends shuffled variants of the diff to multiple models (e.g., Claude Sonnet, GPT-4.1, Gemini Pro) with slightly varying temperatures. Shuffling the file order prevents all models from fixating on the same obvious issues. Findings agreed upon by 4+ of 6 models are marked "strong consensus." This is expensive (6–7× the cost of single-pass) but provides the highest precision for PRs touching payment flows or key management.

### Building a feedback loop

Track at the individual comment level, not the PR level. Implement emoji reactions (👍/👎) on each posted finding. Track four metrics over time: **false positive rate by category** (security findings should be below 5%, style findings are tolerable at 20%), **comment addressing rate** (did the developer actually change the code?), thumbs-up ratio, and cost per actionable finding. When a finding type is dismissed 3+ times, add it to a suppression list:

```yaml
# .ai-review-config.yml
known_false_positives:
  - pattern: "missing null check on mintApi.get*()"
    reason: "Mint API layer guarantees non-null via internal validation"
  - pattern: "unused import"
    reason: "Handled by ESLint auto-fix, not an AI review concern"

suppress_categories:
  - documentation_suggestions
  - naming_convention

review_constitution:
  - "Every finding MUST reference a specific line and explain concrete impact"
  - "Do NOT flag style preferences unless they violate .eslintrc"
  - "Assume the author is competent — explain WHY, not just WHAT"
  - "If the code works correctly but could be 'more elegant,' do not flag it"
  - "Do not congratulate or praise — only actionable findings"
  - "Priority: security > correctness > performance > maintainability > style"
```

---

## 7. Complete GitHub Actions workflow skeleton

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  ai-review:
    runs-on: ubuntu-latest
    # Skip bot PRs and draft PRs
    if: github.actor != 'dependabot[bot]' && !github.event.pull_request.draft
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get diff and metadata
        id: diff
        run: |
          # Generate filtered diff excluding noise files
          git diff origin/${{ github.base_ref }}...HEAD \
            -- . \
            ':!package-lock.json' ':!yarn.lock' ':!*.snap' \
            ':!dist/' ':!.expo/' ':!*.gen.ts' \
            > /tmp/pr_diff.txt

          # Count changed files for pipeline selection
          FILE_COUNT=$(git diff --name-only origin/${{ github.base_ref }}...HEAD | wc -l)
          echo "file_count=$FILE_COUNT" >> $GITHUB_OUTPUT

      - name: Run multi-pass AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          python .github/scripts/ai_review.py \
            --diff /tmp/pr_diff.txt \
            --pr-number ${{ github.event.pull_request.number }} \
            --file-count ${{ steps.diff.outputs.file_count }} \
            --config .ai-review-config.yml
```

```python
# .github/scripts/ai_review.py (skeleton)
async def review_pr(diff: str, pr_context: dict, file_count: int):
    # Step 1: Summarize (for large PRs)
    if file_count > 20:
        summary = await llm_call(
            model="claude-sonnet-4-20250514",
            prompt=SUMMARY_PROMPT.format(**pr_context),
            temperature=0.2
        )
    else:
        summary = pr_context["description"]

    # Step 2: Discovery pass
    findings = await llm_call(
        model="claude-sonnet-4-20250514",
        prompt=DISCOVERY_PROMPT.format(
            diff=diff, summary=summary, **pr_context
        ),
        temperature=0.3
    )

    # Step 3: Judge filtering
    filtered = await llm_call(
        model="claude-sonnet-4-20250514",
        prompt=JUDGE_PROMPT.format(
            findings=findings,
            file_contexts=get_file_contexts(diff)
        ),
        temperature=0.1
    )

    # Step 4: Apply repo-specific suppression rules
    final = apply_suppression_rules(filtered, load_config())

    # Step 5: Post (severity-gated)
    for finding in final:
        if finding.severity in ("critical", "major"):
            post_inline_comment(finding)  # GitHub Review API
        elif finding.severity == "minor" and finding.confidence >= 0.7:
            add_to_summary_table(finding)
        # nitpicks: silently dropped

    if not final:
        pass  # No comment is the best comment when code is clean
```

---

## Conclusion

The most effective LLM PR review system is not a single clever prompt but a **pipeline with separation of concerns**: a summarizer that provides structural context, a domain-tuned discovery agent with explicit review dimensions weighted by financial risk, a judge agent that eliminates noise, and a feedback loop that continuously recalibrates. Three concrete actions to implement today: first, deploy the discovery + judge two-pass pipeline from Section 1 as a GitHub Action — this alone will deliver most of the value. Second, encode the eight review dimensions from Section 2 directly into the discovery prompt, with security and concurrency checks weighted highest for wallet code. Third, adopt PR-Agent's compression strategy from Section 3 for large diffs: filter noise files, summarize structure, then review in priority order with token budgets per risk tier. The tools comparison reveals that no commercial solution fully handles the domain-specific concerns of a Cashu/Nostr wallet app — **custom prompts with stack-specific anti-patterns outperform generic tools** for specialized codebases. Start with the concrete templates above, wire in emoji-reaction feedback tracking, and iterate the suppression list weekly based on false-positive data.
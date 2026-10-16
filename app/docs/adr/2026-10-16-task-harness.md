# Task progress is controlled by persisted evidence gates

Status: accepted for the initial trusted-host implementation.

Agents often finish a code edit before they have established that the original problem is
solved. A task needs explicit outcomes, revision-bound evidence and recoverable progress.

Use a tooling workspace outside the shipped wallet. XState v5 owns legal transitions;
Bun SQLite stores each accepted transition with its pending action. Zod parses external
inputs; the official MCP SDK exposes the same controller as the CLI. Prefer the existing
repository checks, native artifacts and viewer over parallel implementations.

Intake settles scope, authority, dependency allowance, models and budgets. Execution does
not ask further questions: an unmet prerequisite or unresolved decision ends incomplete.
The intended finish is a verified pull request, never merging or deployment. The existing
T3 host is trusted: controller restrictions do not prevent arbitrary full-access shell use.

An agent's conclusion is not an execution receipt. Required evidence must match the current
source and tested binary. Retrieval is not an audit verdict, expected test failures are not
preservation successes, and simulator evidence is not physical-device evidence. Persistence
work follows the existing release-safety procedure; the harness never implements Coco or
cashu-ts migration/payment logic itself.

References: [workflow patterns](https://www.anthropic.com/engineering/building-effective-agents),
[context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
[XState persistence](https://stately.ai/docs/persistence),
[T3 outside agents](https://github.com/pingdotgg/t3code/blob/e733a40295f3c961260f64f8eb850b561a04937b/docs/user/outside-agents.md).

The [harness documentation](../../../harness/README.md) owns operation and limitations.

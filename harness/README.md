# Task harness

A local, persistent controller for task work through T3. The controller owns the sequence;
workers submit observations and evidence. Host shell access is trusted, not sandboxed.
Task state belongs outside the source checkout, under `~/.local/state/sovran-harness` by
default (`SOVRAN_HARNESS_STATE` overrides it). It contains private local evidence; do not
commit or publish the database or raw logs.

The JSON CLI and MCP server share one protocol, defined in `src/protocol.ts`.
Run `bun run harness request.json`, or pipe a request to `bun run harness -`.
`bun run harness mcp` serves the same operations over stdio using the official MCP SDK.
The controller never merges or deploys.

## What a transition proves

The initial contract records outcomes, scope, commands, models, allowed dependencies and
a deadline. Research precedes sealing. A worker must claim its exact ticket before submitting;
another worker cannot take over merely because time passed. Completion means that worker
and its child processes have stopped. Unknown outcomes require reconciliation, not replay.

Verification runs the agreed command arguments without a shell. Every command records its
output and the source fingerprint. A changed candidate invalidates evidence. Review and
adversarial review precede the final audit. An audit command completing is evidence only:
the audit worker must still judge it. The controller rejects skipped stages and missing
requirement observations. Qualitative judgments remain model judgments, not proofs.

The SQLite transaction stores the transition and outstanding action together. An interrupted
command remains pending. Restarting does not silently rerun it. Immutable artifact writes are
idempotent, and reusing an operation id with different input is rejected. The database has a
version; an unsupported version is preserved and refused rather than reset.

## Development

`bun run --cwd harness test` exercises real SQLite, temporary git repositories and subprocesses.
`bun run --cwd harness type-check` checks this tooling independently of the shipped app.

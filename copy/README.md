# Shared Copy

Private, dependency-free source package. Consumers import `copy/onboarding`,
`copy/legal`, `copy/site`, or `copy/claims`. No package build or publication step.
The root workspace registration and install/lockfile are managed separately.

`src/onboarding.ts` contains English introductory/backup text only. It does not
own carousel geometry, icons, IDs, payment state, legal acceptance, or locale
selection. Legal documents remain authored by their legal owner; site text by
the site owner. Payment and error catalogs remain in `wallet/src/copy` and
`app/shared/lib/errors`. See [CLAIMS](../CLAIMS.md) for evidence and decisions.

From the repository root, using Node 20.0 or later:

```sh
node copy/scripts/lint.mjs
node --test copy/scripts/*.test.mjs
node copy/scripts/lint.mjs --external-snapshot /path/to/real-captured-copy.txt
```

The checker is read-only and has no network access. Exit 0 means no banned
phrases; exit 1 means banned authored copy; exit 2 means invalid policy, arguments
or unreadable input. Watch words are grouped with counts and three example
locations per rule. External snapshots are opt-in, warning-only, and never
treated as authenticated live evidence. No snapshot is included in this package.

Scope includes all supported authored text extensions under `copy/src`, legal,
onboarding, backup/recovery screens, marketing or press, `site/src`, docs and
READMEs, plus optional `store.json`. It includes site components, not just the
central catalog. It excludes binary files, generated/build/cache directories,
dependencies and symlinks. The output calls out missing surfaces and limitations.
It is a lexical scan, not an AST, renderer, translation engine or semantic proof;
dynamic concatenation, unknown extensions and words embedded in images need
manual review. Human review is still required even with no errors or warnings.

Rules and test fixtures quote deliberately bad copy and are tooling, not scanned
published content. Elsewhere, quotes alone are not exempt. Explicit Markdown
instructions such as "Do not claim fully open source" are recognized as policy
prose. This heuristic is limited to editorial prohibition verbs and their local
clause; it does not exempt entire paragraphs or files. Exact legal exceptions in
`claims.json` apply only to their named rule, file and complete sentence. Unknown
rule references, invalid IDs, duplicate IDs and wildcard exception paths fail.

`store.json` is an optional English editorial candidate, not a store snapshot or
publisher input. Its platform fields have character-budget tests. It does not
claim store availability or satisfy store review. Locale mapping (`en-GB` versus
`en-US` in current release configuration), reviewed-source pinning, localization,
live listing comparison and publisher integration are intentionally unfinished.

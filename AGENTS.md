# Sovran app

A Bitcoin and ecash wallet: an Expo app with its own wallet and Nostr packages. People keep
money in it, so a change that loses saved data or mishandles a payment is the worst outcome.

The owner's current instructions come first, then this file, then anything a skill says.
Skills never authorize new dependencies, external messages, publishing, commits to `main`,
pushes or destructive actions.

## How work runs here

1. **Understand before changing.** Start every task with `jg "<question>"`: how or why the
   thing you will touch works (one question at a time; if it hangs or reports incomplete, search
   instead), plain search for an exact name, then the page for the area in the table below.
   When the change decides how the wallet treats a mint, a payment or another wallet, also
   read how the relevant ones of `../../coco`, `../../cashu-ts`, `../../cdk`, `../../nutshell`,
   `../../cashu.me`, `../../macadamia`, `../../minibits_wallet` and `../../eNuts` do it and
   what `../../nuts` says: as common practice to weigh, not as the answer.
2. **Plan anything bigger than one commit** with the `plan-a-change` skill. Facts are yours to
   find. Decisions go to the owner as multiple choice, in plain words about what the person
   using the app sees, recommended choice first.
3. **Reuse, then delete, then add.** Search for the component, helper or store that already
   does it and extend that. Remove what your change replaces, in the same commit. A new
   abstraction is welcome when it makes the callers simpler; say what it lets you delete.
   Change only what the task names.
4. **Prove it.** Run the checks below yourself, then the saved checks for the area you touched
   (`jevlint check '<family>-*'`) to confirm nothing else they guard broke. For anything on
   screen, look at it running, beside its neighbours. Say exactly what was run and what was not;
   "fixed" means you saw it work. Both platforms, or name the one that was not checked.
5. **Commit in small logical steps** as each one works, staging only its files. After each
   commit that changes behaviour, run the `audit-commit` skill on it and fix what it verifies
   in a new commit.
6. **Keep the pull request true.** After every push to a branch with an open pull request,
   rewrite its title and description to cover everything now on the branch, ending with
   `<!-- describes <head sha> -->`. CI fails while that line names an older commit.
7. **Write down what you leave.** Unfinished or newly found work goes in
   [docs/follow-ups](docs/follow-ups/README.md), never in a `TODO` comment or a new document.

Use helpers in parallel for reading, searching and reviewing: Claude subagents and, when
installed, Codex (`codex exec --sandbox read-only`) as an independent second opinion,
especially on money, keys, saved data and anything hard to undo. One agent writes at a time.
Check what a helper reports before acting on it.

Check Git status before editing and keep changes that are not yours. Another session may be
working in the same checkout: if the tree has changes you did not make, work in a
`git worktree` instead of switching branches or stashing.

## Read before you change

| Changing | Read | Then | Checks |
| --- | --- | --- | --- |
| Anything | [Conventions](docs/review/contributor-conventions.md) for the area and its `conventions-*.md` companion; the ADRs in [app/docs/adr](app/docs/adr) whose titles name it | Record a significant decision as a new ADR | |
| A screen or component | [Building a screen](docs/review/building-screens.md) | `bun run check:styling`; look at it running | `ui-*`, `perf-*`, `errors-*` |
| A route, sheet or flow | [Navigation and routes](docs/protocols/navigation-and-routes.md) | Register the page for the native harness (below) | `ui-modal-menu-layering`, `secrets-in-navigation-state` |
| Anything saved on the phone: a store, secure key, database, cache or migration | [Account lifecycle](docs/architecture/account-lifecycle.md) ("Adding state for an account", "Upgrading from an older release"); [state conventions](docs/review/conventions-state.md) | The `persistence-release-safety` skill, every time | `state-*`, `account-*` |
| Payments, keys, Nostr signing, the wallet package, Coco | [Architecture overview](docs/architecture/overview.md); [contracts](docs/review/contracts.md); [entropy](docs/review/entropy.md) | Coco carries one patch, for offline send ([ADR 0017](app/docs/adr/0017-the-wallet-core-ships-unmodified.md)); turn a feature off before adding another. Before changing the Coco version: [wallet databases](app/__tests__/cocoDatabases/README.md) | `payments-*`, `money-*`, `wallet-*`, `secrets-*`, `entropy-*`, `nostr-*` |
| Wording people read | `copy/` and the `wallet` copy catalogue; [CLAIMS.md](CLAIMS.md) for public claims | `bun run copy:lint` | `errors-*`, `nostr-delivery-claim` |
| A release | [release/README.md](release/README.md) | `persistence-release-safety`; the release fixture step in that README | `state-*` |

Do not rename a store, storage key, secure key or database, and do not rename, remove or
tighten a saved field: an old install whose saved data no longer parses loses that whole store.
Add fields with a default, without a version bump. The state conventions have the narrow
exceptions.

## Layout

A Bun monorepo. Code lives with the owner of its meaning.

| Path | Owns |
| --- | --- |
| `app/` | The Expo app: routes (`app/app`), feature screens (`app/features/<domain>`), shared UI, hooks, stores and infrastructure (`app/shared`) |
| `wallet/` | Payment intent, sequencing, operations, payment copy, and `wallet/react` |
| `nostr/` | Nostr transport, tiers (Nagg → Primal → relays), facade and entity cache |
| `copy/` | Shared wording, legal text, claims rules |
| `docs/`, `site/`, `press/` | Documentation site, website, marketing assets |
| `release/` | Release pipeline |

Imports flow `app → wallet → nostr` and `app → nostr`; `wallet` and `nostr` never import `app`,
navigation or app stores. App imports use `@/…`; packages are consumed through declared
subpaths such as `wallet/react`. Mint proofs and wallet state belong to the installed Coco
packages; wire contracts to `@sovranbitcoin/schemas`. The default build leaves some features
out ([ADR 0021](app/docs/adr/0021-a-build-chooses-its-modules.md)), so a changed screen may not
appear in it.

## Checks

Install at the root with Bun and the committed `bun.lock`; declare a dependency in the package
that imports it.

| Where | Command | Checks |
| --- | --- | --- |
| root | `bun run type-check` | Every workspace; the app for iOS and Android |
| root | `bun run test` | Wallet and Nostr (Vitest), app (Jest) |
| `app/` | `bun run test -- <file> --runInBand` | One app test file |
| `wallet/`, `nostr/` | `bun run test -- <file>` | One package test file |
| `app/` | `bun run lint` | ESLint |
| root | `bun run knip` | Unused files, dependencies and exports |
| root | `bun run followups check` | The follow-up ledger and every reference to it |
| `app/` | `bun run check:styling`, `bun run check:react-compiler` | Styling and compiler ratchets |
| `app/` | `bun run e2e:validate` | Native test scenarios |
| root | `jevlint check '<family>-*'` | After a change, the code each [saved check](docs/review/README.md) guards in the families it touched: read it to confirm nothing else broke. Evidence, not a verdict |

A budget or suppression file records a known exception; raising one needs a reason and
evidence. `storeRegistryManifest.ts` is generated: regenerate it, never edit it. For native,
config, patch or import changes, build both Metro platform bundles. Never
run a destructive or funded scenario against a real wallet.

## Native testability

Every page and action must be operable by the JSON native harness on iPhone and Android
([architecture](app/docs/testing-json-native-adr.md)). For a new or changed route, control or
sheet: register the page in `CANONICAL_PAGES` and its aliases in `PAGE_ROUTES` (`app/e2e/schema`); give each
control a stable `testID` and an accessible label; expose state that has no visible node
through `E2EAccessibilityProbe`; add the smallest scenario that enters, operates and leaves,
waiting on state rather than time and never retrying a send, publish or delete; run it on both
platforms or record the missing one in the follow-ups.

## Patches and vendored code

Patch packages with `bun patch` and `bun patch --commit`, never by editing installed files.
Each patch in [app/patches](app/patches/README.md) records its purpose, test and removal
trigger. Vendored code keeps its upstream revision, license and refresh command beside it.

## Skills

Skills live in `.agents/skills/` (`.claude/skills/` links to them). Rules about this codebase
belong in the documents above; with a fixed shape, in a lint rule or test; when deciding them
means reading what the code does, in a saved check ([how](docs/review/README.md)). A local skill
is for a procedure with steps and an end.

**Load these when their moment comes:** use `full-send` for the durable task controller in `harness/`.

| Skill | When |
| --- | --- |
| plan-a-change | Before building anything bigger than one commit |
| audit-commit | After each commit that changes behaviour; when asked to audit or review a commit |
| persistence-release-safety | Before and after any change to saved data or a storage library; before a release |
| diagnosing-bugs | Something is broken, failing or slow |
| retro | Asked what keeps going wrong, or to improve this file, the skills or the checks |

**Load these when the task is theirs:** `tdd` (test-first work), `code-review` (a diff against
its task), `grilling` (stress-testing a design decision), `codebase-design` and
`improve-codebase-architecture` (module boundaries and reuse), `domain-modeling` (vocabulary),
`principle-model-the-domain` and `principle-type-system-discipline` (replacing branching with
structure, illegal states), `typescript-best-practices`, `expo-router` (route and sheet
mechanics), `expo-animation` (motion, gestures, haptics), `react-native-best-practices`
(measured performance work), `react-native-testing` (component tests).

`python3 .agents/skills/manage.py check` verifies the installation; `link` repairs links.
Upstream snapshots stay unchanged, with provenance in `.agents/skills/sources.json`.

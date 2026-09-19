# Sovran app

Start here. Current user instructions take precedence over this guide, and this
guide takes precedence over generic examples in skills. Skills never authorize new
dependencies, external messages, publication, commits or destructive actions.
Resolve routine choices from the source and its established contracts; ask only
when a consequential decision is unresolved.

## Code rules

Read [contributor conventions](docs/review/contributor-conventions.md) for the area you are
changing. [hunch.config.ts](hunch.config.ts) contains the smaller set of automated semantic
concerns; [review contracts](docs/review/contracts.md) supplies their domain meaning. Hunch
findings are candidates to verify, and insufficient context is a coverage gap. Run lint, types
and relevant tests independently. Validate policy edits with `hunch config` using a CLI version
that supports `review` and choice `abstain`, then check the change:

```sh
hunch check --base origin/main
```

Record significant decisions as
ADRs in [app/docs/adr](app/docs/adr); public claims and their evidence live in
[CLAIMS.md](CLAIMS.md). Open follow-up work is in
[docs/architecture/follow-ups.md](docs/architecture/follow-ups.md).

## Layout and ownership

This is a Bun monorepo. Place code with the owner of its meaning:

| Path | Owns |
| --- | --- |
| `app/` | Expo app: routes (`app/app`), feature screens (`app/features/<domain>`), shared UI, hooks, stores and infrastructure (`app/shared`) |
| `wallet/` | Payment intent, sequencing, operations, payment copy and `wallet/react` bindings |
| `nostr/` | Nostr transport, tiers (Nagg → Primal → relays), facade and entity cache |
| `copy/` | Shared wording, canonical legal text, claims rules |
| `docs/` | VitePress documentation site |
| `site/`, `press/` | Standalone website and marketing assets, outside native builds |
| `release/` | Release pipeline; see [release/README.md](release/README.md) |

Imports flow `app → wallet → nostr` (and `app → nostr`); `wallet` and `nostr`
never import `app`, Expo navigation or app stores. App imports use `@/…`; package
consumers use declared subpaths such as `wallet/react`, never `../../wallet/src`.
Mint proofs and wallet state belong to the installed Coco packages; shared wire
contracts belong to `@sovranbitcoin/schemas`.

## Working in the repo

Check Git status before editing and preserve unrelated changes. Never commit to
`main` or push unless asked, and stage only intended files. Install at the root
with Bun and the committed `bun.lock`; declare each dependency in the package that
imports it.

| Directory | Command | Purpose |
| --- | --- | --- |
| root | `bun run type-check` | All workspaces; the app checks iOS and Android |
| root | `bun run test` | Wallet/Nostr Vitest and app Jest |
| root | `bun run knip` | Unused files, dependencies and exports |
| `app/` | `bun run test -- <file> --runInBand` | One app Jest file (don't pass Jest flags at the root) |
| `wallet/`, `nostr/` | `bun run test -- <file>` | One package Vitest file |
| `app/` | `bun run lint` | ESLint |
| `app/` | `bun run check:styling` | Styling ratchet |
| `app/` | `bun run check:react-compiler` | Compiler coverage ratchet |
| `app/` | `bun run e2e:validate` | Validate JSON E2E scenarios |

Budgets and suppression files record known exceptions; raising one needs a
concrete reason and evidence. For native, config, patch or import changes, build
both Metro platform bundles. Never run destructive or funded E2E scenarios
against a real wallet.

## Native testability

Every page and supported action must be operable by the JSON native harness on
iPhone and Android ([architecture](app/docs/testing-json-native-adr.md)). For a
new or changed route, interaction or modal:

1. Register its page in `CANONICAL_PAGES` and every route alias in `PAGE_ROUTES`.
2. Give each actionable control a stable semantic `testID` and an accessible label.
3. Expose state with no visible native node through `E2EAccessibilityProbe`,
   mounted inside the active screen or sheet.
4. Add the smallest scenario that enters, operates and exits the surface. Wait for
   state, not time, and never retry sends, publishes or deletes.
5. Run it on both platforms, or record the missing platform as an explicit gap.

## Patches and vendored code

Patch packages with `bun patch` and `bun patch --commit`, never by editing
installed files. Each patch in [app/patches](app/patches/README.md) records its
purpose, test and removal trigger. Vendored code keeps its upstream revision,
license and refresh command beside it.

## Skills

Skills are standard, upstream skills committed under `.agents/skills/`, the
cross-agent location; `.claude/skills/` links to the same folders. Sovran-specific
semantic checks belong in `hunch.config.ts`; broader conventions belong in
`docs/review/contributor-conventions.md`, not in custom skills. Load only the skill a
task needs:

| Skill | Use for |
| --- | --- |
| codebase-design | Module ownership, interfaces and reuse |
| improve-codebase-architecture | Requested architecture surveys |
| domain-modeling | Protocol and domain vocabulary |
| diagnosing-bugs | Reproducing failures |
| tdd | Behavior-first tests |
| code-review | Reviewing a diff against its task |
| grilling | Resolving an open design decision, one question at a time |
| expo-router | Route, stack, tab and sheet mechanics |
| react-native-best-practices | Measured native performance work |

`python3 .agents/skills/manage.py check` verifies the installation and
`python3 .agents/skills/manage.py link` repairs missing links. Keep upstream
snapshots unchanged and record refresh provenance in `.agents/skills/sources.json`.

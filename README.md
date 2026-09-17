# Sovran

## Maintenance health

**Core gates:** [![Tests](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml) [![Lint](https://github.com/SovranBitcoin/Sovran/actions/workflows/lint.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/lint.yml) [![Type Check](https://github.com/SovranBitcoin/Sovran/actions/workflows/type-check.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/type-check.yml) [![Knip](https://github.com/SovranBitcoin/Sovran/actions/workflows/knip.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/knip.yml) [![Compiler Bailout Budget](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-compiler.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-compiler.yml) [![Styling Budget](https://github.com/SovranBitcoin/Sovran/actions/workflows/styling.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/styling.yml) [![Bundle Size Budget](https://github.com/SovranBitcoin/Sovran/actions/workflows/bundle-size.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/bundle-size.yml)

**Other checks:** [![Docs](https://github.com/SovranBitcoin/Sovran/actions/workflows/docs.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/docs.yml) [![Glass Headers](https://github.com/SovranBitcoin/Sovran/actions/workflows/glass-headers.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/glass-headers.yml) [![React Doctor — advisory](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-doctor.yml/badge.svg?branch=main&event=push)](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-doctor.yml)

Badges show the latest push to `main`. Green means the gate passed—not necessarily that historical debt is zero. React Doctor is advisory: its badge only confirms that the report was generated. Bundle Size uploads the scored iOS/Android `maintenance-health.json` artifact.

Monorepo for the Sovran Bitcoin wallet and its self-contained packages. Managed
with [Bun](https://bun.sh) workspaces — no inter-package publishing; everything
links directly.

## Layout

| Package    | Path      | What it is |
|------------|-----------|------------|
| **app**    | [`app/`](app/)       | The Expo / React Native application (the product). |
| **wallet** | [`wallet/`](wallet/) | Payment UX logic for Coco-based Cashu wallets — parsing, classification, routing, annotation, offline suggestions. UI- and navigation-agnostic. (Formerly the `colada` repo.) |
| **nostr**  | [`nostr/`](nostr/)   | Typed, UI-agnostic client helpers for the Nagg GraphQL / app-view APIs and the tiered Nostr data layer. (Formerly the `nagg-ts` repo.) |
| **docs**   | [`docs/`](docs/)     | The documentation site ([VitePress](https://vitepress.dev)). |
| **copy**   | [`copy/`](copy/)     | Dependency-free claims policy, onboarding copy and canonical legal documents. |
| **site**   | [`site/`](site/)     | Public website source, built separately with Astro and its own locked dependencies. Not a Bun workspace. |
| **press**  | [`press/`](press/)   | Retained marketing captures, artwork sources and generated exports. Not bundled in the app. |

`app` depends on `wallet` and `nostr` via `workspace:*`; both ship raw TypeScript
(no build step). `@sovranbitcoin/schemas` remains an external package (shared with
the web properties) and resolves from GitHub Packages — see [`.npmrc`](.npmrc).

The public site does not need that private package or the native dependency graph.
Use `bun run site:install`, then `bun run site:build` and `bun run site:test`.
Its content comes from `copy/`; its confirmed download versions come from live
per-channel metadata, not `app/app.json`. Source consolidation does not migrate
artifact hosting: read the [migration boundaries](docs/architecture/site-consolidation.md)
before switching delivery or retiring the old website repository.

## Documentation map

This README is the entry point; every other document in the repository hangs off
this table.

| Document | What it covers |
|----------|----------------|
| [`SYSTEM.md`](SYSTEM.md) | Application convention guide — which owner to use, which default to follow, which exception matters. Read before implementing. |
| [`AGENTS.md`](AGENTS.md) · [`CLAUDE.md`](CLAUDE.md) | Contributor and agent instructions. The chain is CLAUDE.md → AGENTS.md → SYSTEM.md → the relevant reviewed skill. |
| [`CLAIMS.md`](CLAIMS.md) | What the product may claim, and the scoped source review behind each claim. |
| [`FEEDBACK.md`](FEEDBACK.md) | Upstream feedback ledger for the coco v2 integration. |
| [`app/README.md`](app/README.md) | The Expo / React Native application package. |
| [`wallet/README.md`](wallet/README.md) | Colada — payment sequencing, payment-state copy, adapter-shaped side effects. |
| [`nostr/`](nostr/) | Nagg GraphQL / app-view client helpers and the tiered Nostr data layer (no package README; start at [`nostr/src`](nostr/src)). |
| [`copy/README.md`](copy/README.md) | Shared claims, onboarding, legal and site copy. |
| [`docs/README.md`](docs/README.md) | The VitePress documentation site. See also the [architecture overview](docs/architecture/overview.md) and the [ADRs](app/docs/adr). |
| [`site/README.md`](site/README.md) | Public Astro website and the local-only dev workbench (`bun run site:dev` → <http://localhost:4321/dev>). |
| [`press/README.md`](press/README.md) | Screenshots and artwork: capture refresh, device profiles, evidence classes, retention, social/mockup editing. |
| [`app/e2e/capture/README.md`](app/e2e/capture/README.md) | Capture library internals — planning, attestation, import validation, privacy gaps. |
| [`app/e2e/press/README.md`](app/e2e/press/README.md) | Screenshot content contract: the semantic context and retained-image registry JSON. |
| [`release/README.md`](release/README.md) | Production release pipeline, credentials, signing continuity, operator validation. |
| [`artifacts/README.md`](artifacts/README.md) | Security review index for this workspace. |
| [`docs/architecture/site-consolidation.md`](docs/architecture/site-consolidation.md) | Migration boundaries: website source lives here, artifact hosting does not move. |

## Getting started

```bash
bun install            # installs the whole workspace
bun run dev            # start the app (delegates to app/)
bun run docs:dev       # start the docs site
```

Run `bun run dev` from the checkout containing the changes you want to try. It
starts Metro for the installed development client and uses the shared Nagg host,
`https://nagg.up.railway.app`, unless your environment overrides it. Scan the QR
code on a phone on the same network. Extra Expo options are forwarded, for example
`bun run dev -- --port 8082`. Device automation remains an optional, separately
configured `bun run dev:wda` command.

Each Git worktree has its own source files. Updating a branch in another worktree
does not update an already running Metro server or a detached checkout. Use the
normal checkout for device development, with its own installed dependencies;
sharing `node_modules` across worktrees can load two copies of native modules.

`bun run test` and `bun run type-check` at the root cover the WHOLE workspace —
they fan out with `bun run --filter '*'`, so app (both platform passes), wallet
and nostr all run. That is what CI runs. To scope to one package, filter it
(`bun --filter wallet run test`) or run it inside the package; focused Jest with
arguments has its own root alias, since arguments would otherwise be forwarded to
every package's runner:

```bash
bun run test:app -- <files> --runInBand
```

The remaining app commands (`lint`, `knip`, `build:*`, …) are still `cd app`
delegators at the root, or run them inside `app/` directly. `lint` covers `app/`
only — wallet and nostr are not in its ESLint project. EAS builds run from
`app/` (where `eas.json` lives).

## Releases

Production automation, credentials, signing continuity, and operator validation
are documented in [`release/README.md`](release/README.md). Publication is disabled
until explicitly configured and enabled.

### Refresh the marketing material first

Once a release is decided — before the version bump is merged and the pipeline
runs — refresh the native capture library. The website's phone scenes and its
generated social/OG rasters build directly from `press/screenshots/`, selected by
[`press/website.json`](press/website.json); there is no separate landing-page
image script. A public `site:build` fails outright when a selected capture is not
`current`, so a stale library blocks the release instead of shipping the previous
release's screens.

```bash
bun run screenshots:refresh:plan both   # read-only: what would be captured
bun run screenshots:refresh both        # the full run
bun run screenshots:status --strict     # coverage and freshness afterwards
```

The full run builds or verifies each native host, runs the approved capture
scenarios on both platforms, imports passing evidence into `press/screenshots/`,
then regenerates the logos, the website assets and the site build. It never runs
the whole functional suite, and a simulator lane does not authorize publishing or
spending. Add `--resume` after an interruption; `--render-only` regenerates the
derived website outputs without touching a device.

Commit the refreshed captures together with the regenerated `site/public/`
outputs and the version bump — the release publishes committed bytes, not a local
render. [`press/README.md`](press/README.md) has the capture profile, focused
reruns, blockers and retention rules.

## Docs

```bash
bun run docs:dev       # local dev server
bun run docs:build     # static build → docs/.vitepress/dist
bun run docs:preview   # preview the build
```

See [`docs/README.md`](docs/README.md) for more.

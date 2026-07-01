# Sovran

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

`app` depends on `wallet` and `nostr` via `workspace:*`; both ship raw TypeScript
(no build step). `@sovranbitcoin/schemas` remains an external package (shared with
the web properties) and resolves from GitHub Packages — see [`.npmrc`](.npmrc).

## Getting started

```bash
bun install            # installs the whole workspace
bun run dev            # start the app (delegates to app/)
bun run docs:dev       # start the docs site
```

App-specific commands (`type-check`, `lint`, `test`, `knip`, `build:*`, …) are
available at the root as `cd app` delegators, or run them inside `app/` directly.
EAS builds run from `app/` (where `eas.json` lives).

## Docs

```bash
bun run docs:dev       # local dev server
bun run docs:build     # static build → docs/.vitepress/dist
bun run docs:preview   # preview the build
```

See [`docs/README.md`](docs/README.md) for more.

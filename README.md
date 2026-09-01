# Sovran

## Maintenance health

[![Tests](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml) [![Lint](https://github.com/SovranBitcoin/Sovran/actions/workflows/lint.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/lint.yml) [![Type Check](https://github.com/SovranBitcoin/Sovran/actions/workflows/type-check.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/type-check.yml) [![Knip](https://github.com/SovranBitcoin/Sovran/actions/workflows/knip.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/knip.yml) [![React Compiler](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-compiler.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-compiler.yml) [![React Doctor — advisory](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-doctor.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/react-doctor.yml) [![Styling](https://github.com/SovranBitcoin/Sovran/actions/workflows/styling.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/styling.yml) [![Bundle Size](https://github.com/SovranBitcoin/Sovran/actions/workflows/bundle-size.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/bundle-size.yml)

Green means the check passes its zero-debt or no-regression gate. React Doctor is advisory—the badge only means its report was generated. Bundle Size publishes the scored iOS/Android `maintenance-health.json` artifact.

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

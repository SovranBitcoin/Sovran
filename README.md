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

`app` depends on `wallet` and `nostr` via `workspace:*`; both ship raw TypeScript
(no build step). `@sovranbitcoin/schemas` remains an external package (shared with
the web properties) and resolves from GitHub Packages — see [`.npmrc`](.npmrc).

## Getting started

```bash
bun install            # installs the whole workspace
bun run dev            # start the app (delegates to app/)
bun run docs:dev       # start the docs site
```

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

## Docs

```bash
bun run docs:dev       # local dev server
bun run docs:build     # static build → docs/.vitepress/dist
bun run docs:preview   # preview the build
```

See [`docs/README.md`](docs/README.md) for more.

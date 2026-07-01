# Install and run

## Prerequisites

- [Bun](https://bun.sh) `1.3.5` (pinned via `packageManager` in the root `package.json`)
- Xcode 15+ with Command Line Tools and an iOS Simulator
- An EAS account if you want to make remote builds (`eas login`)
- A GitHub Packages token for the external `@sovranbitcoin/schemas` dependency

## Install

From the repository root (the Bun workspace root):

```bash
bun install
```

This installs all four workspace packages (`app`, `wallet`, `nostr`, `docs`) and
runs the root `postinstall`, which applies the `patch-package` patches and the
BitChat native sync against the app. The `wallet` and `nostr` packages link
directly via the workspace — there is nothing to publish or version-sync.

## Run the app

```bash
bun run dev        # Expo dev server (Metro), delegates to app/
bun run ios        # build and launch on the iOS simulator
bun run android    # build and launch on Android, when configured
```

App-level checks and builds are also available from the root as `cd app`
delegators (or run them inside `app/` directly):

```bash
bun run type-check
bun run lint
bun run test
bun run build:ios          # EAS production iOS build (auto-submit)
bun run build:dev:ios      # EAS development build
```

EAS builds run from `app/`, where `eas.json` lives.

## Run the docs site

```bash
bun run docs:dev       # local dev server
bun run docs:build     # static build → docs/.vitepress/dist
bun run docs:preview   # preview the build
```

## Stack

- **Expo SDK 56** / **React Native 0.85.3** / **React 19.2.3** / **Hermes**
- **Bun** as package manager and CI runtime
- **TypeScript** with `noImplicitOverride`, type-aware ESLint, `eslint-plugin-react-compiler`, `eslint-plugin-react-perf`
- **Reanimated v4** (legacy `Animated` banned by lint), **Gesture Handler**, **Nitro Modules**, **Worklets**
- **Redux + redux-persist** alongside **Zustand**
- **Zod v4**; `@sovranbitcoin/schemas` for shared payloads
- **`neverthrow`** for `Result` / `ResultAsync` return types
- **`react-native-quick-crypto`** + `@noble/hashes` + `@scure/bip32` + `@scure/bip39`
- **Uniwind + Tailwind variants** for styling
- **`expo-sqlite`** for Coco wallet storage, **`expo-secure-store`** for seeds and nsec
- **`@shopify/flash-list`** (v2) for high-performance lists across feed, DMs, and AI chat
- **Apple Targets** (`@bacons/apple-targets`) for widgets under `app/targets/`
- **Patch-package** for upstream Coco / cashu-ts modifications under `app/patches/`

# Sovran

A private Bitcoin and Cashu ecash wallet for iOS and Android, built with Expo, React Native,
[Coco](https://github.com/cashubtc/coco), and [nostr-tools](https://github.com/nbd-wtf/nostr-tools).

## Features

- **Cashu ecash & Lightning** — send, receive, swap, and multi-mint balance management powered by
  Coco and SQLite proof storage, including exact offline sends and NUT-18 / NUT-26 payment requests.
- **NFC & Nearby payments** — tap-to-pay over Type 4 NDEF NFC (Numo-compatible payer flow) and
  proximity transfers via BitChat BLE.
- **Nostr contacts & NIP-17 delivery** — direct relay search (Vertex + NIP-50), NIP-17
  gift-wrapped ecash delivery, NIP-05 verification, and multi-account support from a BIP-39
  recovery phrase (with NUT-27 mint-list discovery).
- **Bitcoin Near You** — local merchant map backed by BTCMap.
- **Customization** — native iOS Liquid Glass styling, themes, and bundled wallpapers.

## Getting started

Requires [Bun](https://bun.sh) and Node 22+.

```bash
bun install        # install all workspaces
bun run dev        # start Expo dev server for a dev client
bun run ios        # build and run on iOS simulator / device
bun run android    # build and run on Android emulator / device
```

### Verification

```bash
bun run check                   # type-check, lint, knip, copy:lint, followups, metrics, and tests
bun run type-check              # TypeScript across app (iOS + Android), wallet, and nostr
bun run test                    # Jest (app) + Vitest (wallet, nostr)
bun run --cwd app test:upgrade  # 20-epoch persisted upgrade compatibility suite (E01–E20)
bun run --cwd app lint          # ESLint
```

### Public website

The marketing site in [`site/`](site/) is built independently with Astro:

```bash
bun run site:install
bun run site:build
bun run site:test
```

## Workspace layout

- [`app/`](app/) — Expo / React Native mobile app
- [`wallet/`](wallet/) — UI-agnostic payment intent, sequencing, and operations
- [`nostr/`](nostr/) — Pure `nostr-tools` client, relay pool, and profile/search tiers
- [`copy/`](copy/) — Shared app wording, legal text, and claims linter ([`CLAIMS.md`](CLAIMS.md))
- [`site/`](site/) & [`press/`](press/) — Public website and marketing assets
- [`release/`](release/) — Release verification and pipeline scripts

## License

[MPL-2.0](LICENSE)

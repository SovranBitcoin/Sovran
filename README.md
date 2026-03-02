# Sovran

[![CI](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml)

[https://sovran.money](https://sovran.money)

<img width="100%" src="./sovran.png" />

A privacy-first Bitcoin wallet built on Cashu ecash, Nostr identity, and NFC payments.

## Features

### Wallet

- Send and receive Bitcoin via Cashu ecash tokens
- Lightning Network payments and invoices
- Multi-account support with swipeable account pager
- Real-time balance with sats/fiat toggle (USD, EUR, GBP)

### Mint Management

- Browse community-recommended mints discovered via Nostr or the Sovran API
- Audit any mint: lightning node connectivity, success rates, swap times, and community ratings (Know Your Mint)
- Rebalance ecash across mints with automatic routing and middleman chain support
- Distribution health monitoring with drift detection and rebalance suggestions
- Per-mint distribution sliders with target percentages

### Payments

- NFC tap payments — scan NFC tags to pay Lightning invoices or receive ecash
- QR scanner with torch, gallery import, UR multi-frame support, and clipboard paste
- Cashu payment requests (NUT-18) — send ecash directly over Nostr
- Deep linking via `cashu://` and `sovran://` URL schemes
- Emoji token encoding for creative sharing

### Transactions

- Unified timeline: swaps, pending sends, cancelled transactions, and receipts
- Every transaction shows its source — QR scan, NFC tap, clipboard paste, or deeplink
- Live step-by-step timelines per transaction as state changes
- Filter by currency, type, direction, status, and month
- Opt-in location stamps with tap-to-reveal privacy blur

### Social

- User profiles with reputation score, follower count, and social graph (powered by Nostr)
- Encrypted peer-to-peer DMs (NIP-17 gift-wrapped)
- Send Cashu tokens and payment requests inline in conversations
- Contact search by npub, NIP-05, or name
- BTCMap integration — find Bitcoin-accepting merchants near you

### Security & Identity

- BIP-39 mnemonic seed phrase with NIP-06 Nostr key derivation
- Multi-profile support: derived accounts from seed + imported nsec profiles
- Encrypted local storage via expo-secure-store
- 4-digit passcode lock
- Wallet recovery from seed across all known mints
- P2PK locking keys (generate or import)

### Customization

- 37 themes including color palettes and background image wallpapers
- Built-in AI chat through Routstr — pay-per-token with ecash, no subscription
- Lightning address claiming (npubx.cash / sovran.money domains)
- Configurable swap routing parameters (max hops, fees, trust mode)

---

## Development

```sh
npm start       # Start Expo development server
npm run ios     # Run on iOS simulator/device
npm run android # Run on Android emulator/device
```

## Code Quality

All checks must pass before commits:

```sh
npm run lint         # ESLint
npm run type-check   # TypeScript (tsc --noEmit)
npm run pretty:check # Prettier
npm run knip         # Dead code detection
npm test             # Jest
```

## Building

```sh
npx expo prebuild          # Prebuild native projects
eas build -p ios           # Build iOS (EAS)
eas build -p android       # Build Android (EAS)
eas submit -p ios          # Submit to App Store
eas submit -p android      # Submit to Play Store
```

## Architecture

React Native + Expo Router, TypeScript, file-based routing.

- `app/` — routes and orchestration (thin screens)
- `components/ui/` — primitives, `components/blocks/` — composed product UI
- `hooks/` — reusable hooks, `hooks/coco/` — Cashu hook composition
- `helper/` — stateless utilities, `helper/coco/` — Cashu integration glue
- `stores/` — Zustand state (global, profile-scoped, or runtime-only)
- `providers/` — React context providers (NDK, theme, keys)

### Stack

Expo SDK, Expo Router, HeroUI Native, Uniwind (Tailwind v4 for RN), Zustand, coco-cashu-core/react, nostr-tools, NDK, expo-secure-store, Reanimated.

### Protocol Support

- **Cashu** — NUT-00 through NUT-13, NUT-17, NUT-18, NUT-23
- **Lightning** — BOLT11 invoices
- **Nostr** — NIP-04, NIP-05, NIP-06, NIP-17, NIP-19, NIP-44, NIP-59
- **BIP-39 / BIP-32** — Hierarchical deterministic wallets

## Contributing

We welcome contributions! See [GitHub Issues](https://github.com/SovranBitcoin/Sovran/issues) for bug reports and feature requests.

## Support

- **GitHub Issues** — Bug reports and feature requests
- **Nostr** — Direct messaging via Nostr protocol
- **Twitter** — [@KevinKelbie](https://x.com/KevinKelbie)

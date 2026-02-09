# Sovran

[![CI](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml)

[https://sovran.money](https://sovran.money)

<img width="100%" src="./sovran.png" />

## Features

### Wallet

<!-- Code: components/blocks/AccountPagerView.tsx — account pager with send/receive/scan buttons -->
<!-- Code: components/blocks/PrimaryBalance.tsx — balance display with unit toggling and fiat conversion -->
<!-- Code: components/blocks/Account.tsx — single account view with currency icon and balance -->
<!-- Code: app/(drawer)/(tabs)/index/index.tsx — wallet tab: balances, transactions, account pager -->

- Send and receive Bitcoin via Cashu ecash tokens
- Lightning Network payments and invoices
- Multi-account support with swipeable account pager
- Real-time balance with sats/fiat toggle

### Lightning Address

<!-- Code: app/claimUsername.tsx — claim username modal with domain selector and availability checking -->
<!-- Code: components/blocks/claim/ClaimUsernameCardFrame.tsx — card frame on explore page -->

- Claim a custom Lightning address username
- Choose between npubx.cash and sovran.money domains
- Real-time availability checking across all domains

### Multi-Currency Display

<!-- Code: stores/settingsStore.ts — displayCurrency setting (USD/EUR/GBP) -->
<!-- Code: components/blocks/FiatCurrencyPill.tsx — currency pill with context menu for switching -->
<!-- Code: stores/pricelistStore.ts — BTC price data in USD/EUR/GBP with cache -->
<!-- Code: components/ui/AmountFormatter.tsx — formatted amount display with unit conversion -->

- Display balances in USD, EUR, GBP, or sats
- Real-time fiat conversion with price caching
- Quick-switch currency pill in the header

### Transaction Sources

<!-- Code: stores/scanHistoryStore.ts — tracks scans with source: qr, nfc, paste, deeplink -->
<!-- Code: hooks/coco/useProcessPaymentString.ts — processes QR codes, NFC data, pasted strings, deeplinks -->
<!-- Code: components/blocks/Transaction.tsx — shows scan source badge (NFC/QR/paste) on each transaction -->

- Every transaction shows how it started — QR scan, NFC tap, clipboard paste, or deeplink
- Swaps, pending sends, and cancelled transactions all live in one unified timeline

<img width="1600" height="1200" alt="transaction-sources" src="https://gist.github.com/user-attachments/assets/556ba721-4ded-4dbc-bcd3-e1d869ad5d95" />

### Transaction Filters

<!-- Code: app/(filter-flow)/filters.tsx — filter UI: currency, payment type, direction, status -->
<!-- Code: components/screens/TransactionsFilterContext.tsx — filter state context -->
<!-- Code: components/blocks/Transactions.tsx — virtualized transaction list with date grouping and filtering -->
<!-- Code: components/blocks/MonthSelector.tsx — horizontal scrollable month tabs -->

- Filter by currency, type (lightning or ecash), direction, status, and month
- Horizontal month selector for quick time navigation

<img width="1600" height="1200" alt="filters" src="https://gist.github.com/user-attachments/assets/586f42f7-6059-4fad-be4a-78a23f96d2c2" />

### Transaction Timelines

<!-- Code: components/blocks/Transaction/HistoryEntryTimeline.tsx — timeline showing transaction progress steps -->
<!-- Code: components/blocks/Transaction/HistoryEntryHeader.tsx — header for transaction detail screens -->
<!-- Code: components/blocks/Transaction/HistoryEntryRefresh.tsx — refresh component for checking status -->

- Live timeline per transaction that updates as state changes — step by step
- Mint quotes counting down to expiry, sends progressing through preparation to finalization, melts moving from pending to paid

<img width="1600" height="1200" alt="HistoryEntryTimeline" src="https://gist.github.com/user-attachments/assets/35b40af1-ee73-4d3c-8da5-e1c0af6ff654" />

### P2PK

<!-- Code: app/settings-pages/keyring.tsx — P2PK key management: generate, import (nsec/hex), QR display -->
<!-- Code: stores/settingsStore.ts — quickAccessP2PK setting for receive screen shortcut -->
<!-- Code: components/screens/ReceiveScreen.tsx — receive screen with Lightning and P2PK tabs -->

- Generate or import locking keys (nsec or raw hex)
- Keys derived from your seed using a BIP-39 path
- Quick Access shows your latest locking key on the receive screen

<img width="1600" height="1200" alt="p2pk" src="https://gist.github.com/user-attachments/assets/550f9f6f-5536-4c28-ad75-6ee350fbe535" />

### Themes

<!-- Code: themes.js — 37 theme definitions (color palettes + background image themes) -->
<!-- Code: providers/ThemeProvider.tsx — theme provider with dynamic color access -->
<!-- Code: app/settings-pages/theme.tsx — theme selection screen -->

- 37 themes including color palettes and background image wallpapers
- Pick a color or a background image — applies everywhere, instantly

<img width="850" height="850" alt="themes" src="https://gist.github.com/user-attachments/assets/5843614b-3e6a-41f1-ac2d-ddebacf97e52" />

### Know Your Mint

<!-- Code: hooks/coco/useAuditedMint.ts — fetches audit info and mint info for a single mint -->
<!-- Code: hooks/coco/useAuditedMints.ts — batch audit data for multiple mints -->
<!-- Code: hooks/coco/useKYMMint.ts — fetches Nostr kind 38000 recommendation events, calculates average score -->
<!-- Code: hooks/coco/useKYMMints.ts — batch KYM ratings for multiple mints -->
<!-- Code: stores/auditMintStore.ts — audit data cache with staleness checking -->
<!-- Code: stores/kymMintStore.ts — KYM rating cache from Nostr recommendations -->
<!-- Code: app/(mint-flow)/info.tsx — mint info/details screen -->
<!-- Code: app/(mint-flow)/reviews.tsx — mint reviews screen -->

- Mints accessible from the payments page — tap to message them over Nostr
- Audit any mint through the Cashu Auditor: lightning node connectivity, success rates, average swap times, and community ratings

<img width="1370" height="878" alt="kym" src="https://gist.github.com/user-attachments/assets/9e027f01-4fd7-4f4c-8a76-6793a485bd25" />

### User Profiles

<!-- Code: app/(user-flow)/profile.tsx — user profile: banner, avatar, stats, followers, actions -->
<!-- Code: hooks/useNostrProfile.ts — fetches profile data, follower/following counts, top followers, rank -->
<!-- Code: app/(user-flow)/share.tsx — share screen: QR code and sharing options -->

- Tap any user to see their profile — reputation score, follower count, and most-followed connections
- Powered by Nostr social graph data

<img width="1200" height="1200" alt="profiles+messages" src="https://gist.github.com/user-attachments/assets/7359b8c0-2f66-4012-822a-5c323c83cb0e" />

### Nostr Direct Messages

<!-- Code: components/screens/UserMessagesScreen.tsx — DM conversation screen -->
<!-- Code: hooks/useNostrDirectMessage.ts — NIP-17 DM sending with NIP-44 encryption -->
<!-- Code: utils/nip17.ts — NIP-17/NIP-59 gift wrap utilities (rumor → seal → wrap) -->
<!-- Code: app/message/components/CashuTokenMessage.tsx — inline Cashu token messages -->
<!-- Code: app/message/components/PaymentMessage.tsx — inline payment messages -->

- Encrypted peer-to-peer messaging rebuilt on NIP-17 gift-wrapped DMs
- Send Cashu tokens and payment requests inline in conversations

### Contacts

<!-- Code: app/(drawer)/(tabs)/payments/index.tsx — payments tab: contact search, recent activity, mints -->
<!-- Code: components/blocks/payments/DraggableContactsList.tsx — scrollable contact list -->
<!-- Code: components/blocks/payments/ContactItem.tsx — contact item with avatar, name, last message -->
<!-- Code: components/blocks/contacts/SearchResult.tsx — Nostr profile search with NIP-05 validation -->

- Nostr-based contact system on the payments page
- Search for users by npub, NIP-05, or name
- Recent conversations with message previews

### BTCMaps

<!-- Code: app/(map-flow)/index.tsx — interactive map with clustering and category filters -->
<!-- Code: app/(map-flow)/detail.tsx — merchant detail screen with contact info -->
<!-- Code: stores/btcMapStore.ts — BTC Map merchant data cache with 24h TTL -->
<!-- Code: utils/mapClustering.ts — Supercluster-based marker clustering -->
<!-- Code: utils/btcMapClusterCache.ts — LRU cluster cache (max 3 entries) -->

- Built-in map (powered by BTCMap) shows merchants near you that accept Bitcoin
- Filter by category — food, retail, ATMs, accommodation — and tap for details
- Efficient map clustering with viewport-based rendering

<img width="1600" height="1200" alt="maps" src="https://gist.github.com/user-attachments/assets/841f8c73-ae06-404b-81b2-f73e0c92cc46" />

### Pending Ecash Sweeper

<!-- Code: app/pendingEcash.tsx — pending ecash management: view and rollback unclaimed sent tokens -->
<!-- Code: components/blocks/pending/PendingEcashCardFrame.tsx — card frame on explore page -->
<!-- Code: hooks/useAppPendingAmount.ts — calculates total pending send transactions -->

- Explore page shows total unspent balance across all pending sends
- One tap starts a sweep — rolling back each transaction and reclaiming tokens, grouped by mint

<img width="1600" height="1200" alt="pending-ecash-sweeping" src="https://gist.github.com/user-attachments/assets/1a66717b-2cb2-445c-b342-b83eb8a1ba43" />

### Mint Swapper / Rebalancer

<!-- Code: app/(mint-flow)/rebalancePlan.tsx — rebalance planning screen -->
<!-- Code: components/blocks/rebalance/RebalanceStepRow.tsx — single rebalance step with mint avatars and status -->
<!-- Code: components/blocks/rebalance/rebalancePlanner.ts — planning logic for rebalance operations -->
<!-- Code: components/blocks/rebalance/routing.ts — routing logic for finding middleman paths -->
<!-- Code: stores/swapTransactionsStore.ts — swap transaction grouping and tracking -->
<!-- Code: components/blocks/distribution/DistributionSlider.tsx — distribution percentage slider with haptic feedback -->
<!-- Code: components/blocks/distribution/MintDistributionItem.tsx — per-mint distribution item -->
<!-- Code: stores/mintDistributionStore.ts — distribution as basis points (0-10000) -->

- Rebalance ecash across mints without doing the transfers yourself
- The health page monitors your distribution drift and flags when things are off
- Set target distribution percentages per mint with sliders
- Supports middleman routing chains for mints that can't swap directly

<img width="1600" height="1200" alt="rebalancing" src="https://gist.github.com/user-attachments/assets/4cb03232-1307-4a73-966b-9901540bfb54" />

### Wallet Health

<!-- Code: components/blocks/health/WalletHealthCard.tsx — wallet health card with distribution status -->
<!-- Code: components/blocks/health/WalletHealthModalContent.tsx — detailed wallet health view -->
<!-- Code: app/(drawer)/(tabs)/explore/healthModal.tsx — wallet health modal -->

- Balance distribution monitoring card on the explore page
- Shows distribution status, pending transactions, and rebalance suggestions
- Hero transition animation from card to full modal

### Mint Selector

<!-- Code: app/(mint-flow)/add.tsx — add mints: search, discover, and add new mints -->
<!-- Code: app/(mint-flow)/list.tsx — mint list with balances -->
<!-- Code: hooks/coco/useNostrDiscoveredMints.ts — discovers mints from Nostr kind 38000 events -->
<!-- Code: hooks/coco/useSovranDiscoveredMints.ts — fetches mint list from Sovran API -->
<!-- Code: hooks/coco/useMintManagement.ts — load, add, remove, restore mints -->
<!-- Code: components/blocks/MintBalanceDisplay.tsx — mint selector with avatar, name, balance -->
<!-- Code: components/blocks/WalletHeaderTitle.tsx — header with mint selector context menu -->

- Browse community-recommended mints discovered via Nostr or the Sovran API
- Paste a URL manually to add any mint
- Every mint shows its KYM score before you commit

<img width="1600" height="1200" alt="mint-selection" src="https://gist.github.com/user-attachments/assets/3ed6db59-7ae8-4e35-8e50-e31250a87880" />

### Swap Routing

<!-- Code: app/settings-pages/routing.tsx — swap routing settings -->
<!-- Code: stores/settingsStore.ts — rebalancing and middleman routing settings (maxHops, maxFeePercent, minSuccessRate, trustMode) -->

- Configure routing parameters for mint swaps
- Set max hops, max fee percentage, minimum success rate, and trust mode

### Location Stamps

<!-- Code: hooks/useTransactionLocation.ts — captures GPS coordinates at transaction time -->
<!-- Code: hooks/useTransactionLocationSection.ts — manages location reveal/hide state -->
<!-- Code: stores/transactionLocationStore.ts — maps transaction IDs to GPS coordinates -->
<!-- Code: components/blocks/TransactionLocationSection.tsx — displays location data with tap-to-reveal -->

- Opt-in location stamps — tag where a transaction happened
- Stored locally, shown on a map with a privacy-first "tap to reveal" blur
- Off by default

<img width="1600" height="1200" alt="location-stamps" src="https://gist.github.com/user-attachments/assets/edb6048e-80c2-4947-9f43-922a0999de3a" />

### Routstr

<!-- Code: app/(drawer)/(tabs)/explore/index.tsx — explore tab with Routstr AI section -->
<!-- Code: components/blocks/routstr/SessionsPanel.tsx — animated side panel for chat session management -->
<!-- Code: stores/routstrStore.ts — API key, balance, conversations, model selection, session management -->
<!-- Code: helper/routstr/api.ts — Routstr API client for models and chat -->

- Built-in AI chat through Routstr
- Pick from dozens of models across providers — each one shows exactly what it costs in sats per token
- No subscription — send ecash to fund your balance
- Session management with search, model switching, and anonymous mode

<img width="1600" height="1200" alt="routstr" src="https://gist.github.com/user-attachments/assets/0fdf5184-03b1-4f8d-9766-efd9096a7da6" />

### Payment Requests

<!-- Code: app/(send-flow)/sendToken.tsx — send token screen with payment request support (NUT-18) -->
<!-- Code: components/screens/SendTokenScreen.tsx — unified send screen supporting payment request mode -->
<!-- Code: hooks/coco/useProcessPaymentString.ts — processes payment request strings -->

- Cashu payment requests (NUT-18) — send ecash directly over Nostr
- No Lightning invoice needed — just a request, a tap, and it's done

### NFC

<!-- Code: helper/nfc.ts — NFC payment service (NDEF Type 4 Tag protocol) -->
<!-- Code: app/(drawer)/(tabs)/index/_layout.tsx — NFC payment handler with mint selection and amount limits -->
<!-- Code: stores/scanHistoryStore.ts — tracks NFC scans in history -->

- NFC tap payments — scan NFC tags to pay Lightning invoices or receive ecash
- Includes rollback handling, robust mint selection, and POS payment recovery

### QR Scanner

<!-- Code: components/screens/CameraScreen.tsx — QR scanner with torch, clipboard paste, gallery QR import, UR code progress -->
<!-- Code: hooks/useHandleCameraPermission.ts — camera permission management -->
<!-- Code: hooks/coco/useProcessPaymentString.ts — processes scanned QR codes into actions -->

- Full-featured QR code scanner with torch toggle
- Import QR codes from your photo library — pick an image and the app decodes it automatically via `expo-camera` `scanFromURLAsync`
- UR code support with multi-frame progress tracking
- Clipboard paste fallback for quick input

### Emoji Token Encoding

<!-- Code: components/blocks/sheets/emoji-picker/index.tsx — emoji picker sheet for token encoding -->
<!-- Code: components/blocks/sheets/emoji-picker/routes/routeA.tsx — emoji grid with 11 Bitcoin-themed emojis -->

- Encode ecash tokens with Bitcoin-themed emojis for creative sharing
- Select an emoji, token is encoded, copied to clipboard automatically

### Deep Linking

<!-- Code: hooks/useDeeplink.ts — processes cashu:// and sovran:// URLs -->
<!-- Code: app.json — deep link schemes: ["sovran", "cashu"] -->

- `cashu://` and `sovran://` URL schemes for seamless payment handling
- Automatically routes to the right screen based on link content

### Passcode Lock

<!-- Code: app/settings-pages/passcode.tsx — passcode settings: create, confirm 4-digit PIN -->
<!-- Code: components/blocks/passcode/PasscodeScreen.tsx — passcode entry screen -->
<!-- Code: components/blocks/passcode/NumericKeyboard.tsx — custom numeric keyboard -->
<!-- Code: components/blocks/PasscodeGate.tsx — passcode protection gate -->

- 4-digit PIN code for app-level protection
- Custom numeric keyboard with passcode gate on launch

### Wallet Recovery

<!-- Code: app/settings-pages/recovery.tsx — wallet recovery screen: restore tokens from seed across all mints -->
<!-- Code: hooks/coco/useMintManagement.ts — restoreMint function -->

- Restore your wallet from a BIP-39 seed phrase
- Sweeps all known mints to recover ecash proofs
- Progress tracking per mint during recovery

### Security & Privacy

<!-- Code: hooks/useSecureStore.ts — secure storage access, useMnemonic, useCashuMnemonic hooks -->
<!-- Code: helper/secureStorage.ts — secure storage helper with biometric support -->
<!-- Code: providers/NostrKeysProvider.tsx — BIP39 seed → Nostr key derivation (NIP-06) -->
<!-- Code: components/blocks/AppGate.tsx — terms acceptance and onboarding gate -->

- BIP-39 mnemonic seed phrase generation and storage
- NIP-06 deterministic key derivation for Nostr identity
- Encrypted local storage via expo-secure-store
- No data collection — privacy-first, open source

---

## Scripts

### Development

```sh
yarn start     # Start Expo development server
yarn ios       # Run on iOS simulator/device
yarn android   # Run on Android emulator/device
```

### Building

```sh
yarn prebuild          # Prebuild native projects
yarn build:ios         # Build iOS for production (EAS)
yarn build:dev:ios     # Build iOS for development (EAS)
yarn build:android:apk # Build Android APK (preview)
```

### Submitting

```sh
yarn submit:ios      # Submit iOS build to App Store
yarn submit:android  # Submit Android build to Play Store
```

### Code Quality

```sh
yarn lint         # Run ESLint
yarn type-check   # Run TypeScript type checking
yarn pretty       # Format code with Prettier
yarn pretty:check # Check formatting without writing
yarn knip         # Find unused exports/dependencies
```

### Testing

```sh
yarn maestro  # Run Maestro UI tests
```

## Technical Architecture

### Code Structure

React Native app built with Expo, using file-based routing via Expo Router.

<!-- Code: app/_layout.tsx — root layout with providers, theme, and navigation stack -->
<!-- Code: app/(drawer)/_layout.tsx — drawer layout (Wallet, Payments, Settings) -->
<!-- Code: app/(drawer)/(tabs)/_layout.tsx — tab bar layout (Payments, Wallet, Explore) -->

- **Frontend**: React Native with Expo
- **Styling**: Tailwind CSS via NativeWind
- **State Management**: Zustand (migrating from Redux)
- **Cashu Operations**: Coco-Cashu for ecash processing
- **Nostr Integration**: NDK for decentralized communication
- **Animations**: Reanimated with hero transitions

### Protocol Support

- **Cashu NUTs** — NUT-00 through NUT-13, NUT-17, NUT-18, NUT-23
- **Lightning Network** — BOLT11 invoices
- **Nostr** — NIP-04, NIP-05, NIP-06, NIP-17, NIP-19, NIP-44, NIP-59
- **BIP-39 / BIP-32** — Hierarchical deterministic wallets

## Contributing

We welcome contributions! See our [GitHub repository](https://github.com/SovranBitcoin/Sovran) for issues, feature requests, and code contributions.

## Support

- **GitHub Issues** — Bug reports and feature requests
- **Nostr** — Direct messaging via Nostr protocol
- **Twitter** — [@KevinKelbie](https://x.com/KevinKelbie)

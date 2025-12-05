# Sovran

[![CI](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml/badge.svg)](https://github.com/SovranBitcoin/Sovran/actions/workflows/ci.yml)

[https://sovran.money](https://sovran.money)

<img width="100%" src="./sovran.png" />

## Scripts

### Development

Start the Expo development server:

```sh
yarn start
```

Run on iOS simulator/device:

```sh
yarn ios
```

Run on Android emulator/device:

```sh
yarn android
```

### Building

Prebuild native projects (cleans existing native directories):

```sh
yarn prebuild
```

Build iOS app for production (via EAS):

```sh
yarn build:ios
```

Build iOS app for development (via EAS):

```sh
yarn build:dev:ios
```

Build Android APK (preview profile):

```sh
yarn build:android:apk
```

### Submitting to App Stores

Submit iOS build to App Store:

```sh
yarn submit:ios
```

Submit Android build to Play Store:

```sh
yarn submit:android
```

### Code Quality

Run ESLint:

```sh
yarn lint
```

Run TypeScript type checking:

```sh
yarn type-check
```

Format code with Prettier:

```sh
yarn pretty
```

### Testing

Run Maestro UI tests:

```sh
yarn maestro
```

## Features

### Core Wallet Functionality ✅

- **Cashu ecash support** - Send and receive Bitcoin via ecash tokens
- **Lightning Network integration** - Lightning payments and invoices
- **Multi-currency support** - USD, EUR, GBP, and Satoshi units
- **QR code scanning** - Camera-based payment processing
- **NFC support** - Contactless payment capabilities

### Security & Privacy ✅

- **BIP39 mnemonic recovery** - 12-word seed phrase backup
- **NIP-06 key derivation** - Deterministic key generation for nostr profiles
- **Passcode protection** - Device-level security
- **Secure storage** - Encrypted local data storage
- **No data collection** - Privacy-first approach
- **Open source** - Fully auditable codebase

### Nostr Integration ✅

- **Decentralized identity** - Nostr profile management
- **Direct messaging** - Encrypted peer-to-peer communication
- **Contact management** - Nostr-based contact system
- **Profile sharing** - QR code profile sharing

### User Experience ✅

- **Modern UI/UX** - Clean, intuitive interface
- **Theme support** - Multiple visual themes
- **Transaction history** - Comprehensive transaction tracking
- **Mint management** - Add and manage multiple mints
- **Real-time updates** - Live balance and transaction updates

## Current Status

**Version:** 0.0.51 (Build 9)

### Recent Updates

- **Mint Audit Page** - Added comprehensive mint auditing capabilities
- **Mint Messaging** - Direct communication with mints
- **Enhanced Error Handling** - Improved Lightning payment error messages
- **Payment State Tracking** - Real-time transaction status updates
- **Auto-updating Mint Auditor** - Daily mint health checks

## Roadmap

### Phase 1: Foundation Stabilization

- [ ] **Coco Multi-Unit Support** - Full support for multiple currency units
- [ ] **Code Quality** - Zero TypeScript errors and linting issues
- [ ] **Expired Transaction Polish** - Improved handling of expired transactions
- [ ] **Performance Optimization** - Enhanced app responsiveness

### Phase 2: Core Features Restoration

- [ ] **Swap Functionality** - Re-implement token swapping between mints
- [ ] **Advanced Mint Management** - Enhanced mint discovery and management
- [x] **Transaction Filtering** - Advanced transaction search and filtering
- [ ] **Export Capabilities** - Transaction history export
- [x] **Restore backup** - Restore cashu tokens for mints that support it

### Phase 3: Enhanced User Experience

- [ ] **Push Notifications** - Real-time payment notifications
- [ ] **Biometric Authentication** - Fingerprint/Face ID support (infrastructure exists, needs enabling)
- [ ] **Advanced Security** - Hardware wallet integration
- [ ] **Offline Mode** - Limited functionality without internet

### Phase 4: Advanced Features

- [ ] **Lightning Address Support** - Full LNURL-pay integration
- [ ] **Plugin System** - Extensible architecture

## Technical Architecture

### Code Structure

This is a **React Native** project built with **Expo** that provides a modern Bitcoin wallet experience. The app uses a clean, modular architecture with clear separation of concerns:

- **Frontend**: React Native with Expo for cross-platform mobile development
- **Styling**: Tailwind CSS via NativeWind for consistent, utility-first styling
- **State Management**: Zustand for lightweight, performant state management
- **Bitcoin, Lightning and Cashu Operations**: Coco-Cashu for modular ecash processing and mint operations
- **Nostr Integration**: nostr-development-kit (NDK) for decentralized communication and identity

### Built With

- **React Native** - Cross-platform mobile development framework
- **Expo** - Development platform and build tools
- **TypeScript** - Type-safe development with full type coverage
- **Tailwind CSS** - Utility-first CSS framework via NativeWind
- **Zustand** - Lightweight state management (replacing Redux)
- **Coco-Cashu** - Modular Cashu implementation for ecash operations
- **nostr-development-kit (NDK)** - Nostr protocol integration and utilities
- **Redux** - Legacy state management (being migrated to Zustand)

### Protocol Support

- **Cashu NUTs** - NUT-00 through NUT-13, NUT-17, NUT-18, NUT-23
- **Lightning Network** - BOLT11 invoices
- **Nostr** - NIP-04 (encrypted DMs), NIP-05 (identifiers), NIP-06 (key derivation), NIP-19 (bech32)
- **BIP39/BIP32** - Hierarchical deterministic wallets

## Development Status

Due to migrating to the Coco architecture, several features were temporarily removed to ensure a more reliable foundation. This "one step back, two steps forward" approach ensures long-term stability and maintainability.

### Known Issues

- Some experimental features require manual activation
- Limited multi-unit support in current Coco implementation
- Transaction expiration handling needs refinement

## Contributing

We welcome contributions! Please see our [GitHub repository](https://github.com/SovranBitcoin/Sovran) for:

- Issue reporting
- Feature requests
- Code contributions
- Documentation improvements

## Support

- **GitHub Issues** - Bug reports and feature requests
- **Nostr** - Direct messaging via Nostr protocol
- **Twitter** - [@KevinKelbie](https://x.com/KevinKelbie)

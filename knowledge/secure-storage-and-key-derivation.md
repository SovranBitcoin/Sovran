# Secure Storage & Key Derivation

Everything in the app derives from a single **12-word BIP-39 mnemonic** stored in `expo-secure-store`. This document specifies what is stored, how each value is derived, why it exists, and how to reproduce it.

## Root Secret

| Key | Value | Scope |
|-----|-------|-------|
| `user_mnemonic` | 12-word BIP-39 mnemonic (English wordlist, 128-bit entropy) | Global (one per device) |

Generated once on first launch:

```ts
const entropy = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
const mnemonic = bip39.entropyToMnemonic(entropy, english);
```

Or migrated from the legacy Redux store (profile 0). Never overwritten — all accounts derive from it using different indexes.

## Derivation Tree

Given mnemonic `M` and account index `N` (0, 1, 2, ...):

```
user_mnemonic (M)
│
├─ Nostr Keys (NIP-06: m/44'/1237'/<account>'/0/0)
│   Used for: signing Nostr events, NDK authentication, user identity,
│             DM encryption, NPC plugin event signing, mint selection
│
└─ Cashu Mnemonic (BIP-32: m/44'/129372'/0'/<account>'/0/0)
    │   A 24-word mnemonic derived from the private key at this path
    │
    └─ Cashu Wallet Seed (bip39.mnemonicToSeedSync(cashuMnemonic, ""))
        Used for: passed to coco-cashu-core Manager as the seedGetter callback
```

## 1. Nostr Keys (NIP-06)

### What they are

A Schnorr keypair derived from the mnemonic per the [NIP-06](https://github.com/nostr-protocol/nips/blob/master/06.md) standard.

### How they're derived

```ts
import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';

// NIP-06 internally does:
//   seed  = bip39.mnemonicToSeedSync(M, passphrase)   // passphrase = undefined → ""
//   root  = HDKey.fromMasterSeed(seed)
//   child = root.derive("m/44'/1237'/N'/0/0")
//   sk    = child.privateKey                           // 32 bytes
//   pk    = schnorr.getPublicKey(sk)                   // 32-byte x-only pubkey

const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(M, undefined, N);

const nsec = nip19.nsecEncode(sk);   // bech32: "nsec1..."
const npub = nip19.npubEncode(pk);   // bech32: "npub1..."
```

**BIP-32 path** ([NIP-06](https://github.com/nostr-protocol/nips/blob/master/06.md)): `m/44'/1237'/<account>'/0/0`

| Segment | Value | Meaning |
|---------|-------|---------|
| `44'` | [BIP-44](https://bips.xyz/44) purpose | Hardened |
| `1237'` | Nostr coin type ([SLIP-44](https://github.com/satoshilabs/slips/blob/master/slip-0044.md)) | Hardened |
| `<account>'` | Account index (0, 1, 2, ...) | Hardened |
| `0` | External chain | Not hardened |
| `0` | Address index | Not hardened |

The passphrase is always `undefined` (equivalent to empty string `""` in BIP-39). A different passphrase would produce an entirely different root seed and therefore different keys.

### NIP-06 Test Vectors

From the [NIP-06 spec](https://github.com/nostr-protocol/nips/blob/master/06.md) (account index 0):

| | Vector 1 | Vector 2 |
|-|----------|----------|
| **mnemonic** | `leader monkey parrot ring guide accident before fence cannon height naive bean` | `what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade` |
| **private key** | `7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a` | `c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add` |
| **nsec** | `nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp` | `nsec1c9wh8xy5eqdzln7n5t0ctgxjcrdug73gp5yj0x03gntn67h83twssdfhel` |
| **public key** | `17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917` | `d41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573` |
| **npub** | `npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu` | `npub16sdj9zv4f8sl85e45vgq9n7nsgt5qphpvmf7vk8r5hhvmdjxx4es8rq74h` |

These can be used to verify that the derivation implementation produces correct output.

### Why they're needed

| Value | Used for |
|-------|----------|
| `privateKey` | NDK signer (`NDKPrivateKeySigner`) for signing all Nostr events; NPC plugin signer for signing NUT-18 payment events; encrypting/decrypting direct messages |
| `publicKey` (hex) | Filtering Nostr events by author; mint selection key (`selectedMints[pubkey]`); default mints initialization flag; NPC API authentication; profile identity |
| `npub` | Display in settings/profile UI; lightning address (`<npub>@npubx.cash`); NIP-05 username claims |
| `nsec` | Display in settings/profile UI for backup |

### Where they're consumed

- **`NostrNDKProvider`** — `new NDKPrivateKeySigner(privateKey)` to authenticate with relays
- **`CocoManager`** — `new NsecSigner(privateKey)` → wraps in `NPCPlugin` for signing Cashu NPC events
- **DM screens** — `privateKey` signs/encrypts gift-wrap messages (NIP-44)
- **Mint selection** — `pubkey` is the key in `mintStore.selectedMints[pubkey]`
- **Profile pages** — `npub`/`nsec` displayed for user identity and backup

## 2. Cashu Mnemonic

### What it is

A separate 24-word BIP-39 mnemonic derived deterministically from the root mnemonic. It serves as the seed material for the Cashu wallet (coco-cashu-core), ensuring wallet state is recoverable from the root mnemonic alone.

**Security isolation**: The Cashu mnemonic uses a completely different BIP-32 subtree (`m/44'/129372'/...`) from the Nostr keys (`m/44'/1237'/...`). This is intentional — users routinely paste their nsec into third-party Nostr clients, so a leaked Nostr private key must not allow an attacker to derive the Cashu wallet and drain funds. Because the paths diverge at the coin-type level, knowledge of a Nostr private key reveals nothing about the Cashu seed.

### How it's derived

```ts
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const seed = bip39.mnemonicToSeedSync(M);                      // 64-byte BIP-39 seed
const root = HDKey.fromMasterSeed(seed);                        // BIP-32 master key
const child = root.derive(`m/44'/129372'/0'/${N}'/0/0`);        // account-specific child
const cashuMnemonic = bip39.entropyToMnemonic(child.privateKey, wordlist);
```

**BIP-32 path**: `m/44'/129372'/0'/N'/0/0`

| Segment | Value | Meaning |
|---------|-------|---------|
| `44'` | BIP-44 purpose | Hardened |
| `129372'` | Cashu coin type | Hardened |
| `0'` | Purpose sub-account | Hardened, always 0 |
| `N'` | Account index | Hardened, 0-based |
| `0` | Change | Not hardened, always 0 |
| `0` | Index | Not hardened, always 0 |

The derived child's `privateKey` (32 bytes) is re-encoded as a BIP-39 mnemonic via `entropyToMnemonic`, producing the Cashu mnemonic.

### Why it's needed

The coco-cashu-core `Manager` requires a deterministic seed to:
- Generate blinded secrets for Cashu proofs
- Derive deterministic outputs for token operations
- Enable wallet recovery from the root mnemonic

### Where it's consumed

- **`CocoManager.initialize()`** — The `seedGetter` callback converts the cashu mnemonic to a 64-byte seed: `bip39.mnemonicToSeedSync(cashuMnemonic, "")`, passed to the `Manager` constructor
- **`settings-pages/profile.tsx`** — Displayed in settings for user backup

## 3. Cashu Wallet Seed

### What it is

A 64-byte seed derived from the Cashu mnemonic, used directly by coco-cashu-core for all wallet operations.

### How it's derived

```ts
const walletSeed: Uint8Array = bip39.mnemonicToSeedSync(cashuMnemonic, '');
// 64 bytes, passed to Manager constructor as seedGetter return value
```

### Why it's needed

This is the actual cryptographic seed the Manager uses internally for:
- Minting tokens (`manager.mint.*`)
- Sending tokens (`manager.send.prepareSend()`, `manager.send.executePreparedSend()`)
- Receiving tokens (`manager.wallet.receive()`)
- Proof generation and verification
- Wallet restore operations (`manager.wallet.restore()`)
- Background recovery (`manager.recoverPendingSendOperations()`, `manager.recoverPendingMeltOperations()`)

## SecureStore Key Map

All keys stored in `expo-secure-store`:

| SecureStore Key | Format | Scope | Purpose |
|-----------------|--------|-------|---------|
| `user_mnemonic` | `string` (12 space-separated words) | Global | Root secret — all other values derive from this |
| `derived_keys_{N}` | JSON ([schema below](#cachedDerivedkeys-schema)) | Per account | Performance cache for Nostr keys (avoids re-deriving on every launch) |
| `cashu_mnemonic_{N}` | JSON ([schema below](#cashu_mnemonic_n-schema)) | Per account | Performance cache for Cashu mnemonic (avoids re-deriving on every launch) |
| `migrations_complete_{N}` | `"true"` | Per account | Skip Redux migration check on subsequent launches |
| `migrations_complete` | `"true"` | Legacy (account 0 only) | Old global flag, auto-promoted to `migrations_complete_0` on read |

### `CachedDerivedKeys` Schema

Stored at key `derived_keys_{N}`:

```json
{
  "npub": "npub1...",
  "nsec": "nsec1...",
  "pubkey": "hex-encoded 32-byte public key",
  "privateKeyHex": "hex-encoded 32-byte private key",
  "mnemonicHash": "base36 hash for cache invalidation"
}
```

### `cashu_mnemonic_{N}` Schema

```json
{
  "value": "12 or 24 word cashu mnemonic",
  "mnemonicHash": "base36 hash for cache invalidation"
}
```

### Cache Invalidation

Both cached values include a `mnemonicHash` — a fast non-cryptographic hash of the root mnemonic:

```ts
function hashMnemonic(mnemonic: string): string {
  let hash = 0;
  for (let i = 0; i < mnemonic.length; i++) {
    hash = (hash * 31 + mnemonic.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
```

On startup, if the stored hash doesn't match the current mnemonic's hash, the cached values are discarded and re-derived. This handles the edge case where the mnemonic is replaced (e.g. restore from backup).

## Per-Account Isolation

Each account index `N` gets its own isolated set of resources:

| Resource | Account 0 | Account N (N > 0) |
|----------|-----------|-------------------|
| Nostr keys | Path `m/44'/1237'/0'/0/0` | Path `m/44'/1237'/N'/0/0` |
| Cashu mnemonic | Path `m/44'/129372'/0'/0'/0/0` | Path `m/44'/129372'/0'/N'/0/0` |
| Cashu wallet seed | `mnemonicToSeedSync(cashu_mnemonic_0, "")` | `mnemonicToSeedSync(cashu_mnemonic_N, "")` |
| SQLite database | `coco.db` | `coco-N.db` |
| SecureStore cache | `derived_keys_0`, `cashu_mnemonic_0` | `derived_keys_N`, `cashu_mnemonic_N` |
| Migration flag | `migrations_complete_0` | `migrations_complete_N` |
| Coco migration | `profileStore.cocoMigrationComplete[0]` | `profileStore.cocoMigrationComplete[N]` |
| Default mints bootstrap | Stored/checked in Coco trusted mint state (idempotent add) | Stored/checked in Coco trusted mint state (idempotent add) |
| Selected mint | `mintStore.selectedMints[pubkey_0]` | `mintStore.selectedMints[pubkey_N]` |

The active account index is stored in `profileStore.activeAccountIndex` (persisted via Zustand + AsyncStorage). Switching accounts remounts the inner provider tree with a new `accountIndex` prop.

## Reproduction Steps

To reproduce all derived data from a mnemonic `M` and account index `N`:

```ts
import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// 1. Nostr private key + public key (NIP-06: m/44'/1237'/N'/0/0)
//    https://github.com/nostr-protocol/nips/blob/master/06.md
const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(M, undefined, N);

// 2. Bech32 encodings
const npub = nip19.npubEncode(pk);
const nsec = nip19.nsecEncode(sk);

// 3. Cashu mnemonic
const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(M));
const child = root.derive(`m/44'/129372'/0'/${N}'/0/0`);
const cashuMnemonic = bip39.entropyToMnemonic(child.privateKey, wordlist);

// 4. Cashu wallet seed (64 bytes, used by coco-cashu-core Manager)
const walletSeed = bip39.mnemonicToSeedSync(cashuMnemonic, '');
```

## Libraries

| Library | Version constraint | Purpose |
|---------|-------------------|---------|
| `@scure/bip39` | — | Mnemonic generation, `mnemonicToSeedSync`, `entropyToMnemonic` |
| `@scure/bip32` | — | `HDKey` for BIP-32 hierarchical key derivation |
| `nostr-tools/nip06` | — | `accountFromSeedWords` — NIP-06 Nostr key derivation |
| `nostr-tools` | — | `nip19.nsecEncode`, `nip19.npubEncode` — bech32 encoding |
| `expo-secure-store` | — | Encrypted key-value storage on device (Keychain on iOS, Keystore on Android) |
| `coco-cashu-core` | — | `Manager` — Cashu wallet operations (mint, send, receive, history) |
| `coco-cashu-plugin-npc` | — | `NPCPlugin` — NUT-18 payment requests via Nostr signing |

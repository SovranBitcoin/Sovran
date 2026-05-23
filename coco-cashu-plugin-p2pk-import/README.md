# coco-cashu-plugin-p2pk-import

Environment-agnostic Coco plugin for declaring the P2PK keys your app wants Coco to use.

The plugin does not read from SecureStore, localStorage, files, React context, Expo APIs, or Node APIs. You pass values or callbacks from your own app layer, and the plugin handles parsing, validation, keyring import, idempotency, and exposing receive public keys through `manager.ext.p2pkImport`.

## What It Does

- Imports spend-capable P2PK private keys into Coco's keyring.
- Accepts 32-byte `Uint8Array` keys, `nsec1...` strings, or 64-character hex private-key strings.
- Exposes compressed P2PK public keys with `manager.ext.p2pkImport.getPublicKeys()`.
- Supports public-key-only declarations when you only need to advertise lock targets.
- Keeps state inside the plugin instance, so create a fresh plugin when your active user/profile changes.

## Quick Start

```ts
import { Manager } from '@cashu/coco-core';
import { createP2PKImportPlugin } from 'coco-cashu-plugin-p2pk-import';

const p2pkImport = createP2PKImportPlugin({
  secretKey: '<nsec1... or 64-char-hex-private-key>',
});

const manager = new Manager(repositories, seedGetter, logger, undefined, [p2pkImport]);
await manager.initPlugins();

const p2pkPublicKey = manager.ext.p2pkImport.getPrimaryPublicKey();
```

## Import One P2PK Private Key

Use `secretKey` for a single spend-capable key. The value can be an `nsec`, 64-character hex private key, or `Uint8Array(32)`.

```ts
createP2PKImportPlugin({
  secretKey: '<64-char-hex-private-key>',
});
```

```ts
createP2PKImportPlugin({
  secretKey: '<nsec1...>',
});
```

```ts
createP2PKImportPlugin({
  secretKey: currentPrivateKeyBytes,
});
```

## Import Multiple P2PK Private Keys

Use `secretKeys` when one profile should be able to unlock tokens for more than one key.

```ts
createP2PKImportPlugin({
  secretKeys: ['<nsec1...>', '<64-char-hex-private-key>', currentPrivateKeyBytes],
});
```

The plugin de-dupes repeated private keys during init.

## Import The Current User Nsec

Use `getSecretKey` when the current user/profile is resolved by your app at runtime. Return `null` while the user is not ready.

```ts
const p2pkImport = createP2PKImportPlugin({
  getSecretKey: () => auth.currentUser?.nsec ?? null,
});
```

For React, Expo, React Native, or any other UI runtime, keep the runtime-specific part outside the plugin:

```ts
const currentUserNsecRef = { current: null as string | null };

const p2pkImport = createP2PKImportPlugin({
  getSecretKey: () => currentUserNsecRef.current,
});

// Later, when your app auth/profile layer resolves the active user:
currentUserNsecRef.current = activeUser.nsec;
```

If your app creates one Coco manager per profile, create one plugin instance per manager/profile. That keeps one profile's nsec from being remembered by another profile's manager.

`getSecretKey` is evaluated when `manager.initPlugins()` runs. If the nsec becomes available later, call `manager.initPlugins()` again or create the manager after your active profile is ready.

## Import Multiple Runtime Keys

Use `getSecretKeys` when your app loads a list from your own storage, backend, profile store, or keychain.

```ts
createP2PKImportPlugin({
  getSecretKeys: async () => {
    const keys = await loadP2PKKeysForActiveProfile();
    return keys; // Array of nsec strings, hex strings, or Uint8Array(32) values.
  },
});
```

## Public-Key-Only Mode

Use `publicKey` or `publicKeys` when you only need to advertise lock targets and do not want this Coco manager to hold spend-capable private key material.

```ts
createP2PKImportPlugin({
  publicKey: '02...',
});
```

```ts
createP2PKImportPlugin({
  publicKeys: ['02...', '03...'],
});
```

Dynamic public keys work the same way:

```ts
createP2PKImportPlugin({
  getPublicKeys: () => activeProfile.p2pkPublicKeys,
});
```

## Reading Keys After Init

```ts
const keys = manager.ext.p2pkImport.getPublicKeys();
const primary = manager.ext.p2pkImport.getPrimaryPublicKey();
```

For receive surfaces that should prefer plugin keys but fall back to Coco's latest keyring key:

```ts
import { resolvePrimaryReceiveP2PKPublicKey } from 'coco-cashu-plugin-p2pk-import';

const receiveKey = await resolvePrimaryReceiveP2PKPublicKey(manager);
```

## Form Imports

`parseP2PKSecretInput` is useful for settings screens and paste flows. It accepts `nsec1...` and 64-character hex private keys.

```ts
import { parseP2PKSecretInput, rememberP2PKImportPublicKeys } from 'coco-cashu-plugin-p2pk-import';

const parsed = parseP2PKSecretInput(input);
if (parsed.success) {
  const keypair = await manager.keyring.addKeyPair(parsed.secretKey);
  rememberP2PKImportPublicKeys(manager, [keypair.publicKeyHex]);
}
```

Only call `rememberP2PKImportPublicKeys` for keys that should become the plugin-preferred receive keys for the current manager/profile.

## Safety Notes

- `secretKey`, `secretKeys`, `getSecretKey`, and `getSecretKeys` import spend-capable private keys into Coco.
- `publicKey`, `publicKeys`, `getPublicKey`, and `getPublicKeys` expose public lock targets only.
- Do not hardcode real nsecs or private keys in source.
- Recreate the plugin when the active user/profile changes.
- The plugin logs public keys and validation failures, never private key values.

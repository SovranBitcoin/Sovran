# DeepWiki Q&A with Code Context for Repository: Egge21M/eNuts

## Q1

I want you to find all relevant code for react and getting started with react coco. Look for examples and functions that are available by api. Also tell me all coco libraries in this project that are useful including database ones and how to set those up with react.

### Answer

# React and Coco-Cashu Integration in eNuts

## Coco-Cashu Libraries Used

The eNuts project uses three main coco-cashu libraries for React integration:

1. **coco-cashu-core**: Core Cashu functionality and Manager class eNuts:22-22
2. **coco-cashu-expo-sqlite**: SQLite database repositories for Expo eNuts:23-23
3. **coco-cashu-react**: React hooks and providers for Cashu operations eNuts:24-24

## React Provider Setup

### Main Provider Configuration

The app uses `CocoCashuProvider` as the main provider that wraps the entire application and provides access to all coco-cashu hooks: eNuts:172-172

### Manager Initialization

The Manager is initialized with database repositories and seed management: eNuts:91-109

### Database Setup

The database provider uses Expo SQLite and is configured for the coco-cashu repositories: eNuts:92-94

## Available React Hooks and API

### Balance Management Hooks

- **useBalanceContext**: Access current balance information eNuts:4-4
- **BalanceProvider**: Provider for balance context eNuts:3-3

### Manager Hooks

- **useManager**: Access the core Manager instance eNuts:6-6
- **useManagerContext**: Access manager context eNuts:7-7

### Transaction Hooks

- **useReceive**: Handle receiving/claiming tokens eNuts:8-8
- **useSend**: Handle sending tokens eNuts:27-27

### Mint Management

- **useMints**: Access mint information eNuts:3-3

### History Hooks

- **usePaginatedHistory**: Access paginated transaction history eNuts:30-30

## Database Setup with React

### Database Provider

The database provider manages SQLite connections using Expo: eNuts:67-68

### Repository Integration

The ExpoSqliteRepositories connects the database to the coco-cashu core: eNuts:37-37

## React Usage Examples

### Custom Hook Implementation

Example of combining multiple coco-cashu hooks to create higher-level functionality: eNuts:7-18

### Receive Token Flow

Example of using `useReceive` hook in a complete claim flow: eNuts:17-17

### Balance Display

Example of using `useBalanceContext` for displaying balance information: eNuts:43-43

### History Integration

Example of using `usePaginatedHistory` for transaction history: eNuts:44-44

## Getting Started Setup

1. **Crypto Polyfill**: Essential crypto polyfill setup required before importing any modules eNuts:6-111

2. **Provider Tree**: The CocoCashuProvider must wrap your app components eNuts:172-180

3. **Manager Initialization**: Create Manager instance with repositories and seed management eNuts:102-108

## Notes

The eNuts project demonstrates a complete React Native implementation using the coco-cashu ecosystem. The setup requires proper crypto polyfills for React Native environments, initialization of the Manager with database repositories, and wrapping the app with CocoCashuProvider to enable all hooks. The architecture shows how to build higher-level React hooks by combining the base coco-cashu-react hooks, and provides examples of common operations like sending, receiving, balance checking, and transaction history management.

### Citations

**File:** package.json (L22-22)

```json
    "coco-cashu-core": "^1.0.0-rc5",
```

**File:** package.json (L23-23)

```json
    "coco-cashu-expo-sqlite": "^0.6.0",
```

**File:** package.json (L24-24)

```json
    "coco-cashu-react": "^1.1.0",
```

**File:** src/components/App.tsx (L37-37)

```typescript
import { ExpoSqliteRepositories } from 'coco-cashu-expo-sqlite';
```

**File:** src/components/App.tsx (L91-109)

```typescript
async function createManager() {
  const db = dbProvider.getDatabase();
  const repo = new ExpoSqliteRepositories({ database: db });
  await repo.init();
  async function seedGetter() {
    const seed = await seedService.getSeed();
    if (!seed) {
      throw new Error('No seed found');
    }
    return seed;
  }
  const mgr = new Manager(repo, seedGetter, appLogger.child({ name: 'Manager' }));
  await mgr.enableMintQuoteWatcher();
  return mgr;
}
```

**File:** src/components/App.tsx (L172-180)

```typescript
    <CocoCashuProvider manager={manager}>
      <AppProviders>
        <Navigator shouldOnboard={shouldOnboard} hasSeed={hasSeed} />
        <StatusBar style="auto" />
        <ClipboardModal />
        <QRScannerBottomSheet />
        <Toaster />
      </AppProviders>
    </CocoCashuProvider>
```

**File:** src/context/Balance.tsx (L3-3)

```typescript
  BalanceProvider,
```

**File:** src/context/Balance.tsx (L4-4)

```typescript
  useBalanceContext,
```

**File:** src/context/Manager.tsx (L6-6)

```typescript
  useManager,
```

**File:** src/context/Manager.tsx (L7-7)

```typescript
  useManagerContext,
```

**File:** src/components/hooks/useCashuClaimFlow.ts (L8-8)

```typescript
import { useReceive, useSend } from 'coco-cashu-react';
```

**File:** src/components/hooks/useCashuClaimFlow.ts (L17-17)

```typescript
const { receive, isReceiving, isError: isReceiveError } = useReceive();
```

**File:** src/screens/Payment/SendSelectAmount.tsx (L27-27)

```typescript
import { useSend } from 'coco-cashu-react';
```

**File:** src/context/KnownMints.tsx (L3-3)

```typescript
import { useMints, useBalanceContext } from 'coco-cashu-react';
```

**File:** src/context/KnownMints.tsx (L7-18)

```typescript
export const useKnownMints = () => {
  const { mints } = useMints();
  const { balance } = useBalanceContext();

  const knownMints: KnownMintWithBalance[] = useMemo(
    () => mints.map((mint) => ({ ...mint, balance: balance[mint.mintUrl] || 0 })),
    [mints, balance]
  );

  return { knownMints, loading: false };
};
```

**File:** src/components/Balance.tsx (L30-30)

```typescript
import { usePaginatedHistory } from 'coco-cashu-react';
```

**File:** src/components/Balance.tsx (L43-43)

```typescript
const { balance } = useBalanceContext();
```

**File:** src/components/Balance.tsx (L44-44)

```typescript
const { history: latestHistory, hasMore } = usePaginatedHistory(3);
```

**File:** src/storage/DbProvider.ts (L67-68)

```typescript
const dbProvider = new DbProvider('coco.db');
export { dbProvider };
```

**File:** src/shim.ts (L6-111)

```typescript
function setupCryptoPolyfill() {
  // Create a wrapper for getRandomValues that matches Web Crypto API signature
  const getRandomValuesWrapper = <T extends ArrayBufferView | null>(array: T): T => {
    if (!array) {
      throw new TypeError('getRandomValues called with null or undefined');
    }

    // Check if it's a valid TypedArray for crypto operations
    const validTypes = [
      'Int8Array',
      'Uint8Array',
      'Uint8ClampedArray',
      'Int16Array',
      'Uint16Array',
      'Int32Array',
      'Uint32Array',
      'BigInt64Array',
      'BigUint64Array',
    ];

    const typeName = array.constructor.name;
    if (!validTypes.includes(typeName)) {
      throw new TypeError(`getRandomValues called with unsupported type: ${typeName}`);
    }

    // Cast to the expected type and call expo-crypto
    const result = c.getRandomValues(array as any);
    return result as T;
  };

  // Define a proper crypto object with all necessary methods
  const cryptoPolyfill = {
    getRandomValues: getRandomValuesWrapper,
    randomUUID:
      c.randomUUID ||
      (() => {
        // Fallback UUID generation if not available
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c == 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }),
    subtle: undefined, // Not needed for most cases
    // Add other crypto methods from expo-crypto
    digest: c.digest,
    digestStringAsync: c.digestStringAsync,
    getRandomBytes: c.getRandomBytes,
    getRandomBytesAsync: c.getRandomBytesAsync,
  };

  // Set up global crypto object
  if (typeof globalThis !== 'undefined') {
    if (!globalThis.crypto) {
      // @ts-expect-error - polyfill assignment
      globalThis.crypto = cryptoPolyfill;
    } else if (!globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues = cryptoPolyfill.getRandomValues;
    }
  }

  // Set up global.crypto
  if (typeof global !== 'undefined') {
    if (!global.crypto) {
      // @ts-expect-error - polyfill assignment
      global.crypto = cryptoPolyfill;
    } else if (!global.crypto.getRandomValues) {
      global.crypto.getRandomValues = cryptoPolyfill.getRandomValues;
    }
  }

  // Set up window.crypto if in browser environment
  if (typeof window !== 'undefined') {
    if (!window.crypto) {
      // @ts-expect-error - polyfill assignment
      window.crypto = cryptoPolyfill;
    } else if (!window.crypto.getRandomValues) {
      window.crypto.getRandomValues = cryptoPolyfill.getRandomValues;
    }
  }

  // Also set up self.crypto for web workers
  if (typeof self !== 'undefined' && self !== global) {
    if (!self.crypto) {
      // @ts-expect-error - polyfill assignment
      self.crypto = cryptoPolyfill;
    } else if (!self.crypto.getRandomValues) {
      self.crypto.getRandomValues = cryptoPolyfill.getRandomValues;
    }
  }

  console.log('shim.ts - crypto polyfill setup complete');
  console.log('Available crypto methods:', Object.keys(global.crypto || {}));
}

// Run the polyfill immediately
setupCryptoPolyfill();
```

## Q2

find any other hooks or functions created that use coco. so if some hook is made that wraps some coco functions I'd like to know about those.

### Answer

Based on my analysis of the eNuts codebase, I found the following custom React hooks or functions that wrap or utilize functions from the specified `coco-cashu-core`, `coco-cashu-expo-sqlite`, or `coco-cashu-react` libraries, beyond the already identified ones:

## Custom Hooks Found:

### 1. `useCashuClaimFlow`

This is a custom hook that wraps the `useReceive` hook from `coco-cashu-react` to provide a complete token claiming flow with error handling and mint trust verification. eNuts:8-8 eNuts:12-60

### 2. `useKnownMints`

This is a custom hook that combines the `useMints` and `useBalanceContext` hooks from `coco-cashu-react` to create a derived hook that provides mints with their associated balances. eNuts:3-3 eNuts:7-18

## Library Initialization and Setup:

The app also initializes and configures the coco-cashu libraries in the main App component: eNuts:35-37

## Notes:

- The `useCashuClaimFlow` hook enhances the basic `useReceive` functionality with additional features like mint trust verification and error handling
- The `useKnownMints` hook provides a more convenient way to work with mints by combining balance information from multiple sources
- Most other hooks in the codebase either don't use these libraries directly or are utility hooks for other purposes (like QR scanning, UR decoding, etc.)
- The context files primarily serve as re-exports of the base hooks from `coco-cashu-react` rather than adding additional wrapper functionality

### Citations

**File:** src/components/hooks/useCashuClaimFlow.ts (L8-8)

```typescript
import { useReceive, useSend } from 'coco-cashu-react';
```

**File:** src/components/hooks/useCashuClaimFlow.ts (L12-60)

```typescript
export function useCashuClaimFlow() {
  const { t } = useTranslation([NS.common, NS.error, NS.wallet]);
  const { openPromptAutoClose } = usePromptContext();
  const manager = useManager();
  const { open: openTrustMint } = useTrustMint();
  const { receive, isReceiving, isError: isReceiveError } = useReceive();

  const claimFromTokenString = async (tokenStr: string): Promise<ClaimResult> => {
    let decoded: Token;

    try {
      const decoded = getDecodedToken(tokenStr);
      const isKnown = await manager.mint.isKnownMint(decoded.mint);
      if (isKnown) {
        await receive(decoded, {
          onError: (e) => {
            console.error(e);
            openPromptAutoClose({
              msg: isErr(e) ? e.message : t('receiveTokenErr', { ns: NS.error }),
            });
            return 'error';
          },
        });
        return 'success';
      }

      const action = await openTrustMint(decoded);
      if (action === 'trust') {
        await manager.mint.addMint(decoded.mint);
        await manager.wallet.receive(decoded);
        return 'success';
      }
      // If cancelled or any other action, just abort as per requirement
      return 'cancelled';
    } catch (e) {
      console.error(e);
      openPromptAutoClose({
        msg: isErr(e) ? e.message : t('Something went wrong'),
      });
      return 'error';
    }
  };

  return { claimFromTokenString, isReceiving };
}
```

**File:** src/context/KnownMints.tsx (L3-3)

```typescript
import { useMints, useBalanceContext } from 'coco-cashu-react';
```

**File:** src/context/KnownMints.tsx (L7-18)

```typescript
export const useKnownMints = () => {
  const { mints } = useMints();
  const { balance } = useBalanceContext();

  const knownMints: KnownMintWithBalance[] = useMemo(
    () => mints.map((mint) => ({ ...mint, balance: balance[mint.mintUrl] || 0 })),
    [mints, balance]
  );

  return { knownMints, loading: false };
};
```

**File:** src/components/App.tsx (L35-37)

```typescript
import * as SplashScreen from 'expo-splash-screen';
import { CocoCashuProvider } from 'coco-cashu-react';
import { ExpoSqliteRepositories } from 'coco-cashu-expo-sqlite';
```

## Q3

I want to migrate from using redux custom cashu implementation which is found in my redux (for storing proofs, transactions, and proofs) and also in cashuClient which includes all the utility functions. I think it would be super good if we could remove all cashuClient code in favour of using coco. This might require refactoring where this code is used, and we will need to make sure we migrate my code from redux to whatever coco uses to persist data. That might still be in redux but we’d need to use `saveProofs` and `setCounter` I think to define the users current proofs that way we can migrate all users to the new library.

```
├── helper/cashuClient.ts (1562 lines, 36 functions)
│   ├── getWallet() [lines 142-214]
│   │   ├── params: (undefined: GetWalletParams)
│   │   └── returns: Promise
│   ├── getMint() [lines 216-253]
│   │   ├── params: (undefined: GetMintParams)
│   │   └── returns: Promise
│   ├── getMeltQuote() [lines 256-292]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── sendLightning() [lines 294-499]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── attemptSend() [lines 331-483]
│   │   ├── params: (forceRefresh: any = ..., updateCounter: any = ...)
│   │   └── returns: Promise
│   ├── receiveLightning() [lines 501-567]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── checkLightningReceiveStatus() [lines 569-661]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── sendEcash() [lines 663-816]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── attemptSend() [lines 683-801]
│   │   ├── params: (forceRefresh: any = ..., updateCounter: any = ...)
│   │   └── returns: Promise
│   ├── receiveEcash() [lines 818-965]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── getPubkeyFromToken() [lines 838-846]
│   │   ├── params: (token: string)
│   │   └── returns: void
│   ├── attemptReceive() [lines 860-952]
│   │   ├── params: (forceRefresh: any = ...)
│   │   └── returns: Promise
│   ├── getPaymentRequest() [lines 967-1000]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── cancelEcashTransaction() [lines 1002-1031]
│   │   ├── params: (transaction: Transaction, navigation: any)
│   │   └── returns: Promise
│   ├── getUsedProofs() [lines 1033-1050]
│   │   ├── params: (currentProofs: any, keepProofs: any)
│   │   └── returns: void
│   ├── useWallet() [lines 1052-1121]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── fetchWallet() [lines 1060-1080]
│   │   ├── params: ()
│   │   └── returns: void
│   ├── refetch() [lines 1093-1113]
│   │   ├── params: ()
│   │   └── returns: void
│   ├── checkTokenSpent() [lines 1126-1142]
│   │   ├── params: (undefined: any)
│   │   ├── returns: void
│   │   └── desc: "Checks if a token has been spent"
│   ├── isValidEcashToken() [lines 1182-1184]
│   │   ├── params: (token: string)
│   │   ├── returns: boolean
│   │   └── desc: "Validates if a string is a valid ecash token"
│   ├── isValidPaymentRequest() [lines 1189-1191]
│   │   ├── params: (paymentRequest: string)
│   │   ├── returns: boolean
│   │   └── desc: "Validates if a string is a valid payment request"
│   ├── getLightningAmount() [lines 1194-1199]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getTimestamp() [lines 1201-1205]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getRawExpiry() [lines 1207-1213]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getExpiry() [lines 1215-1217]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getExpiresIn() [lines 1219-1222]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getDescription() [lines 1224-1227]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── npubToPublicKey() [lines 1229-1238]
│   │   ├── params: (key: string)
│   │   └── returns: void
│   ├── maybeConvertNpub() [lines 1240-1249]
│   │   ├── params: (key: string)
│   │   └── returns: void
│   ├── pubKeyTo02() [lines 1251-1253]
│   │   ├── params: (key: string)
│   │   └── returns: void
│   ├── restoreMint() [lines 1258-1430]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: void
│   ├── restoreCounter() [lines 1432-1475]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── checkIfAlreadyRedeemed() [lines 1477-1488]
│   │   ├── params: (token: string)
│   │   └── returns: boolean
│   ├── deriveMintBackupKeys() [lines 1502-1520]
│   │   ├── params: (mnemonic: string)
│   │   └── returns: unknown
│   ├── keysetIdToBigInt() [lines 1522-1530]
│   │   ├── params: (id: string)
│   │   └── returns: unknown
│   └── isCollidingKeysetId() [lines 1532-1561]
│       ├── params: (newKeysetIdHex: string, storedKeysetIds: string[])
│       └── returns: void
```

---

This is what I want to do, what I want you to do is create a document to help me migrate to coco. I've helpfully provided a bunch of functions I have already which will need alternatives. I understand coco uses rich hooks which can provide access to a lot of this utilities but might not have a direct comparable function.

### Answer

Based on my analysis of the eNuts codebase, I need to clarify that there is no `cashuClient.ts` file in this repository. Instead, eNuts has already migrated to using the coco-cashu libraries directly. Here's how the functionality maps:

## Core Architecture Migration

The eNuts app has migrated from a custom Redux-based implementation to use the coco-cashu libraries:

**New Architecture:**

- **coco-cashu-core**: Provides the `Manager` class as the central orchestrator eNuts:102-109
- **coco-cashu-expo-sqlite**: Provides `ExpoSqliteRepositories` for data persistence eNuts:92-94
- **coco-cashu-react**: Provides React hooks like `useReceive`, `useSend`, `useManager`, `usePaginatedHistory` eNuts:2-8

## Function Mapping

### Core Wallet Operations

The legacy wallet functions in the old implementation would map as follows:

**Wallet Management:**

- `getWallet`, `getMint` → Replaced by `Manager` instance eNuts:85-96
- `useWallet`, `fetchWallet`, `refetch` → `useManager()` hook eNuts:15-15

**Lightning Operations:**

- `getMeltQuote`, `sendLightning`, `attemptSend` → Legacy implementation in eNuts:176-261
- `receiveLightning`, `checkLightningReceiveStatus` → Background loop process eNuts:423-447

**Token Operations:**

- `sendEcash`, `receiveEcash` → `useSend()` and `useReceive()` hooks eNuts:42-42
- `attemptReceive` → `receive()` function from `useReceive()` hook eNuts:17-17
- `checkTokenSpent` → `isTokenSpendable()` function eNuts:125-154

### Data Persistence Migration

**Proof and Transaction Management:**

- Legacy database functions are replaced by `ExpoSqliteRepositories`:
  - `addProofs`, `deleteProofs` → Repository methods eNuts:136-191
  - `getUsedProofs` → Handled by repositories eNuts:97-119
  - `getMintsBalances` → Repository balance queries eNuts:37-50

**Counter Management:**

- `restoreCounter` → Counter management in legacy implementation eNuts:344-398

### Utility Functions

**Token Validation:**

- `isValidEcashToken` → `isCashuToken()` utility eNuts:228-259
- `isValidPaymentRequest` → `isLnInvoice()` utility eNuts:286-303

**Lightning Utilities:**

- `getLightningAmount`, `getDescription` → `decodeLnInvoice()` utility eNuts:332-350
- `getTimestamp`, `getExpiry`, `getExpiresIn` → Lightning invoice decoding utilities eNuts:324-330

**Cryptographic Functions:**
Most of the specific utility functions you mentioned (`npubToPublicKey`, `maybeConvertNpub`, `pubKeyTo02`, `deriveMintBackupKeys`, `keysetIdToBigInt`, `isCollidingKeysetId`) are not present in this codebase, suggesting they may be custom implementations specific to your Redux-based system.

## Migration Strategy

For migrating from a Redux-based custom implementation:

1. **Replace custom wallet management** with `Manager` from coco-cashu-core
2. **Replace custom database layer** with `ExpoSqliteRepositories` from coco-cashu-expo-sqlite
3. **Replace custom React state management** with hooks from coco-cashu-react
4. **Seed management** is handled by a dedicated service eNuts:6-51

## Notes

The eNuts codebase serves as an excellent reference for migrating to the coco-cashu libraries, as it demonstrates the complete integration of all three packages. The Manager-based architecture centralizes Cashu operations, while the repository pattern handles data persistence, and React hooks provide clean state management for UI components.

### Citations

**File:** src/components/App.tsx (L92-94)

```typescript
const db = dbProvider.getDatabase();
const repo = new ExpoSqliteRepositories({ database: db });
await repo.init();
```

**File:** src/components/App.tsx (L102-109)

```typescript
      const mgr = new Manager(
        repo,
        seedGetter,
        appLogger.child({ name: "Manager" })
      );
      await mgr.enableMintQuoteWatcher();
      return mgr;
    }
```

**File:** src/context/Manager.tsx (L2-8)

```typescript
export {
  ManagerCtx,
  ManagerProvider,
  ManagerGate,
  useManager,
  useManagerContext,
} from 'coco-cashu-react';
```

**File:** src/wallet/index.ts (L85-96)

```typescript
async function getWallet(mintUrl: string): Promise<CashuWallet> {
  if (wallets[mintUrl]) {
    return wallets[mintUrl];
  }
  const mint = new CashuMint(mintUrl);
  const seed = await getSeed();
  const keys = await mint.getKeys();
  const wallet = new CashuWallet(mint, keys, seed);
  _setKeys(mintUrl, keys);
  wallets[mintUrl] = wallet;
  return wallet;
}
```

**File:** src/wallet/index.ts (L125-154)

```typescript
export async function isTokenSpendable(token: string): Promise<boolean> {
  try {
    const decoded = getDecodedToken(token);
    if (!decoded?.token?.length) {
      return false;
    }
    const useableTokenProofs: Proof[] = [];
    for (const t of decoded.token) {
      if (!t?.proofs?.length) {
        continue;
      }

      const w = await getWallet(t.mint);

      const usedSecrets = (await w.checkProofsSpent(t.proofs)).map((x) => x.secret);
      if (usedSecrets.length === t.proofs.length) {
        // usedTokens.push(token)
        continue;
      }
      useableTokenProofs.push(...t.proofs.filter((x) => !usedSecrets.includes(x.secret)));
    }
    return !!useableTokenProofs.length;
  } catch {
    return false;
  }
}
```

**File:** src/wallet/index.ts (L176-261)

```typescript
export async function payLnInvoice(
  mintUrl: string,
  invoice: string,
  fee: number,
  proofs: Proof[] = []
): TPayLnInvoiceReturnType {
  const wallet = await getWallet(mintUrl);
  const { amount } = decodeLnInvoice(invoice);
  if (!amount) {
    throw new Error('bad invoice amount');
  }
  const amountToPay = amount + fee;
  if (!proofs?.length) {
    const { proofsToUse } = await getProofsToUse(mintUrl, amountToPay);
    proofs = proofsToUse;
  }
  try {
    if (sumProofsValue(proofs) > amountToPay) {
      l('[payLnInvoce] use send ', {
        amountToPay,
        amount,
        fee,
        proofs: sumProofsValue(proofs),
      });
      const counter = await getCounterByMintUrl(mintUrl);
      const { send, returnChange, newKeys } = await wallet.send(
        amountToPay,
        proofs,
        undefined,
        counter
      );
      if (newKeys) {
        _setKeys(mintUrl, newKeys);
      }
      if (returnChange?.length) {
        await addToken({
          token: [{ mint: mintUrl, proofs: returnChange }],
        });
      }
      if (send?.length) {
        await deleteProofs(proofs);
        await incrementCounterByMintUrl(mintUrl, send.length + returnChange.length);
      }
      proofs = send;
    }
    l({ fee, sum: sumProofsValue(proofs) });
    const counter = await getCounterByMintUrl(mintUrl);
    const result = await wallet.payLnInvoice(invoice, proofs, fee, counter);
    if (result?.newKeys) {
      _setKeys(mintUrl, result.newKeys);
    }
    if (result?.change?.length) {
      await addToken({
        token: [{ mint: mintUrl, proofs: result.change }],
      });
    }
    if (result.isPaid) {
      await deleteProofs(proofs);
    }
    const realFee = fee - sumProofsValue(result.change);
    if (realFee < 0) {
      l('######################################## ERROR ####################################');
      l({
        result,
        fee,
        realFee,
        amountToPay,
        amount,
        proofs: sumProofsValue(proofs),
      });
    }
    await incrementCounterByMintUrl(mintUrl, proofs.length + result.change.length);
    return { result, fee, realFee };
  } catch (error) {
    await addToken({ token: [{ mint: mintUrl, proofs }] });
    return { result: undefined, error };
  }
}
```

**File:** src/wallet/index.ts (L344-398)

```typescript
export async function getCounterByMintUrl(mintUrl: string) {
  try {
    console.log('getCounterByMintUrl', mintUrl);
    const seed = await getSeed();
    console.log('seed', seed);
    if (!seed) {
      return;
    }
    // TODO do not call getMintCurrentKeySetId() every time. find a faster way to get keysetId
    const keysetId = await getMintCurrentKeySetId(mintUrl);
    console.log('keysetId', keysetId);
    const storeKey = `${mintUrl}:${keysetId}`;
    const counter = await store.get(storeKey);
    if (!counter) {
      // store counters for current keyset of mint url passed as param
      await store.set(storeKey, '0');
      return 0;
    }
    l('[getCounterByMintUrl] ', {
      mintUrl,
      keysetId,
      storedCounter: counter,
    });
    return +counter;
  } catch (e) {
    l('[getCounterByMintUrl] Error while getCounter: ', e);
    throw Error('[getCounterByMintUrl] Error while getCounter');
  }
}

export async function incrementCounterByMintUrl(mintUrl: string, count: number) {
  try {
    const seed = await getSeed();
    if (!seed) {
      return;
    }
    // TODO do not call getMintCurrentKeySetId() every time. find a faster way to get keysetId
    const keysetId = await getMintCurrentKeySetId(mintUrl);
    const storeKey = `${mintUrl}:${keysetId}`;
    const counter = await store.get(storeKey);
    if (!counter) {
      return store.set(storeKey, `${count}`);
    }
    l('[before increment] ', { keysetId, counter });
    const newCounter = +counter + count;
    l('[after increment] ', { keysetId, newCounter });
    await store.set(storeKey, `${newCounter}`);
  } catch (e) {
    l('[incrementCounterByKeysetId] Error during counter increment: ', e);
    throw Error('[incrementCounterByKeysetId] Error during counter increment');
  }
}
```

**File:** src/wallet/index.ts (L423-447)

```typescript
async function requestTokenLoop(): Promise<void> {
  if (isRequestTokenLoopRunning) {
    return;
  }
  isRequestTokenLoopRunning = true;
  const invoices = await getAllInvoices();
  if (!invoices.length) {
    clearTimeout(loopHandel);
  }
  for (const invoice of invoices) {
    try {
      await requestToken(invoice.mintUrl, invoice.amount, invoice.hash);
      // TODO notify user and add history entry
    } catch {
      /* ignore */
    }
    const { expiry } = decodeLnInvoice(invoice.pr);
    const date = new Date(invoice.time * 1000 + expiry * 1000).getTime();

    if (Date.now() > date) {
      await delInvoice(invoice.hash);
    }
  }
  isRequestTokenLoopRunning = false;
}
```

**File:** src/components/hooks/useCashuClaimFlow.ts (L15-15)

```typescript
const manager = useManager();
```

**File:** src/components/hooks/useCashuClaimFlow.ts (L17-17)

```typescript
const { receive, isReceiving, isError: isReceiveError } = useReceive();
```

**File:** src/screens/Payment/SendSelectAmount.tsx (L42-42)

```typescript
const { isSending, isError: isSendError, send } = useSend();
```

**File:** src/storage/db/index.ts (L37-50)

```typescript
export async function getMintsBalances(): Promise<IMintWithBalance[]> {
  const result = await db.all<{ balance: number; mintUrl: string }>('select * from mintBalances');
  l('[getMintsBalances]', result);
  if (!result || !result.length) {
    return [];
  }
  return result.map((r) => ({
    mintUrl: r.mintUrl,
    amount: r.balance,
    name: '',
  }));
}
```

**File:** src/storage/db/index.ts (L97-119)

```typescript
async function _addUsedProofs(...proofs: Proof[]) {
  if (!proofs || !proofs.length) {
    return;
  }
  const sqlPrefix = 'INSERT OR IGNORE INTO proofsUsed (id, amount, secret, C) VALUES ';
  const sqlSuffix = proofs.map((_) => '(?, ?, ?, ?)').join(' , ');
  const sql = sqlPrefix + sqlSuffix;
  const params = proofs.flatMap((x) => [x.id, x.amount, x.secret, x.C]);
  const result = await db.run(sql, params);
  l('[_addUsedProofs]', result);
  return result?.changes === proofs.length;
}
async function addUsedProofs(...proofs: Proof[]): Promise<boolean> {
  if (!proofs || !proofs.length) {
    return false;
  }
  const results: (boolean | undefined)[] = [];
  for (const arr of arrToChunks(proofs, 100)) {
    results.push(await _addUsedProofs(...arr));
  }
  return results.every((x) => x);
}
```

**File:** src/storage/db/index.ts (L136-191)

```typescript
export async function addProofs(...proofs: Proof[]): Promise<boolean> {
  if (!proofs || !proofs.length) {
    return false;
  }
  const results: (boolean | undefined)[] = [];
  for (const arr of arrToChunks(proofs, 100)) {
    results.push(await _addProofs(...arr));
  }
  return results.every((x) => x);
}
/* async function addProof({ id, amount, secret, C }: Proof) {
	const sql = 'INSERT OR IGNORE INTO proofs (id, amount, secret, C) VALUES (?, ?, ?, ?)'
	const params = [id, amount, secret, C]
	const result = await db.execInsert<Proof>(sql, params)
	l('[addProof]', result, { id, amount, secret, C })
	return !!(result?.insertId || result?.rowsAffected)
} */
export async function getProofs(): Promise<Proof[]> {
  const proofs = await db.all<Proof>('SELECT * FROM proofs', []);
  l('[getProofs]', proofs);
  if (!proofs || !proofs.length) {
    return [];
  }
  return proofs;
}
export async function getProofsByIds(ids: string[]): Promise<Proof[]> {
  const toGet = ids.map((id) => `"${id}"`).join(',');
  const proofs = await db.all<Proof>(`SELECT * FROM proofs WHERE id in (${toGet})`, []);
  if (!proofs || !proofs.length) {
    return [];
  }
  return proofs;
}
export async function getProofsByMintUrl(mintUrl: string): Promise<Proof[]> {
  const mintsIds = (await getMintIdsByUrl(mintUrl)).map((x) => x.id);
  const proofs = await getProofsByIds(mintsIds);
  return proofs;
}
export async function deleteProofs(proofs: Proof[]): Promise<boolean | undefined> {
  if (!proofs || !proofs.length) {
    return;
  }
  const toDel = proofs.map((p) => `"${p.secret}"`).join(',');
  const ids = proofs.map((x) => `"${x.id}"`).join(',');
  const result = await db.run(`DELETE from proofs WHERE id in (${ids}) and secret in (${toDel})`);
  l('[deleteProofs]', result);
  void addUsedProofs(...proofs);
  return result?.changes === proofs.length;
}
```

**File:** src/util/index.ts (L228-259)

```typescript
export function isCashuToken(token: string) {
  if (!token || !isStr(token)) {
    return;
  }
  token = token.trim();
  const idx = token.indexOf('cashuA');
  if (idx !== -1) {
    token = token.slice(idx);
  }
  const uriPrefixes = [
    'https://wallet.nutstash.app/#',
    'https://wallet.cashu.me/?token=',
    'web+cashu://',
    'cashu://',
    'cashu:',
  ];
  uriPrefixes.forEach((prefix) => {
    if (!token.startsWith(prefix)) {
      return;
    }
    token = token.slice(prefix.length).trim();
  });
  if (!token) {
    return;
  }
  try {
    getDecodedToken(token.trim());
  } catch {
    return;
  }
  return token.trim();
}
```

**File:** src/util/index.ts (L286-303)

```typescript
export function isLnInvoice(str: string) {
  if (!str || !isStr(str)) {
    return;
  }
  str = lnTrim(str);
  if (!str) {
    return;
  }
  if (isLnurlOrAddress(str.trim())) {
    return str.trim();
  }
  try {
    decodeInvoice(str.trim());
  } catch {
    return;
  }
  return str.trim();
}
```

**File:** src/util/index.ts (L324-330)

```typescript
export function getLnInvoiceInfo(invoice: string) {
  if (!invoice) {
    return { hash: '', memo: 'Mint new tokens test' };
  }
  const x = decodeLnInvoice(invoice);
  return { ...x, hash: x.paymentHash, memo: x.memo };
}
```

**File:** src/util/index.ts (L332-350)

```typescript
export function decodeLnInvoice(invoice: string) {
  const x = decodeInvoice(invoice);
  const amount = x.amountInMSats;
  const timestamp = x.timestamp;
  const expiry = x.expiry;
  const memo = x.memo;
  const paymentHash = x.paymentHash;
  const timePassed = unixTimestamp() - timestamp;
  const timeLeft = expiry - timePassed;
  return {
    decoded: x,
    amount: amount / 1000,
    timestamp,
    expiry,
    timeLeft,
    memo,
    paymentHash,
  };
}
```

**File:** src/services/SeedService.ts (L6-51)

```typescript
class SeedService {
  private _seed: Uint8Array | null = null;
  createNewMnemonic() {
    const mnemonic = bip39.generateMnemonic(wordlist);
    SecureStore.setItem('mnemonic', mnemonic);
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    this._seed = seed;
    return mnemonic;
  }

  setMnemonic(mnemonic: string) {
    this._seed = bip39.mnemonicToSeedSync(mnemonic);
  }

  getMnemonic() {
    return SecureStore.getItem('mnemonic');
  }

  isMnemonicSet() {
    return SecureStore.getItem('mnemonic') !== null;
  }

  getSeed() {
    if (this._seed) {
      return this._seed;
    }
    const mnemonic = SecureStore.getItem('mnemonic');
    if (!mnemonic) {
      throw new Error('No mnemonic found');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    this._seed = seed;
    return seed;
  }

  async getNostrSk() {
    const mnemonic = await this.getMnemonic();
    if (!mnemonic) {
      throw new Error('No mnemonic found');
    }
    const sk = privateKeyFromSeedWords(mnemonic);
    return sk;
  }
}

export const seedService = new SeedService();
```

# DeepWiki Q&A with Code Context for Repository: cashubtc/coco

## Q1

I want you to find all relevant code for react and getting started with react coco. Look for examples and functions that are available by api. Also tell me all coco libraries in this project that are useful including database ones and how to set those up with react.

### Answer

# React Coco: Complete Guide

## React Integration Package

Coco provides a dedicated React package with hooks and context providers for seamless integration. coco:1-5

### Main Provider Setup

The core React integration uses `CocoCashuProvider` which wraps your app and provides access to the Manager instance: coco:6-18

### Available React Hooks

The React package provides several hooks for common Cashu operations:

1. **useSend Hook** - For sending tokens with loading states and error handling coco:78-86

2. **useReceive Hook** - For receiving tokens with status management coco:81-89

3. **usePaginatedHistory Hook** - For transaction history with pagination support coco:5-12

### Context Providers

The React package includes context providers that automatically update when the underlying state changes:

- **BalanceProvider** - Provides real-time balance updates coco:31-33
- **MintProvider** - Manages mint connections and provides mint management functions coco:38-40
- **ManagerProvider** - Core provider that manages the Manager instance coco:25-42

### Manager Context

Access the core Manager instance through React context: coco:28-36

## Core API Functions

The Manager provides four main APIs accessible through React hooks:

### Manager API Surface coco:127-138

### MintApi Functions coco:140-146

### WalletApi Functions coco:148-153

### QuotesApi Functions coco:155-160

### SubscriptionApi Functions coco:162-165

## Database Libraries

Coco provides three database adapter packages for different environments:

### 1. IndexedDB (Web Browsers)

For React web applications, use the IndexedDB adapter: coco:22-46

### 2. SQLite3 (Node.js)

For Node.js environments: coco:22-46

### 3. Expo SQLite (React Native)

For React Native applications using Expo: coco:22-46

## Getting Started Example

Here's how to set up a React app with Coco:

### 1. Basic Setup with IndexedDB

The web demo shows complete setup: coco:44-47

### 2. Core Manager Setup

Basic Manager initialization pattern: coco:49-82

### 3. React Package Dependencies

The React package requires these peer dependencies: coco:21-24

## Event System

Coco provides a typed event bus for real-time updates: coco:170-184

## Plugin System

Extend functionality with plugins: coco:185-230

## Notes

- ⚠️ This is alpha software with APIs that may change coco:3-3
- The React package uses React 19 as a peer dependency coco:22-23
- All database repositories implement the same interface, making it easy to switch between storage backends coco:113-122
- The architecture is modular and storage-agnostic, allowing you to bring your own persistence layer coco:7-7

### Citations

**File:** packages/react/README.md (L1-5)

```markdown
# React + TypeScript + Vite

> ⚠️ Alpha software: This library is under active development and APIs may change. Use with caution in production and pin versions.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.
```

**File:** packages/react/src/lib/providers/root.tsx (L6-18)

```typescript
export const CocoCashuProvider = ({
  manager,
  children,
}: {
  manager: Manager;
  children: React.ReactNode;
}) => (
  <ManagerProvider manager={manager}>
    <MintProvider>
      <BalanceProvider>{children}</BalanceProvider>
    </MintProvider>
  </ManagerProvider>
);
```

**File:** packages/react/src/lib/hooks/useSend.ts (L78-86)

```typescript
return {
  send,
  reset,
  status,
  data,
  error,
  isSending: status === 'loading',
  isError: status === 'error',
};
```

**File:** packages/react/src/lib/hooks/useReceive.ts (L81-89)

```typescript
  return {
    receive,
    reset,
    status,
    error,
    isReceiving: status === 'loading',
    isError: status === 'error',
  };
};
```

**File:** packages/react/src/lib/hooks/usePaginatedHistory.ts (L5-12)

```typescript
export type UsePaginatedHistoryResult = {
  history: HistoryEntry[];
  loadMore: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  refresh: () => Promise<void>;
  hasMore: boolean;
  isFetching: boolean;
};
```

**File:** packages/react/src/lib/providers/Balance.tsx (L31-33)

```typescript
export const BalanceProvider = ({ children }: { children: React.ReactNode }) => (
  <BalanceCtx.Provider value={useBalance()}>{children}</BalanceCtx.Provider>
);
```

**File:** packages/react/src/lib/providers/MintProvider.tsx (L38-40)

```typescript
export const MintProvider = ({ children }: { children: React.ReactNode }) => (
  <MintCtx.Provider value={useMint()}>{children}</MintCtx.Provider>
);
```

**File:** packages/react/src/lib/providers/Manager.tsx (L25-42)

```typescript
export const ManagerProvider = ({
  manager,
  children,
}: {
  manager: Manager;
  children: React.ReactNode;
}) => {
  const value = useMemo(
    () => ({
      manager,
      ready: true,
      error: null,
      waitUntilReady: () => Promise.resolve(manager),
    }),
    [manager],
  );
  return <ManagerCtx.Provider value={value}>{children}</ManagerCtx.Provider>;
};
```

**File:** packages/react/src/lib/contexts/ManagerContext.ts (L28-36)

```typescript
export const useManager = (): Manager => {
  const { manager } = useManagerContext();
  if (!manager) {
    throw new Error(
      'Manager is not ready. Wrap the component tree with <ManagerGate> or check readiness via useManagerContext().'
    );
  }
  return manager;
};
```

**File:** packages/core/README.md (L49-82)

````markdown
```ts
import { Manager, MemoryRepositories, ConsoleLogger } from 'coco-cashu-core';

// Provide a deterministic 64-byte seed for wallet key derivation
const seedGetter = async () => seed;

const repos = new MemoryRepositories();
const logger = new ConsoleLogger('example', { level: 'info' });
const manager = new Manager(repos, seedGetter, logger);

// Subscribe to events (typed)
const unsubscribe = manager.on('counter:updated', (c) => {
  console.log('counter updated', c);
});

// Register a mint
await manager.mint.addMint('https://nofees.testnut.cashu.space');

// Create a mint quote, pay externally, then redeem
const mintQuote = await manager.quotes.createMintQuote('https://nofees.testnut.cashu.space', 100);

// Optionally, wait via subscription API instead of polling
await manager.subscription.awaitMintQuotePaid(
  'https://nofees.testnut.cashu.space',
  mintQuote.quote
);

// pay mintQuote.request externally, then:
await manager.quotes.redeemMintQuote('https://nofees.testnut.cashu.space', mintQuote.quote);

// Check balances
const balances = await manager.wallet.getBalances();
console.log('balances', balances);
```
````

````

**File:** packages/core/README.md (L113-122)

```markdown
Interfaces in `packages/core/repositories/index.ts`:

- `MintRepository`
- `KeysetRepository`
- `CounterRepository`
- `ProofRepository`
- `MintQuoteRepository`
- `MeltQuoteRepository`

In-memory reference implementations are provided under `repositories/memory/` for testing.
````

**File:** packages/core/README.md (L127-138)

```markdown
- `mint: MintApi`
- `wallet: WalletApi`
- `quotes: QuotesApi`
- `subscription: SubscriptionApi`
- `on/once/off` for `CoreEvents`
- `enableMintQuoteWatcher(options?: { watchExistingPendingOnStart?: boolean }): Promise<void>`
- `disableMintQuoteWatcher(): Promise<void>`
- `enableProofStateWatcher(): Promise<void>`
- `disableProofStateWatcher(): Promise<void>`
- `use(plugin: Plugin): void`
- `dispose(): Promise<void>`
```

**File:** packages/core/README.md (L140-146)

```markdown
### MintApi

- `addMint(mintUrl: string): Promise<{ mint: Mint; keysets: Keyset[] }>`
- `getMintInfo(mintUrl: string): Promise<MintInfo>`
- `isKnownMint(mintUrl: string): Promise<boolean>`
- `getAllMints(): Promise<Mint[]>`
```

**File:** packages/core/README.md (L148-153)

```markdown
- `receive(token: Token | string): Promise<void>`
- `send(mintUrl: string, amount: number): Promise<Token>`
- `getBalances(): Promise<{ [mintUrl: string]: number }>`
- `restore(mintUrl: string): Promise<void>`
```

**File:** packages/core/README.md (L155-160)

```markdown
- `createMintQuote(mintUrl: string, amount: number): Promise<MintQuoteResponse>`
- `redeemMintQuote(mintUrl: string, quoteId: string): Promise<void>`
- `createMeltQuote(mintUrl: string, invoice: string): Promise<MeltQuoteResponse>`
- `payMeltQuote(mintUrl: string, quoteId: string): Promise<void>`
```

**File:** packages/core/README.md (L162-165)

```markdown
- `awaitMintQuotePaid(mintUrl: string, quoteId: string): Promise<MintQuoteResponse>`
- `awaitMeltQuotePaid(mintUrl: string, quoteId: string): Promise<MintQuoteResponse>`
```

**File:** packages/core/README.md (L170-184)

```markdown
## Core events

- `mint:added` → `{ mint, keysets }`
- `mint:updated` → `{ mint, keysets }`
- `counter:updated` → `Counter`
- `proofs:saved` → `{ mintUrl, keysetId, proofs }`
- `proofs:state-changed` → `{ mintUrl, secrets, state }`
- `proofs:deleted` → `{ mintUrl, secrets }`
- `proofs:wiped` → `{ mintUrl, keysetId }`
- `mint-quote:state-changed` → `{ mintUrl, quoteId, state }`
- `mint-quote:created` → `{ mintUrl, quoteId, quote }`
- `mint-quote:redeemed` → `{ mintUrl, quoteId, quote }`
- `melt-quote:created` → `{ mintUrl, quoteId, quote }`
- `melt-quote:paid` → `{ mintUrl, quoteId, quote }`
```

**File:** packages/core/README.md (L185-230)

````markdown
## Plugins

### Overview

- **Purpose**: Extend the core by hooking into lifecycle events with access only to the services you declare.
- **Lifecycle hooks**: `onInit` (after services are created), `onReady` (after APIs are built), `onDispose` (on shutdown).
- **Cleanup**: Hooks must return a cleanup function (sync or async), similar to React’s `useEffect`.

### Types

```ts
import type { Plugin, ServiceKey } from 'coco-cashu-core';

// Service keys you can request:
// 'mintService' | 'walletService' | 'proofService' | 'seedService' | 'walletRestoreService'
// 'counterService' | 'mintQuoteService' | 'meltQuoteService' | 'historyService'
// 'subscriptions' | 'eventBus' | 'logger'

const myPlugin: Plugin<['eventBus', 'logger']> = {
  name: 'my-plugin',
  required: ['eventBus', 'logger'] as const,
  onInit: ({ services: { eventBus, logger } }) => {
    const off = eventBus.on('mint:added', (p) => logger.info('mint added', p));
    return off;
  },
  onReady: async () => {
    // optional
  },
  onDispose: () => {
    // optional
  },
};
```
````

### Using plugins

```ts
// Pass plugins at construction
const manager = new Manager(repos, seedGetter, logger, undefined, [myPlugin]);

// Or register later
manager.use(myPlugin);

// Dispose (runs onDispose and registered cleanups)
await manager.dispose();
```

````

**File:** packages/indexeddb/src/index.ts (L22-46)

```typescript
export class IndexedDbRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly historyRepository: IdbHistoryRepository;
  readonly db: IdbDb;

  constructor(options: IndexedDbRepositoriesOptions) {
    this.db = new IdbDb(options);
    this.mintRepository = new IdbMintRepository(this.db);
    this.counterRepository = new IdbCounterRepository(this.db);
    this.keysetRepository = new IdbKeysetRepository(this.db);
    this.proofRepository = new IdbProofRepository(this.db);
    this.mintQuoteRepository = new IdbMintQuoteRepository(this.db);
    this.meltQuoteRepository = new IdbMeltQuoteRepository(this.db);
    this.historyRepository = new IdbHistoryRepository(this.db);
  }

  async init(): Promise<void> {
    await ensureSchema(this.db);
  }
}
````

**File:** packages/sqlite3/src/index.ts (L22-46)

```typescript
export class SqliteRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly historyRepository: SqliteHistoryRepository;
  readonly db: SqliteDb;

  constructor(options: SqliteRepositoriesOptions) {
    this.db = new SqliteDb(options);
    this.mintRepository = new SqliteMintRepository(this.db);
    this.counterRepository = new SqliteCounterRepository(this.db);
    this.keysetRepository = new SqliteKeysetRepository(this.db);
    this.proofRepository = new SqliteProofRepository(this.db);
    this.mintQuoteRepository = new SqliteMintQuoteRepository(this.db);
    this.meltQuoteRepository = new SqliteMeltQuoteRepository(this.db);
    this.historyRepository = new SqliteHistoryRepository(this.db);
  }

  async init(): Promise<void> {
    await ensureSchema(this.db);
  }
}
```

**File:** packages/expo-sqlite/src/index.ts (L22-46)

```typescript
export class ExpoSqliteRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly historyRepository: ExpoHistoryRepository;
  readonly db: ExpoSqliteDb;

  constructor(options: ExpoSqliteRepositoriesOptions) {
    this.db = new ExpoSqliteDb(options);
    this.mintRepository = new ExpoMintRepository(this.db);
    this.counterRepository = new ExpoCounterRepository(this.db);
    this.keysetRepository = new ExpoKeysetRepository(this.db);
    this.proofRepository = new ExpoProofRepository(this.db);
    this.mintQuoteRepository = new ExpoMintQuoteRepository(this.db);
    this.meltQuoteRepository = new ExpoMeltQuoteRepository(this.db);
    this.historyRepository = new ExpoHistoryRepository(this.db);
  }

  async init(): Promise<void> {
    await ensureSchema(this.db);
  }
}
```

**File:** packages/demo-web/src/main.ts (L44-47)

```typescript
const repo = new IndexedDbRepositories({});
await repo.init();

window.coco = new Manager(repo, async () => seed, new ConsoleLogger(undefined, { level: 'debug' }));
```

**File:** packages/react/package.json (L21-24)

```json
  "peerDependencies": {
    "react": "^19",
    "coco-cashu-core": "workspace:^"
  },
```

**File:** README.md (L7-7)

```markdown
coco-cashu provides a complete foundation for Cashu development with a storage-agnostic core that handles all the complexity: proof management, mint synchronization, quote lifecycle, counter tracking, and state updates through a typed event bus. Choose from ready-to-use storage adapters (SQLite3, IndexedDB, Expo SQLite) or implement your own using the simple repository interface. For React developers, there's a dedicated wrapper with hooks and context providers for seamless integration.
```

## Q2

Read more past the README. I want you to find code for all those things that way we can be use the docs are correct based on the actual code. Also return every single coco package name that I would find on npm.

### Answer

Based on my exploration of the cashubtc/coco repository, here are all the Coco package names that would be found on npm and their code implementation locations:

## NPM Package Names

The following Coco packages are published to npm:

1. **coco-cashu-core** coco:2-2
2. **coco-cashu-react** coco:2-2
3. **coco-cashu-indexeddb** coco:2-2
4. **coco-cashu-sqlite3** coco:2-2
5. **coco-cashu-expo-sqlite** coco:2-2

## Code Implementation Locations

### React Integration

The main React integration entry point is located at: coco:1-3

### React Hooks

- **useSend**: coco:13-89
- **useReceive**: coco:13-90
- **usePaginatedHistory**: coco:14-153

### React Providers and Contexts

- **BalanceProvider**: coco:31-33
- **MintProvider**: coco:38-40
- **ManagerProvider**: coco:25-42
- **ManagerContext**: coco:11-36

### Core APIs

- **Manager API**: coco:24-351
- **MintApi, WalletApi, QuotesApi, SubscriptionApi**: coco:1-5

### Database Adapters

- **IndexedDB**: coco:22-58
- **SQLite3**: coco:22-58
- **Expo SQLite**: coco:22-58

### Event System

The event system is implemented in: coco:18-98

### Plugin System

The plugin system is implemented in: coco:3-97

## Notes

The repository follows a monorepo structure with separate packages for different functionalities. The core package provides the main Manager class and APIs, while specialized packages provide React integration, database adapters, and platform-specific implementations. The demo packages (`demo-cli` and `demo-web`) and documentation package (`docs`) are marked as private and are not published to npm.

### Citations

**File:** packages/core/package.json (L2-2)

```json
  "name": "coco-cashu-core",
```

**File:** packages/react/package.json (L2-2)

```json
  "name": "coco-cashu-react",
```

**File:** packages/indexeddb/package.json (L2-2)

```json
  "name": "coco-cashu-indexeddb",
```

**File:** packages/sqlite3/package.json (L2-2)

```json
  "name": "coco-cashu-sqlite3",
```

**File:** packages/expo-sqlite/package.json (L2-2)

```json
  "name": "coco-cashu-expo-sqlite",
```

**File:** packages/react/src/lib/index.ts (L1-3)

```typescript
export * from './providers';
export * from './contexts';
export * from './hooks';
```

**File:** packages/react/src/lib/hooks/useSend.ts (L13-89)

```typescript
const useSend = () => {
  const manager = useManager();
  const [status, setStatus] = useState<SendStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<SendResult | null>(null);

  const mountedRef = useRef(true);
  const isSendingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const send = useCallback(
    async (mintUrl: string, amount: number, opts: SendOptions = {}) => {
      if (isSendingRef.current) {
        const err = new Error('Send already in progress');
        opts.onError?.(err);
        throw err;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        const err = new Error('Amount must be a positive number');
        opts.onError?.(err);
        throw err;
      }

      isSendingRef.current = true;
      if (mountedRef.current) {
        setStatus('loading');
        setError(null);
      }

      try {
        const token = await manager.wallet.send(mintUrl, amount);
        if (mountedRef.current) {
          setData(token);
          setStatus('success');
        }
        opts.onSuccess?.(token);
        return token;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (mountedRef.current) {
          setError(err);
          setStatus('error');
        }
        opts.onError?.(err);
        throw err;
      } finally {
        isSendingRef.current = false;
        opts.onSettled?.();
      }
    },
    [manager]
  );

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('idle');
    setError(null);
    setData(null);
  }, []);

  return {
    send,
    reset,
    status,
    data,
    error,
    isSending: status === 'loading',
    isError: status === 'error',
  };
};

export default useSend;
```

**File:** packages/react/src/lib/hooks/useReceive.ts (L13-90)

```typescript
const useReceive = () => {
  const manager = useManager();
  const [status, setStatus] = useState<ReceiveStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const isReceivingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const receive = useCallback(
    async (token: ReceiveArg, opts: ReceiveOptions = {}) => {
      if (isReceivingRef.current) {
        const err = new Error('Receive already in progress');
        opts.onError?.(err);
        throw err;
      }
      if (
        typeof token !== 'string' &&
        (!token || !Array.isArray((token as { proofs: unknown[] }).proofs))
      ) {
        const err = new Error('Invalid token');
        if (mountedRef.current) {
          setError(err);
          setStatus('error');
        }
        opts.onError?.(err);
        throw err;
      }

      isReceivingRef.current = true;
      if (mountedRef.current) {
        setStatus('loading');
        setError(null);
      }

      try {
        await manager.wallet.receive(token);
        if (mountedRef.current) {
          setStatus('success');
        }
        opts.onSuccess?.();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (mountedRef.current) {
          setError(err);
          setStatus('error');
        }
        opts.onError?.(err);
        throw err;
      } finally {
        isReceivingRef.current = false;
        opts.onSettled?.();
      }
    },
    [manager]
  );

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('idle');
    setError(null);
  }, []);

  return {
    receive,
    reset,
    status,
    error,
    isReceiving: status === 'loading',
    isError: status === 'error',
  };
};
```

**File:** packages/react/src/lib/hooks/usePaginatedHistory.ts (L14-153)

```typescript
export const usePaginatedHistory = (pageSize = 100): UsePaginatedHistoryResult => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const manager = useManager();

  const startRef = useRef(0);
  const hasMoreRef = useRef(true);
  const modeRef = useRef<'infinite' | 'page'>('infinite');
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  const setFetching = (value: boolean) => {
    isFetchingRef.current = value;
    setIsFetching(value);
  };

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (offset: number): Promise<HistoryEntry[]> => {
      try {
        const page = await manager.history.getPaginatedHistory(offset, pageSize);
        return page || [];
      } catch (error) {
        console.error(error);
        return [];
      }
    },
    [manager, pageSize]
  );

  const refresh = useCallback(async () => {
    if (isFetchingRef.current) return;
    setFetching(true);
    try {
      if (modeRef.current === 'infinite' && startRef.current === 0) {
        const top = await fetchPage(0);
        if (!isMountedRef.current) return;
        setHistory((prev) => {
          const withoutTop = prev.filter((e) => !top.some((t) => t.id === e.id));
          return [...top, ...withoutTop];
        });
      } else {
        const page = await fetchPage(startRef.current);
        if (!isMountedRef.current) return;
        setHistory(page);
      }
    } finally {
      setFetching(false);
    }
  }, [fetchPage]);

  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refreshRef.current();
    };
    manager.on('history:updated', handler);
    return () => {
      manager.off('history:updated', handler);
    };
  }, [manager]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isFetchingRef.current) return;
      setFetching(true);
      modeRef.current = 'infinite';
      startRef.current = 0;
      const page = await fetchPage(0);
      hasMoreRef.current = page.length === pageSize;
      if (!cancelled && isMountedRef.current) setHistory(page);
      setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, pageSize]);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || isFetchingRef.current) return;
    setFetching(true);
    modeRef.current = 'infinite';
    const nextStart = startRef.current + pageSize;
    const page = await fetchPage(nextStart);
    hasMoreRef.current = page.length === pageSize;
    if (isMountedRef.current) {
      setHistory((prev) => {
        const seen = new Set<string>();
        const merged: HistoryEntry[] = [];
        for (const entry of [...prev, ...page]) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          merged.push(entry);
        }
        return merged;
      });
      startRef.current = nextStart;
    }
    setFetching(false);
  }, [fetchPage, pageSize]);

  const goToPage = useCallback(
    async (pageNumber: number) => {
      const offset = pageNumber * pageSize;
      if (isFetchingRef.current) return;
      setFetching(true);
      modeRef.current = 'page';
      const data = await fetchPage(offset);
      hasMoreRef.current = data.length === pageSize;
      if (isMountedRef.current) {
        setHistory(data);
        startRef.current = offset;
      }
      setFetching(false);
    },
    [fetchPage, pageSize]
  );

  return useMemo(
    () => ({
      history,
      loadMore,
      goToPage,
      refresh,
      hasMore: hasMoreRef.current,
      isFetching,
    }),
    [history, loadMore, goToPage, refresh, isFetching]
  );
};
```

**File:** packages/react/src/lib/providers/Balance.tsx (L31-33)

```typescript
export const BalanceProvider = ({ children }: { children: React.ReactNode }) => (
  <BalanceCtx.Provider value={useBalance()}>{children}</BalanceCtx.Provider>
);
```

**File:** packages/react/src/lib/providers/MintProvider.tsx (L38-40)

```typescript
export const MintProvider = ({ children }: { children: React.ReactNode }) => (
  <MintCtx.Provider value={useMint()}>{children}</MintCtx.Provider>
);
```

**File:** packages/react/src/lib/providers/Manager.tsx (L25-42)

```typescript
export const ManagerProvider = ({
  manager,
  children,
}: {
  manager: Manager;
  children: React.ReactNode;
}) => {
  const value = useMemo(
    () => ({
      manager,
      ready: true,
      error: null,
      waitUntilReady: () => Promise.resolve(manager),
    }),
    [manager],
  );
  return <ManagerCtx.Provider value={value}>{children}</ManagerCtx.Provider>;
};
```

**File:** packages/react/src/lib/contexts/ManagerContext.ts (L11-36)

```typescript
export const ManagerCtx = createContext<ManagerContextValue>({
  manager: null,
  ready: false,
  error: null,
  waitUntilReady: () => Promise.reject(new Error('Manager not initialized')),
});

export const useManagerContext = (): ManagerContextValue => {
  const ctx = useContext(ManagerCtx);
  if (!ctx) {
    throw new Error(
      'ManagerProvider is missing. Wrap your app in <CocoCashuProvider> or <ManagerProvider>.'
    );
  }
  return ctx;
};

export const useManager = (): Manager => {
  const { manager } = useManagerContext();
  if (!manager) {
    throw new Error(
      'Manager is not ready. Wrap the component tree with <ManagerGate> or check readiness via useManagerContext().'
    );
  }
  return manager;
};
```

**File:** packages/core/Manager.ts (L24-351)

```typescript
export class Manager {
  readonly mint: MintApi;
  readonly wallet: WalletApi;
  readonly quotes: QuotesApi;
  readonly subscription: SubscriptionApi;
  readonly history: HistoryApi;
  private mintService: MintService;
  private walletService: WalletService;
  private proofService: ProofService;
  private walletRestoreService: WalletRestoreService;
  private eventBus: EventBus<CoreEvents>;
  private logger: Logger;
  readonly subscriptions: SubscriptionManager;
  private mintQuoteService: MintQuoteService;
  private mintQuoteWatcher?: MintQuoteWatcherService;
  private mintQuoteProcessor?: MintQuoteProcessor;
  private mintQuoteRepository: MintQuoteRepository;
  private proofStateWatcher?: ProofStateWatcherService;
  private meltQuoteService: MeltQuoteService;
  private historyService: HistoryService;
  private seedService: SeedService;
  private counterService: CounterService;
  private readonly pluginHost: PluginHost = new PluginHost();
  constructor(
    repositories: Repositories,
    seedGetter: () => Promise<Uint8Array>,
    logger?: Logger,
    webSocketFactory?: WebSocketFactory,
    plugins?: Plugin[]
  ) {
    this.logger = logger ?? new NullLogger();
    this.eventBus = this.createEventBus();
    this.subscriptions = this.createSubscriptionManager(webSocketFactory);
    if (plugins && plugins.length > 0) {
      for (const p of plugins) this.pluginHost.use(p);
    }
    const core = this.buildCoreServices(repositories, seedGetter);
    this.mintService = core.mintService;
    this.walletService = core.walletService;
    this.proofService = core.proofService;
    this.walletRestoreService = core.walletRestoreService;
    this.seedService = core.seedService;
    this.counterService = core.counterService;
    this.mintQuoteService = core.mintQuoteService;
    this.mintQuoteRepository = core.mintQuoteRepository;
    this.meltQuoteService = core.meltQuoteService;
    this.historyService = core.historyService;
    const apis = this.buildApis();
    this.mint = apis.mint;
    this.wallet = apis.wallet;
    this.quotes = apis.quotes;
    this.subscription = apis.subscription;
    this.history = apis.history;

    // Initialize plugins asynchronously to keep constructor sync
    const services: ServiceMap = {
      mintService: this.mintService,
      walletService: this.walletService,
      proofService: this.proofService,
      seedService: this.seedService,
      walletRestoreService: this.walletRestoreService,
      counterService: this.counterService,
      mintQuoteService: this.mintQuoteService,
      meltQuoteService: this.meltQuoteService,
      historyService: this.historyService,
      subscriptions: this.subscriptions,
      eventBus: this.eventBus,
      logger: this.logger,
    };
    void this.pluginHost
      .init(services)
      .then(() => this.pluginHost.ready())
      .catch((err) => {
        this.logger.error('Plugin system initialization failed', err);
      });
  }

  on<E extends keyof CoreEvents>(
    event: E,
    handler: (payload: CoreEvents[E]) => void | Promise<void>
  ): () => void {
    return this.eventBus.on(event, handler);
  }

  once<E extends keyof CoreEvents>(
    event: E,
    handler: (payload: CoreEvents[E]) => void | Promise<void>
  ): () => void {
    return this.eventBus.once(event, handler);
  }

  use(plugin: Plugin): void {
    this.pluginHost.use(plugin);
  }

  async dispose(): Promise<void> {
    await this.pluginHost.dispose();
  }

  off<E extends keyof CoreEvents>(
    event: E,
    handler: (payload: CoreEvents[E]) => void | Promise<void>
  ): void {
    return this.eventBus.off(event, handler);
  }

  async enableMintQuoteWatcher(options?: { watchExistingPendingOnStart?: boolean }): Promise<void> {
    if (this.mintQuoteWatcher?.isRunning()) return;
    const watcherLogger = this.logger.child
      ? this.logger.child({ module: 'MintQuoteWatcherService' })
      : this.logger;
    this.mintQuoteWatcher = new MintQuoteWatcherService(
      this.mintQuoteRepository,
      this.subscriptions,
      this.mintQuoteService,
      this.eventBus,
      watcherLogger,
      { watchExistingPendingOnStart: options?.watchExistingPendingOnStart ?? true }
    );
    await this.mintQuoteWatcher.start();
  }

  async disableMintQuoteWatcher(): Promise<void> {
    if (!this.mintQuoteWatcher) return;
    await this.mintQuoteWatcher.stop();
    this.mintQuoteWatcher = undefined;
  }

  async enableMintQuoteProcessor(options?: {
    processIntervalMs?: number;
    maxRetries?: number;
    baseRetryDelayMs?: number;
    initialEnqueueDelayMs?: number;
  }): Promise<void> {
    if (this.mintQuoteProcessor?.isRunning()) return;
    const processorLogger = this.logger.child
      ? this.logger.child({ module: 'MintQuoteProcessor' })
      : this.logger;
    this.mintQuoteProcessor = new MintQuoteProcessor(
      this.mintQuoteService,
      this.eventBus,
      processorLogger,
      options
    );
    await this.mintQuoteProcessor.start();
  }

  async disableMintQuoteProcessor(): Promise<void> {
    if (!this.mintQuoteProcessor) return;
    await this.mintQuoteProcessor.stop();
    this.mintQuoteProcessor = undefined;
  }

  async waitForMintQuoteProcessor(): Promise<void> {
    if (!this.mintQuoteProcessor) return;
    await this.mintQuoteProcessor.waitForCompletion();
  }

  async enableProofStateWatcher(): Promise<void> {
    if (this.proofStateWatcher?.isRunning()) return;
    const watcherLogger = this.logger.child
      ? this.logger.child({ module: 'ProofStateWatcherService' })
      : this.logger;
    this.proofStateWatcher = new ProofStateWatcherService(
      this.subscriptions,
      this.proofService,
      this.eventBus,
      watcherLogger
    );
    await this.proofStateWatcher.start();
  }

  async disableProofStateWatcher(): Promise<void> {
    if (!this.proofStateWatcher) return;
    await this.proofStateWatcher.stop();
    this.proofStateWatcher = undefined;
  }

  private getChildLogger(moduleName: string): Logger {
    return this.logger.child ? this.logger.child({ module: moduleName }) : this.logger;
  }

  private createEventBus(): EventBus<CoreEvents> {
    const eventLogger = this.getChildLogger('EventBus');
    return new EventBus<CoreEvents>({
      onError: (args) => {
        eventLogger.error('Event handler error', args);
      },
    });
  }

  private createSubscriptionManager(webSocketFactory?: WebSocketFactory): SubscriptionManager {
    const wsLogger = this.getChildLogger('SubscriptionManager');
    // Detect global WebSocket if available, otherwise require injected factory
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasGlobalWs = typeof (globalThis as any).WebSocket !== 'undefined';
    const defaultFactory: WebSocketFactory | undefined = hasGlobalWs
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (url: string) => new (globalThis as any).WebSocket(url)
      : undefined;
    const wsFactoryToUse = webSocketFactory ?? defaultFactory;
    const capabilitiesProvider = {
      getMintInfo: async (mintUrl: string) => {
        if (!this.mintService) throw new Error('MintService not initialized yet');
        return this.mintService.getMintInfo(mintUrl);
      },
    };
    if (!wsFactoryToUse) {
      // Fallback to polling transport when WS is unavailable
      const polling = new PollingTransport({ intervalMs: 5000 }, wsLogger);
      return new SubscriptionManager(polling, wsLogger, capabilitiesProvider);
    }
    return new SubscriptionManager(wsFactoryToUse, wsLogger, capabilitiesProvider);
  }

  private buildCoreServices(
    repositories: Repositories,
    seedGetter: () => Promise<Uint8Array>
  ): {
    mintService: MintService;
    seedService: SeedService;
    walletService: WalletService;
    counterService: CounterService;
    proofService: ProofService;
    walletRestoreService: WalletRestoreService;
    mintQuoteService: MintQuoteService;
    mintQuoteRepository: MintQuoteRepository;
    meltQuoteService: MeltQuoteService;
    historyService: HistoryService;
  } {
    const mintLogger = this.getChildLogger('MintService');
    const walletLogger = this.getChildLogger('WalletService');
    const counterLogger = this.getChildLogger('CounterService');
    const proofLogger = this.getChildLogger('ProofService');
    const mintQuoteLogger = this.getChildLogger('MintQuoteService');
    const walletRestoreLogger = this.getChildLogger('WalletRestoreService');
    const meltQuoteLogger = this.getChildLogger('MeltQuoteService');
    const historyLogger = this.getChildLogger('HistoryService');
    const mintService = new MintService(
      repositories.mintRepository,
      repositories.keysetRepository,
      mintLogger,
      this.eventBus
    );
    const seedService = new SeedService(seedGetter);
    const walletService = new WalletService(mintService, seedService, walletLogger);
    const counterService = new CounterService(
      repositories.counterRepository,
      counterLogger,
      this.eventBus
    );
    const proofService = new ProofService(
      counterService,
      repositories.proofRepository,
      walletService,
      seedService,
      proofLogger,
      this.eventBus
    );
    const walletRestoreService = new WalletRestoreService(
      proofService,
      counterService,
      walletRestoreLogger
    );

    const quotesService = new MintQuoteService(
      repositories.mintQuoteRepository,
      this.subscriptions,
      walletService,
      proofService,
      this.eventBus,
      mintQuoteLogger
    );
    const mintQuoteService = quotesService;
    const mintQuoteRepository = repositories.mintQuoteRepository;

    const meltQuoteService = new MeltQuoteService(
      proofService,
      walletService,
      repositories.meltQuoteRepository,
      this.eventBus,
      meltQuoteLogger
    );

    const historyService = new HistoryService(
      repositories.historyRepository,
      this.eventBus,
      historyLogger
    );

    return {
      mintService,
      seedService,
      walletService,
      counterService,
      proofService,
      walletRestoreService,
      mintQuoteService,
      mintQuoteRepository,
      meltQuoteService,
      historyService,
    };
  }

  private buildApis(): {
    mint: MintApi;
    wallet: WalletApi;
    quotes: QuotesApi;
    subscription: SubscriptionApi;
    history: HistoryApi;
  } {
    const walletApiLogger = this.getChildLogger('WalletApi');
    const subscriptionApiLogger = this.getChildLogger('SubscriptionApi');
    const mint = new MintApi(this.mintService);
    const wallet = new WalletApi(
      this.mintService,
      this.walletService,
      this.proofService,
      this.walletRestoreService,
      this.eventBus,
      walletApiLogger
    );
    const quotes = new QuotesApi(this.mintQuoteService, this.meltQuoteService);
    const subscription = new SubscriptionApi(this.subscriptions, subscriptionApiLogger);
    const history = new HistoryApi(this.historyService);
    return { mint, wallet, quotes, subscription, history };
  }
}
```

**File:** packages/core/api/index.ts (L1-5)

```typescript
export * from './WalletApi.ts';
export * from './QuotesApi.ts';
export * from './MintApi.ts';
export * from './SubscriptionApi.ts';
export * from './HistoryApi.ts';
```

**File:** packages/indexeddb/src/index.ts (L22-58)

```typescript
export class IndexedDbRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly historyRepository: IdbHistoryRepository;
  readonly db: IdbDb;

  constructor(options: IndexedDbRepositoriesOptions) {
    this.db = new IdbDb(options);
    this.mintRepository = new IdbMintRepository(this.db);
    this.counterRepository = new IdbCounterRepository(this.db);
    this.keysetRepository = new IdbKeysetRepository(this.db);
    this.proofRepository = new IdbProofRepository(this.db);
    this.mintQuoteRepository = new IdbMintQuoteRepository(this.db);
    this.meltQuoteRepository = new IdbMeltQuoteRepository(this.db);
    this.historyRepository = new IdbHistoryRepository(this.db);
  }

  async init(): Promise<void> {
    await ensureSchema(this.db);
  }
}

export {
  IdbDb,
  ensureSchema,
  IdbMintRepository,
  IdbKeysetRepository,
  IdbCounterRepository,
  IdbProofRepository,
  IdbMintQuoteRepository,
  IdbMeltQuoteRepository,
  IdbHistoryRepository,
};
```

**File:** packages/sqlite3/src/index.ts (L22-58)

```typescript
export class SqliteRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly historyRepository: SqliteHistoryRepository;
  readonly db: SqliteDb;

  constructor(options: SqliteRepositoriesOptions) {
    this.db = new SqliteDb(options);
    this.mintRepository = new SqliteMintRepository(this.db);
    this.counterRepository = new SqliteCounterRepository(this.db);
    this.keysetRepository = new SqliteKeysetRepository(this.db);
    this.proofRepository = new SqliteProofRepository(this.db);
    this.mintQuoteRepository = new SqliteMintQuoteRepository(this.db);
    this.meltQuoteRepository = new SqliteMeltQuoteRepository(this.db);
    this.historyRepository = new SqliteHistoryRepository(this.db);
  }

  async init(): Promise<void> {
    await ensureSchema(this.db);
  }
}

export {
  SqliteDb,
  ensureSchema,
  SqliteMintRepository,
  SqliteKeysetRepository,
  SqliteCounterRepository,
  SqliteProofRepository,
  SqliteMintQuoteRepository,
  SqliteMeltQuoteRepository,
  SqliteHistoryRepository,
};
```

**File:** packages/expo-sqlite/src/index.ts (L22-58)

```typescript
export class ExpoSqliteRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly historyRepository: ExpoHistoryRepository;
  readonly db: ExpoSqliteDb;

  constructor(options: ExpoSqliteRepositoriesOptions) {
    this.db = new ExpoSqliteDb(options);
    this.mintRepository = new ExpoMintRepository(this.db);
    this.counterRepository = new ExpoCounterRepository(this.db);
    this.keysetRepository = new ExpoKeysetRepository(this.db);
    this.proofRepository = new ExpoProofRepository(this.db);
    this.mintQuoteRepository = new ExpoMintQuoteRepository(this.db);
    this.meltQuoteRepository = new ExpoMeltQuoteRepository(this.db);
    this.historyRepository = new ExpoHistoryRepository(this.db);
  }

  async init(): Promise<void> {
    await ensureSchema(this.db);
  }
}

export {
  ExpoSqliteDb,
  ensureSchema,
  ExpoMintRepository,
  ExpoKeysetRepository,
  ExpoCounterRepository,
  ExpoProofRepository,
  ExpoMintQuoteRepository,
  ExpoMeltQuoteRepository,
  ExpoHistoryRepository,
};
```

**File:** packages/core/events/EventBus.ts (L18-98)

```typescript
export class EventBus<Events extends { [K in keyof Events]: unknown }> {
  private listeners: Map<keyof Events, Set<(payload: unknown) => void | Promise<void>>> = new Map();
  constructor(private readonly options: EventBusOptions<Events> = {}) {}

  on<E extends keyof Events>(event: E, handler: EventHandler<Events[E]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: unknown) => void | Promise<void>);
    return () => this.off(event, handler);
  }

  once<E extends keyof Events>(event: E, handler: EventHandler<Events[E]>): () => void {
    const wrapped: EventHandler<Events[E]> = async (payload) => {
      this.off(event, wrapped);
      await handler(payload);
    };
    return this.on(event, wrapped);
  }

  off<E extends keyof Events>(event: E, handler: EventHandler<Events[E]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as (payload: unknown) => void | Promise<void>);
    if (set.size === 0) this.listeners.delete(event);
  }

  async emit<E extends keyof Events>(
    event: E,
    payload: Events[E],
    options?: EmitOptions
  ): Promise<void> {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    const handlers = Array.from(set) as Array<(payload: Events[E]) => void | Promise<void>>;
    const effectiveThrow = options?.throwOnError ?? this.options.throwOnError ?? false;
    const concurrency = this.options.concurrency ?? 'sequential';

    if (concurrency === 'parallel') {
      const results = await Promise.allSettled(handlers.map((h) => h(payload)));
      const errors: unknown[] = [];
      for (const r of results) {
        if (r.status === 'rejected') {
          errors.push(r.reason);
          if (this.options.onError) await this.options.onError({ event, payload, error: r.reason });
        }
      }
      if (errors.length && effectiveThrow) {
        throw new AggregateError(
          errors,
          `Event "${String(event)}" had ${errors.length} handler error(s)`
        );
      }
      return;
    }

    const collectedErrors: unknown[] = [];
    for (const handler of handlers) {
      try {
        await handler(payload);
      } catch (error) {
        if (this.options.onError) await this.options.onError({ event, payload, error });
        if (effectiveThrow && options?.failFast) {
          throw error;
        }
        if (effectiveThrow) {
          collectedErrors.push(error);
        }
      }
    }
    if (collectedErrors.length && effectiveThrow) {
      throw new AggregateError(
        collectedErrors,
        `Event "${String(event)}" had ${collectedErrors.length} handler error(s)`
      );
    }
  }
}
```

**File:** packages/core/plugins/PluginHost.ts (L3-97)

```typescript
export class PluginHost {
  private readonly plugins: Plugin[] = [];
  private readonly cleanups: Array<() => void | Promise<void>> = [];
  private services?: ServiceMap;
  private initialized = false;
  private readyPhase = false;

  use(plugin: Plugin): void {
    this.plugins.push(plugin);
    if (this.initialized && this.services) {
      void this.runInit(plugin, this.services);
      if (this.readyPhase) void this.runReady(plugin, this.services);
    }
  }

  async init(services: ServiceMap): Promise<void> {
    this.services = services;
    this.initialized = true;
    for (const p of this.plugins) {
      await this.runInit(p, services);
    }
  }

  async ready(): Promise<void> {
    if (!this.services) return;
    this.readyPhase = true;
    for (const p of this.plugins) {
      await this.runReady(p, this.services);
    }
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const p of this.plugins) {
      try {
        await p.onDispose?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Plugin dispose error', { plugin: p.name, err });
        errors.push(err);
      }
    }
    while (this.cleanups.length) {
      const fn = this.cleanups.pop()!;
      try {
        await fn();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('One or more plugin dispose/cleanup handlers failed');
    }
  }

  private async runInit(plugin: Plugin, services: ServiceMap): Promise<void> {
    const ctx = this.createContext(plugin, services);
    try {
      const cleanup = await plugin.onInit?.(ctx as any);
      if (typeof cleanup === 'function') this.cleanups.push(cleanup);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Plugin init error', { plugin: plugin.name, err });
    }
  }

  private async runReady(plugin: Plugin, services: ServiceMap): Promise<void> {
    const ctx = this.createContext(plugin, services);
    try {
      const cleanup = await plugin.onReady?.(ctx as any);
      if (typeof cleanup === 'function') this.cleanups.push(cleanup);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Plugin ready error', { plugin: plugin.name, err });
    }
  }

  private createContext(
    plugin: Plugin,
    services: ServiceMap
  ): {
    services: Partial<ServiceMap>;
  } {
    const required = (plugin.required ?? []) as readonly ServiceKey[];
    const selected: Partial<ServiceMap> = {};
    for (const k of required) {
      // @ts-expect-error - dynamic key selection
      selected[k] = services[k];
    }
    return {
      services: selected,
    };
  }
}
```

## Q3

I want to migrate from using redux custom cashu implementation which is found in my redux (for storing proofs, transactions, and proofs) and also in cashuClient which includes all the utility functions. I think it would be super good if we could remove all cashuClient code in favour of using coco. This might require refactoring where this code is used, and we will need to make sure we migrate my code from redux to whatever coco uses to persist data. That might still be in redux but we’d need to use `saveProofs` and `setCounter` I think to define the users current proofs that way we can migrate all users to the new library.

```
├── helper/cashuClient.ts (1562 lines, 36 functions)
│   ├── getWallet() [lines 142-214]
│   │   ├── params: (undefined: GetWalletParams)
│   │   └── returns: Promise
│   ├── getMint() [lines 216-253]
│   │   ├── params: (undefined: GetMintParams)
│   │   └── returns: Promise
│   ├── getMeltQuote() [lines 256-292]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── sendLightning() [lines 294-499]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── attemptSend() [lines 331-483]
│   │   ├── params: (forceRefresh: any = ..., updateCounter: any = ...)
│   │   └── returns: Promise
│   ├── receiveLightning() [lines 501-567]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── checkLightningReceiveStatus() [lines 569-661]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── sendEcash() [lines 663-816]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── attemptSend() [lines 683-801]
│   │   ├── params: (forceRefresh: any = ..., updateCounter: any = ...)
│   │   └── returns: Promise
│   ├── receiveEcash() [lines 818-965]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── getPubkeyFromToken() [lines 838-846]
│   │   ├── params: (token: string)
│   │   └── returns: void
│   ├── attemptReceive() [lines 860-952]
│   │   ├── params: (forceRefresh: any = ...)
│   │   └── returns: Promise
│   ├── getPaymentRequest() [lines 967-1000]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── cancelEcashTransaction() [lines 1002-1031]
│   │   ├── params: (transaction: Transaction, navigation: any)
│   │   └── returns: Promise
│   ├── getUsedProofs() [lines 1033-1050]
│   │   ├── params: (currentProofs: any, keepProofs: any)
│   │   └── returns: void
│   ├── useWallet() [lines 1052-1121]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── fetchWallet() [lines 1060-1080]
│   │   ├── params: ()
│   │   └── returns: void
│   ├── refetch() [lines 1093-1113]
│   │   ├── params: ()
│   │   └── returns: void
│   ├── checkTokenSpent() [lines 1126-1142]
│   │   ├── params: (undefined: any)
│   │   ├── returns: void
│   │   └── desc: "Checks if a token has been spent"
│   ├── isValidEcashToken() [lines 1182-1184]
│   │   ├── params: (token: string)
│   │   ├── returns: boolean
│   │   └── desc: "Validates if a string is a valid ecash token"
│   ├── isValidPaymentRequest() [lines 1189-1191]
│   │   ├── params: (paymentRequest: string)
│   │   ├── returns: boolean
│   │   └── desc: "Validates if a string is a valid payment request"
│   ├── getLightningAmount() [lines 1194-1199]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getTimestamp() [lines 1201-1205]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getRawExpiry() [lines 1207-1213]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getExpiry() [lines 1215-1217]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getExpiresIn() [lines 1219-1222]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── getDescription() [lines 1224-1227]
│   │   ├── params: (undefined: any)
│   │   └── returns: void
│   ├── npubToPublicKey() [lines 1229-1238]
│   │   ├── params: (key: string)
│   │   └── returns: void
│   ├── maybeConvertNpub() [lines 1240-1249]
│   │   ├── params: (key: string)
│   │   └── returns: void
│   ├── pubKeyTo02() [lines 1251-1253]
│   │   ├── params: (key: string)
│   │   └── returns: void
│   ├── restoreMint() [lines 1258-1430]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: void
│   ├── restoreCounter() [lines 1432-1475]
│   │   ├── params: (undefined: unknown)
│   │   └── returns: Promise
│   ├── checkIfAlreadyRedeemed() [lines 1477-1488]
│   │   ├── params: (token: string)
│   │   └── returns: boolean
│   ├── deriveMintBackupKeys() [lines 1502-1520]
│   │   ├── params: (mnemonic: string)
│   │   └── returns: unknown
│   ├── keysetIdToBigInt() [lines 1522-1530]
│   │   ├── params: (id: string)
│   │   └── returns: unknown
│   └── isCollidingKeysetId() [lines 1532-1561]
│       ├── params: (newKeysetIdHex: string, storedKeysetIds: string[])
│       └── returns: void
```

---

This is what I want to do, what I want you to do is create a document to help me migrate to coco. I've helpfully provided a bunch of functions I have already which will need alternatives. I understand coco uses rich hooks which can provide access to a lot of this utilities but might not have a direct comparable function.

### Answer

Based on my analysis of the `cashubtc/coco` repository, here's how the functions correspond between `coco-cashu-core` and `coco-cashu-react`:

## Core API Structure

The main entry point is the `Manager` class which orchestrates all wallet functionality through dedicated APIs: coco:24-29

## Wallet Functions

**`getWallet`**: Handled by the `WalletService` through the Manager's wallet service: coco:269-269

**`sendEcash`**: Corresponds to `manager.wallet.send()` in the WalletApi: coco:96-125

**`receiveEcash`**: Corresponds to `manager.wallet.receive()` in the WalletApi: coco:39-94

## Lightning Functions

**`getMeltQuote`**: Handled by `quotes.createMeltQuote()` in the QuotesApi: coco:20-22

**`sendLightning`**: Corresponds to `quotes.payMeltQuote()` for paying Lightning invoices: coco:24-26

**`receiveLightning`**: Handled through `quotes.createMintQuote()` and `quotes.redeemMintQuote()` for receiving Lightning payments: coco:12-18

## Mint Functions

**`getMint`**: Handled by the MintService accessible through the Manager: coco:25-25

## Data Persistence

**Proofs Management**: The `ProofService` handles saving proofs and setting proof states with methods like `saveProofs()` and `setProofState()`: coco:87-135

**Counters Management**: The `CounterService` handles counter operations for deterministic key derivation: coco:274-274

**Repository Interfaces**: Data persistence is abstracted through repository interfaces for proofs, counters, mints, and quotes: coco:32-40

## Restoration Functions

**`restoreMint`** and **`restoreCounter`**: Handled by the `WalletRestoreService` which performs keyset restoration: coco:28-116

## React Integration

**`sendEcash`**: Exposed through the `useSend` hook which wraps `manager.wallet.send()`: coco:48-48

**`receiveEcash`**: Exposed through the `useReceive` hook which wraps `manager.wallet.receive()`: coco:54-54

## Notes

The coco-cashu architecture uses a layered approach where the Manager orchestrates various services (MintService, WalletService, ProofService, etc.) and exposes them through dedicated APIs (WalletApi, QuotesApi, etc.). The React package provides hooks that wrap these core functionalities for use in React applications. Many of the specific utility functions you mentioned (like `isValidEcashToken`, `getLightningAmount`, etc.) are not directly visible in the main API files but would be part of the underlying utility modules used by these services. Data persistence is handled through repository pattern with different implementations for various storage backends (IndexedDB, SQLite, etc.).

### Citations

**File:** packages/core/Manager.ts (L24-29)

```typescript
export class Manager {
  readonly mint: MintApi;
  readonly wallet: WalletApi;
  readonly quotes: QuotesApi;
  readonly subscription: SubscriptionApi;
  readonly history: HistoryApi;
```

**File:** packages/core/Manager.ts (L269-269)

```typescript
const walletService = new WalletService(mintService, seedService, walletLogger);
```

**File:** packages/core/Manager.ts (L274-274)

```typescript
    );
```

**File:** packages/core/api/WalletApi.ts (L39-94)

```typescript
  async receive(token: Token | string) {
    let decoded: Token;
    try {
      decoded = typeof token === 'string' ? getDecodedToken(token) : token;
    } catch (err) {
      this.logger?.warn('Failed to decode token for receive', { err });
      throw new ProofValidationError('Invalid token');
    }

    const { mint, proofs } = decoded;

    const known = await this.mintService.isKnownMint(mint);
    if (!known) {
      throw new UnknownMintError(`Mint ${mint} is not known`);
    }

    if (!Array.isArray(proofs) || proofs.length === 0) {
      this.logger?.warn('Token contains no proofs', { mint });
      throw new ProofValidationError('Token contains no proofs');
    }

    const receiveAmount = proofs.reduce((acc, proof) => acc + proof.amount, 0);
    if (!Number.isFinite(receiveAmount) || receiveAmount <= 0) {
      this.logger?.warn('Token has invalid or non-positive amount', { mint, receiveAmount });
      throw new ProofValidationError('Token amount must be a positive integer');
    }

    this.logger?.info('Receiving token', { mint, proofs: proofs.length, amount: receiveAmount });

    try {
      const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mint);
      const { keep: outputData } = await this.proofService.createOutputsAndIncrementCounters(mint, {
        keep: receiveAmount,
        send: 0,
      });

      if (!outputData || outputData.length === 0) {
        this.logger?.error('Failed to create deterministic outputs for receive', {
          mint,
          amount: receiveAmount,
        });
        throw new Error('Failed to create outputs for receive');
      }

      const newProofs = await wallet.receive({ mint, proofs }, { outputData });
      await this.proofService.saveProofs(mint, mapProofToCoreProof(mint, 'ready', newProofs));
      await this.eventBus.emit('receive:created', { mintUrl: mint, token: decoded });
      this.logger?.debug('Token received and proofs saved', {
        mint,
        newProofs: newProofs.length,
      });
    } catch (err) {
      this.logger?.error('Failed to receive token', { mint, err });
      throw err;
    }
  }
```

**File:** packages/core/api/WalletApi.ts (L96-125)

```typescript
  async send(mintUrl: string, amount: number): Promise<Token> {
    const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl);
    const selectedProofs = await this.proofService.selectProofsToSend(mintUrl, amount);
    const selectedAmount = selectedProofs.reduce((acc, proof) => acc + proof.amount, 0);
    const outputData = await this.proofService.createOutputsAndIncrementCounters(mintUrl, {
      keep: selectedAmount - amount,
      send: amount,
    });
    const { send, keep } = await wallet.send(amount, selectedProofs, { outputData });
    await this.proofService.saveProofs(
      mintUrl,
      mapProofToCoreProof(mintUrl, 'ready', [...keep, ...send]),
    );
    await this.proofService.setProofState(
      mintUrl,
      selectedProofs.map((proof) => proof.secret),
      'spent',
    );
    await this.proofService.setProofState(
      mintUrl,
      send.map((proof) => proof.secret),
      'inflight',
    );
    const token = {
      mint: mintUrl,
      proofs: send,
    };
    await this.eventBus.emit('send:created', { mintUrl, token });
    return token;
  }
```

**File:** packages/core/api/QuotesApi.ts (L12-18)

```typescript
  async createMintQuote(mintUrl: string, amount: number): Promise<MintQuoteResponse> {
    return this.mintQuoteService.createMintQuote(mintUrl, amount);
  }

  async redeemMintQuote(mintUrl: string, quoteId: string): Promise<void> {
    return this.mintQuoteService.redeemMintQuote(mintUrl, quoteId);
  }
```

**File:** packages/core/api/QuotesApi.ts (L20-22)

```typescript
  async createMeltQuote(mintUrl: string, invoice: string): Promise<MeltQuoteResponse> {
    return this.meltQuoteService.createMeltQuote(mintUrl, invoice);
  }
```

**File:** packages/core/api/QuotesApi.ts (L24-26)

```typescript
  async payMeltQuote(mintUrl: string, quoteId: string): Promise<void> {
    return this.meltQuoteService.payMeltQuote(mintUrl, quoteId);
  }
```

**File:** packages/core/services/ProofService.ts (L87-135)

```typescript
  async saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError('mintUrl is required');
    }
    if (!Array.isArray(proofs) || proofs.length === 0) return;

    const groupedByKeyset = this.groupProofsByKeysetId(proofs);

    const entries = Array.from(groupedByKeyset.entries());
    const tasks = entries.map(([keysetId, group]) =>
      (async () => {
        await this.proofRepository.saveProofs(mintUrl, group);
        await this.eventBus?.emit('proofs:saved', {
          mintUrl,
          keysetId,
          proofs: group,
        });
        this.logger?.info('Proofs saved', { mintUrl, keysetId, count: group.length });
      })().catch((error) => {
        // Enrich the rejection with keyset context so we can log precise details later
        throw { keysetId, error };
      }),
    );
    const results = await Promise.allSettled(tasks);

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length > 0) {
      // Log each failure with its original error for maximum visibility
      for (const fr of failed) {
        const { keysetId, error } = fr.reason as { keysetId?: string; error?: unknown };
        this.logger?.error('Failed to persist proofs for keyset', { mintUrl, keysetId, error });
      }
      const details = failed.map((fr) => fr.reason as { keysetId?: string; error?: unknown });
      const failedKeysets = details
        .map((d) => d.keysetId)
        .filter((id): id is string => Boolean(id));
      const aggregate = new AggregateError(
        details.map((d) => (d?.error instanceof Error ? d.error : new Error(String(d?.error)))),
        `Failed to persist proofs for ${failed.length} keyset group(s)`,
      );
      const message =
        failedKeysets.length > 0
          ? `Failed to persist proofs for ${failed.length} keyset group(s) [${failedKeysets.join(
              ', ',
            )}]`
          : `Failed to persist proofs for ${failed.length} keyset group(s)`;
      throw new ProofOperationError(mintUrl, message, undefined, aggregate);
    }
  }
```

**File:** packages/core/repositories/index.ts (L32-40)

```typescript
export interface ProofRepository {
  saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void>;
  getReadyProofs(mintUrl: string): Promise<CoreProof[]>;
  getAllReadyProofs(): Promise<CoreProof[]>;
  setProofState(mintUrl: string, secrets: string[], state: ProofState): Promise<void>;
  deleteProofs(mintUrl: string, secrets: string[]): Promise<void>;
  getProofsByKeysetId(mintUrl: string, keysetId: string): Promise<CoreProof[]>;
  wipeProofsByKeysetId(mintUrl: string, keysetId: string): Promise<void>;
}
```

**File:** packages/core/services/WalletRestoreService.ts (L28-116)

```typescript
  async restoreKeyset(mintUrl: string, wallet: CashuWallet, keysetId: string): Promise<void> {
    this.logger?.debug('Restoring keyset', { mintUrl, keysetId });
    const oldProofs = await this.proofService.getProofsByKeysetId(mintUrl, keysetId);
    this.logger?.debug('Existing proofs before restore', {
      mintUrl,
      keysetId,
      count: oldProofs.length,
    });

    const { proofs, lastCounterWithSignature } = await wallet.batchRestore(
      this.restoreBatchSize,
      this.restoreGapLimit,
      this.restoreStartCounter,
      keysetId,
    );

    if (proofs.length === 0) {
      this.logger?.warn('No proofs to restore', { mintUrl, keysetId });
      return;
    }

    this.logger?.info('Batch restore result', {
      mintUrl,
      keysetId,
      restored: proofs.length,
      lastCounterWithSignature,
    });

    // Hard requirement: restored proofs must be >= previously stored proofs
    if (oldProofs.length > proofs.length) {
      this.logger?.warn('Restored fewer proofs than previously stored', {
        mintUrl,
        keysetId,
        previous: oldProofs.length,
        restored: proofs.length,
      });
      throw new Error('Restored less proofs than expected.');
    }

    const states = await wallet.checkProofsStates(proofs);
    if (!Array.isArray(states) || states.length !== proofs.length) {
      this.logger?.error('Malformed state check', {
        mintUrl,
        keysetId,
        statesLength: (states as unknown as { length?: number })?.length,
        proofsLength: proofs.length,
      });
      throw new Error('Malformed state check');
    }

    const checkedProofs: { spent: Proof[]; ready: Proof[] } = { spent: [], ready: [] };
    for (const [index, state] of states.entries()) {
      if (!proofs[index]) {
        this.logger?.error('Proof not found', { mintUrl, keysetId, index });
        throw new Error('Proof not found');
      }
      if (state.state === 'SPENT') {
        checkedProofs.spent.push(proofs[index]);
      } else {
        checkedProofs.ready.push(proofs[index]);
      }
    }

    this.logger?.debug('Checked proof states', {
      mintUrl,
      keysetId,
      ready: checkedProofs.ready.length,
      spent: checkedProofs.spent.length,
    });

    const newCounter = lastCounterWithSignature ? lastCounterWithSignature + 1 : 0;

    await this.counterService.overwriteCounter(mintUrl, keysetId, newCounter);
    this.logger?.debug('Requested counter overwrite for keyset', {
      mintUrl,
      keysetId,
      counter: newCounter,
    });

    await this.proofService.saveProofs(
      mintUrl,
      mapProofToCoreProof(mintUrl, 'ready', checkedProofs.ready),
    );
    this.logger?.info('Saved restored proofs for keyset', {
      mintUrl,
      keysetId,
      total: checkedProofs.ready.length + checkedProofs.spent.length,
    });
  }
```

**File:** packages/react/src/lib/hooks/useSend.ts (L48-48)

```typescript
const token = await manager.wallet.send(mintUrl, amount);
```

**File:** packages/react/src/lib/hooks/useReceive.ts (L54-54)

```typescript
await manager.wallet.receive(token);
```

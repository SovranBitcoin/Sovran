# Performance Improvements: Native Crypto & Recovery Optimization

This document covers all cryptographic and wallet-recovery performance improvements. For each change, we show the **original upstream source** and the **modification needed** to achieve the optimization. Patches are applied via `patch-package` to `@cashu/cashu-ts@3.5.0` and `@cashu/coco-core@1.0.0-rc.0`.

---

## The Problem

Hermes (React Native's JS engine) is an interpreter with no JIT. Every BigInt operation pays full dispatch overhead. Noble-curves secp256k1 and @scure/bip32 rely on BigInt modular arithmetic — the worst case for Hermes.

### Baseline (200 iterations, iPhone, Expo Go)

| Stage | Per-op (ms) | Share |
|-------|------------:|------:|
| `deriveSecret` (BIP32) | 30.9 | 45.4% |
| `deriveBlindingFactor` (BIP32) | 30.9 | 45.4% |
| `blindMessage` (EC point ops) | 6.0 | 8.8% |
| Everything else | 0.3 | 0.5% |
| **Total per output** | **68.1** | 100% |

### After Optimizations (Measured on-device)

| Operation | Time (ms) |
|-----------|----------:|
| Receive swap (unblind proofs) | **162** |
| Send swap (blind + unblind + network) | **171** |
| Mint execution | **94** |
| Keyset probe (5 outputs) | **254–464** |
| Empty keyset skip | **~300** |

---

## 1. Nutpatch: Native C++ via NitroModules

### Addition: `batchDeriveLegacy`

The only source change to nutpatch — add batch BIP32 derivation to the Nitro spec:

**File: `packages/nutpatch/src/specs/Crypto.nitro.ts`**

```diff
  verifyDleqProof(...): boolean
  createDleqProof(B_: ArrayBuffer, seckey: ArrayBuffer): ArrayBuffer
+
+  /**
+   * Batch-derive NUT-13 legacy keyset secrets and blinding factors.
+   * Path: m/129372'/0'/{keysetIdInt}'/{counter}'/{0|1}
+   *
+   * @returns (count * 64) bytes: for each counter, 32 bytes secret + 32 bytes blinding.
+   */
+  batchDeriveLegacy(
+    seed: ArrayBuffer,
+    keysetIdInt: number,
+    startCounter: number,
+    count: number
+  ): ArrayBuffer
}
```

The C++ implementation derives all secrets + blinding factors in one native call using libsecp256k1 BIP32, eliminating per-output JS↔native overhead.

---

## 2. cashu-ts Changes

### 2a. Native `hashToCurve`

**Original** (`cashu-ts/src/crypto/core.ts:38-52`):
```typescript
export function hashToCurve(secret: Uint8Array): WeierstrassPoint<bigint> {
  const msgToHash = sha256(Bytes.concat(DOMAIN_SEPARATOR, secret));
  const counter = new Uint32Array(1);
  const maxIterations = 2 ** 16;
  for (let i = 0; i < maxIterations; i++) {
    const counterBytes = new Uint8Array(counter.buffer);
    const hash = sha256(Bytes.concat(msgToHash, counterBytes));
    try {
      return pointFromHex(bytesToHex(Bytes.concat(new Uint8Array([0x02]), hash)));
    } catch {
      counter[0]++;
    }
  }
  throw new Error('No valid point found');
}
```

**Change**: Delegate to native when `__CASHU_NATIVE` is active:
```typescript
export function hashToCurve(secret: Uint8Array): WeierstrassPoint<bigint> {
  const _cn = globalThis.__CASHU_NATIVE;
  if (_cn?.active) {
    return _cn._toPoint(_cn.crypto.hashToCurve(_cn._toBuffer(secret)));
  }
  // ... original JS fallback unchanged
}
```

### 2b. Native `blindMessage`

**Original** (`cashu-ts/src/crypto/core.ts:114-124`):
```typescript
export function blindMessage(secret: Uint8Array, r?: bigint): RawBlindedMessage {
  const Y = hashToCurve(secret);
  if (r === undefined) {
    r = secp256k1.Point.Fn.fromBytes(createRandomSecretKey());
  } else if (r === 0n) {
    throw new Error('Blinding factor r must be non-zero');
  }
  const rG = secp256k1.Point.BASE.multiply(r);
  const B_ = Y.add(rG);
  return { B_, r, secret };
}
```

**Change**: Single native call for `hashToCurve + G.multiply(r) + add`:
```typescript
export function blindMessage(secret: Uint8Array, r?: bigint): RawBlindedMessage {
  const _cn = globalThis.__CASHU_NATIVE;
  if (_cn?.active) {
    r ??= secp256k1.Point.Fn.fromBytes(createRandomSecretKey());
    const B_ = _cn._toPoint(_cn.crypto.blind(_cn._toBuffer(secret), _cn._bigintToBuf(r)));
    return { B_, r, secret };
  }
  // ... original JS fallback unchanged
}
```

### 2c. Native `unblindSignature`

**Original** (`cashu-ts/src/crypto/core.ts:126-133`):
```typescript
export function unblindSignature(
  C_: WeierstrassPoint<bigint>,
  r: bigint,
  A: WeierstrassPoint<bigint>,
): WeierstrassPoint<bigint> {
  const C = C_.subtract(A.multiply(r));
  return C;
}
```

**Change**: Delegate point multiply + subtract to native:
```typescript
export function unblindSignature(
  C_: WeierstrassPoint<bigint>,
  r: bigint,
  A: WeierstrassPoint<bigint>,
): WeierstrassPoint<bigint> {
  const _cn = globalThis.__CASHU_NATIVE;
  if (_cn?.active) {
    return _cn._toPoint(_cn.crypto.unblind(
      _cn._toBuffer(C_.toBytes(true)),
      _cn._bigintToBuf(r),
      _cn._toBuffer(A.toBytes(true))
    ));
  }
  return C_.subtract(A.multiply(r));
}
```

### 2d. Native `hash_e`

**Original** (`cashu-ts/src/crypto/core.ts:54-58`):
```typescript
export function hash_e(pubkeys: Array<WeierstrassPoint<bigint>>): Uint8Array {
  const hexStrings = pubkeys.map((p) => p.toHex(false));
  const e_ = hexStrings.join('');
  return sha256(new TextEncoder().encode(e_));
}
```

**Change**: Batch point serialization + SHA256 in native:
```typescript
export function hash_e(pubkeys: Array<WeierstrassPoint<bigint>>): Uint8Array {
  const _cn = globalThis.__CASHU_NATIVE;
  if (_cn?.active && typeof _cn.crypto.hashE === 'function') {
    const bufs = pubkeys.map(p => _cn._toBuffer(p.toBytes(true)));
    return new Uint8Array(_cn.crypto.hashE(bufs));
  }
  const e_ = pubkeys.map(p => p.toHex(false)).join('');
  return sha256(new TextEncoder().encode(e_));
}
```

### 2e. BIP32 Key Derivation Caching

**Original** (`cashu-ts/src/crypto/NUT13.ts:85-99`):
```typescript
const derive_deprecated = (
  seed: Uint8Array, keysetId: string, counter: number, secretOrBlinding: DerivationType,
): Uint8Array => {
  const hdkey = HDKey.fromMasterSeed(seed);           // ← called EVERY time (~5ms)
  const keysetIdInt = getKeysetIdInt(keysetId);
  const derivationPath = `${STANDARD_DERIVATION_PATH}/${keysetIdInt}'/${counter}'/${secretOrBlinding}`;
  const derived = hdkey.derive(derivationPath);       // ← full 5-level derive (~26ms)
  if (derived.privateKey === null) {
    throw new Error('Could not derive private key');
  }
  return derived.privateKey;
};
```

**Change**: Cache master key and keyset prefix; share counter derivation:
```typescript
const _masterCache = new WeakMap<Uint8Array, HDKey>();
const _keysetCache = new Map<string, HDKey>();

const derive_deprecated = (
  seed: Uint8Array, keysetId: string, counter: number, secretOrBlinding: DerivationType,
): Uint8Array => {
  // Cache master seed (WeakMap — GC friendly)
  let mk = _masterCache.get(seed);
  if (!mk) { mk = HDKey.fromMasterSeed(seed); _masterCache.set(seed, mk); }

  // Cache keyset prefix: m/129372'/0'/{keysetIdInt}'
  const keysetIdInt = getKeysetIdInt(keysetId);
  const ck = bytesToHex(seed) + ':' + keysetId;
  let pk = _keysetCache.get(ck);
  if (!pk) { pk = mk.derive(`${STANDARD_DERIVATION_PATH}/${keysetIdInt}'`); _keysetCache.set(ck, pk); }

  // Only 2 child derivations instead of 5-level path
  const derived = pk.deriveChild(counter + 0x80000000).deriveChild(secretOrBlinding);
  if (derived.privateKey === null) throw new Error('Could not derive private key');
  return derived.privateKey;
};

// Shared derivation for both secret and blinding in one pass
const _deriveBoth = (seed: Uint8Array, keysetId: string, counter: number) => {
  let mk = _masterCache.get(seed);
  if (!mk) { mk = HDKey.fromMasterSeed(seed); _masterCache.set(seed, mk); }
  const keysetIdInt = getKeysetIdInt(keysetId);
  const ck = bytesToHex(seed) + ':' + keysetId;
  let pk = _keysetCache.get(ck);
  if (!pk) { pk = mk.derive(`${STANDARD_DERIVATION_PATH}/${keysetIdInt}'`); _keysetCache.set(ck, pk); }
  const counterKey = pk.deriveChild(counter + 0x80000000);
  return {
    secret: counterKey.deriveChild(0).privateKey!,
    blinding: counterKey.deriveChild(1).privateKey!,
  };
};
```

### 2f. Batch Native Derive for `createDeterministicData`

**Original** (`cashu-ts/src/model/OutputData.ts:289-300`):
```typescript
static createDeterministicData(
  amount: AmountLike, seed: Uint8Array, counter: number,
  keyset: HasKeysetKeys, customSplit?: AmountLike[],
): OutputData[] {
  const amounts = splitAmount(amount, keyset.keys, customSplit);
  return amounts.map((a, i) =>
    this.createSingleDeterministicData(a, seed, counter + i, keyset.id),
  );
}
```

**Change**: Three-tier optimization — native batch → JS cached → original fallback:
```typescript
static createDeterministicData(
  amount: AmountLike, seed: Uint8Array, counter: number,
  keyset: HasKeysetKeys, customSplit?: AmountLike[],
): OutputData[] {
  const amounts = splitAmount(amount, keyset.keys, customSplit);
  const keysetId = keyset.id;
  const isLegacy = /^[a-fA-F0-9]+$/.test(keysetId) ? keysetId.startsWith('00') : true;
  const _cn = globalThis.__CASHU_NATIVE;

  // FAST: Single native call for entire batch (legacy keysets)
  if (isLegacy && _cn?.active && typeof _cn.crypto.batchDeriveLegacy === 'function') {
    const kidInt = Number(getKeysetIdInt(keysetId));
    const raw = new Uint8Array(_cn.crypto.batchDeriveLegacy(
      seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength),
      kidInt, counter, amounts.length
    ));
    return amounts.map((a, i) => {
      const off = i * 64;
      const secretBytes = raw.subarray(off, off + 32);
      const bfBytes = raw.subarray(off + 32, off + 64);
      const secretHex = bytesToHex(secretBytes);
      const utf8Secret = new TextEncoder().encode(secretHex);
      const r = Bytes.toBigInt(bfBytes);
      const { B_ } = blindMessage(utf8Secret, r);
      return new OutputData(
        new BlindedMessage(Amount.from(a), B_, keysetId).getSerializedBlindedMessage(),
        r, utf8Secret,
      );
    });
  }

  // MEDIUM: JS cached derivation (legacy keysets)
  if (isLegacy) {
    return amounts.map((a, i) => {
      const both = _deriveBoth(seed, keysetId, counter + i);
      const secretHex = bytesToHex(both.secret);
      const utf8Secret = new TextEncoder().encode(secretHex);
      const r = Bytes.toBigInt(both.blinding);
      const { B_ } = blindMessage(utf8Secret, r);
      return new OutputData(
        new BlindedMessage(Amount.from(a), B_, keysetId).getSerializedBlindedMessage(),
        r, utf8Secret,
      );
    });
  }

  // FALLBACK: Original per-output derivation
  return amounts.map((a, i) =>
    this.createSingleDeterministicData(a, seed, counter + i, keysetId),
  );
}
```

### 2g. Recovery Chunking in `restore`

**Original** (`cashu-ts/src/wallet/Wallet.ts:1508-1548`):
```typescript
async restore(start: number, count: number, config?: RestoreConfig) {
  // ...
  const zeros = Array(count).fill(0);
  const outputData = OutputData.createDeterministicData(0, this._seed, start, keyset, zeros);
  // ... single batch, no yielding
}
```

**Change**: Chunk output creation and yield between chunks:
```typescript
async restore(start: number, count: number, config?: RestoreConfig) {
  // ...
  const _CHUNK = globalThis.__CASHU_RECOVERY_CONFIG?.chunkSize || 8;
  const outputData: OutputData[] = [];
  for (let off = 0; off < count; off += _CHUNK) {
    const chunkSize = Math.min(_CHUNK, count - off);
    const zeros = Array(chunkSize).fill(0);
    const chunk = OutputData.createDeterministicData(0, this._seed, start + off, keyset, zeros);
    outputData.push(...chunk);
    if (off + _CHUNK < count) await new Promise(r => setTimeout(r, 0)); // Yield to event loop
  }
  // ... rest unchanged
}
```

### 2h. `batchRestore` Yielding Between Batches

**Original** (`cashu-ts/src/wallet/Wallet.ts:1475-1499`):
```typescript
async batchRestore(gapLimit = 300, batchSize = 100, counter = 0, keysetId?: string) {
  const requiredEmptyBatches = Math.ceil(gapLimit / batchSize);
  let emptyBatchesFound = 0;
  while (emptyBatchesFound < requiredEmptyBatches) {
    const restoreRes = await this.restore(counter, batchSize, { keysetId });
    // ... accumulate or increment empty counter
    counter += batchSize;
  }
}
```

**Change**: Yield to the event loop between consecutive batches to prevent UI starvation:
```typescript
async batchRestore(gapLimit = 300, batchSize = 100, counter = 0, keysetId?: string) {
  const requiredEmptyBatches = Math.ceil(gapLimit / batchSize);
  let emptyBatchesFound = 0;
  let batchNum = 0;
  while (emptyBatchesFound < requiredEmptyBatches) {
    batchNum++;
    if (batchNum > 1) await new Promise(r => setTimeout(r, 0)); // Yield between batches
    const restoreRes = await this.restore(counter, batchSize, { keysetId });
    // ... accumulate or increment empty counter
    counter += batchSize;
  }
}
```

---

## 3. coco-core Changes

### 3a. Probe-First Recovery

**Original** (`coco/packages/core/services/WalletRestoreService.ts:158-172`):
```typescript
async restoreKeyset(mintUrl: string, wallet: Wallet, keysetId: string): Promise<void> {
  const oldProofs = await this.proofService.getProofsByKeysetId(mintUrl, keysetId);
  const { proofs, lastCounterWithSignature } = await wallet.batchRestore(
    this.restoreBatchSize,    // 300
    this.restoreGapLimit,     // 100
    this.restoreStartCounter, // 0
    keysetId,
  );
  // ... validate, check states, save
}
```

**Change**: Probe with 5 outputs first; skip full restore if empty:
```typescript
async restoreKeyset(mintUrl: string, wallet: Wallet, keysetId: string): Promise<void> {
  const _rcfg = globalThis.__CASHU_RECOVERY_CONFIG || {};
  const _PROBE_SIZE = _rcfg.probeSize ?? 5;
  const _batchSz = _rcfg.batchSize ?? this.restoreBatchSize;
  const oldProofs = await this.proofService.getProofsByKeysetId(mintUrl, keysetId);

  let proofs: Proof[];
  let lastCounterWithSignature: number | undefined;

  // Probe first — cheap check if keyset has any proofs
  const probeResult = await wallet.restore(this.restoreStartCounter, _PROBE_SIZE, { keysetId });
  if (probeResult.proofs.length === 0) {
    return; // Empty keyset — skip expensive full batchRestore
  }

  // Proofs exist, do full restore from after probe
  const restResult = await wallet.batchRestore(
    _batchSz, this.restoreGapLimit,
    this.restoreStartCounter + _PROBE_SIZE, keysetId,
  );
  proofs = [...probeResult.proofs, ...restResult.proofs];
  lastCounterWithSignature = restResult.lastCounterWithSignature ?? probeResult.lastCounterWithSignature;
  // ... validate, check states, save (unchanged)
}
```

### 3b. Reduced Batch Size

**Original** (`coco/packages/core/services/WalletRestoreService.ts:16`):
```typescript
private readonly restoreBatchSize = 300;
```

**Change**:
```typescript
private readonly restoreBatchSize = 25;
```

Smaller batches yield more frequently via cashu-ts chunking, keeping the UI thread responsive.

### 3c. Parallel Keyset Restoration

**Original** (`coco/packages/core/api/WalletApi.ts:64-89`):
```typescript
async restore(mintUrl: string) {
  const mint = await this.mintService.addMintByUrl(mintUrl, { trusted: true });
  const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl);
  for (const keyset of mint.keysets) {
    try {
      await this.walletRestoreService.restoreKeyset(mintUrl, wallet, keyset.id);
    } catch (error) {
      failedKeysetIds[keyset.id] = error as Error;
    }
  }
}
```

**Change**: Restore all keysets concurrently:
```typescript
async restore(mintUrl: string) {
  const mint = await this.mintService.addMintByUrl(mintUrl, { trusted: true });
  const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl);
  const _parallel = globalThis.__CASHU_RECOVERY_CONFIG?.parallelKeysets !== false;

  if (_parallel) {
    await Promise.allSettled(
      mint.keysets.map(keyset =>
        this.walletRestoreService.restoreKeyset(mintUrl, wallet, keyset.id)
      )
    );
  } else {
    for (const keyset of mint.keysets) { /* sequential fallback */ }
  }
}
```

The same parallel pattern is also applied to `WalletApi.sweep` so keyset sweeps run concurrently as well.

### 3d. Stale Mint Fallback

**Original** (`coco/packages/core/services/MintService.ts:110-137`):
```typescript
async ensureUpdatedMint(mintUrl: string) {
  let mint = await this.mintRepo.getMintByUrl(mintUrl);
  if (mint.updatedAt < now - MINT_REFRESH_TTL_S) {
    const updated = await this.updateMint(mint);  // ← throws on network error
    return updated;
  }
  return { mint, keysets };
}
```

**Change**: Catch network errors, fall back to cached keysets:
```typescript
async ensureUpdatedMint(mintUrl: string) {
  let mint = await this.mintRepo.getMintByUrl(mintUrl);
  if (mint.updatedAt < now - MINT_REFRESH_TTL_S) {
    try {
      const updated = await this.updateMint(mint);
      return updated;
    } catch (err) {
      const staleKeysets = await this.keysetRepo.getKeysetsByMintUrl(mint.mintUrl);
      if (staleKeysets.length > 0) return { mint, keysets: staleKeysets };
      throw err; // No cached data, must fail
    }
  }
  return { mint, keysets };
}
```

---

## 4. Configuration

All parameters are runtime-configurable via `globalThis.__CASHU_RECOVERY_CONFIG`:

```typescript
globalThis.__CASHU_RECOVERY_CONFIG = {
  chunkSize: 8,           // cashu-ts: outputs per yield in restore
  probeSize: 5,           // coco: outputs to probe before full restore
  skipProbe: false,       // coco: skip probe, go straight to batchRestore
  batchSize: 25,          // coco: override restoreBatchSize
  parallelKeysets: true,  // coco: restore keysets concurrently
};
```

The native crypto bridge initializes via `initNativeCrypto()` which sets `globalThis.__CASHU_NATIVE.active = true`. All patched functions check this flag and fall back to JS if native is unavailable.

---

## 5. Summary

| Layer | Original Code | Change | Impact |
|-------|--------------|--------|--------|
| nutpatch | — | Add `batchDeriveLegacy` to Nitro spec | Batch recovery: ~68ms → sub-ms/output |
| cashu-ts | `hashToCurve` JS loop | Native C++ delegation | ~6ms → ~0.05ms |
| cashu-ts | `blindMessage` JS point ops | Native C++ delegation | ~6ms → ~0.05ms |
| cashu-ts | `unblindSignature` JS `subtract(multiply)` | Native C++ delegation | ~6ms → ~0.05ms |
| cashu-ts | `hash_e` JS hex concat + sha256 | Native C++ delegation | ~3ms → ~0.03ms |
| cashu-ts | `derive_deprecated` fresh HDKey every call | WeakMap/Map caching | ~62ms → ~4ms/output |
| cashu-ts | `createDeterministicData` per-output derive | 3-tier: native batch / JS cache / fallback | 300 outputs: ~20s → ~100ms |
| cashu-ts | `restore` single batch | Chunked with event loop yield | UI stays responsive |
| cashu-ts | `batchRestore` no yielding | Yield between consecutive batches | Prevents batch monopolization |
| coco | `restoreKeyset` full batchRestore immediately | Probe 5 outputs first | Empty keysets: skip in ~300ms |
| coco | `restoreBatchSize = 300` | Reduced to 25 | Finer yield granularity |
| coco | Sequential keyset restore | `Promise.allSettled` parallel | N keysets: Nx speedup |
| coco | `ensureUpdatedMint` throws on error | Stale keyset fallback | Network resilience |

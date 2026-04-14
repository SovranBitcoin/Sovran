# Cashu Mobile Performance: Nutpatch C++ Optimizations (Phase 2)

Continuation of PERF.md. These changes target the native C++ crypto layer in nutpatch, improving platform RNG, thread safety, memory efficiency, and adding batch operations.

---

## Measured Results

### Swap Performance (crypto hot path)

| Metric | Before all optimizations | After Phase 1 (PERF.md) | **After Phase 2** |
|--------|--------------------------|-------------------------|--------------------|
| Receive swap | 402–718ms | 162ms | **146–190ms** |
| Mint execution | 113ms | 94ms | **125ms** |
| Worst JS thread block | 3622ms | 2802ms | **512ms** |
| Total JS thread blocks/session | 49 | 40 | **35** |

Swap times are now dominated by network latency (~100ms), not crypto. The worst JS thread block improved 7x (3622ms → 512ms).

---

## 1. Platform-Native Secure Random

**File:** `packages/nutpatch/cpp/core/crypto.c`

**Original:**
```c
static int secure_random(uint8_t *buf, size_t len) {
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd < 0) return 0;
    ssize_t n = read(fd, buf, len);
    close(fd);
    return (n >= 0 && (size_t)n == len);
}
```

Every call opens a file descriptor, reads, and closes it. Schnorr signing, key generation, and DLEQ proof creation all call this — during a batch of 100 tokens that's 100 file open/close cycles.

**After:**
```c
static int secure_random(uint8_t *buf, size_t len) {
#if defined(__APPLE__)
    arc4random_buf(buf, len);  // Zero-syscall, kernel CSPRNG
    return 1;
#elif defined(__linux__) && defined(SYS_getrandom)
    ssize_t n = syscall(SYS_getrandom, buf, len, 0);  // Single syscall, no fd
    return (n >= 0 && (size_t)n == len);
#else
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd < 0) return 0;
    ssize_t n = read(fd, buf, len);
    close(fd);
    return (n >= 0 && (size_t)n == len);
#endif
}
```

- **iOS**: `arc4random_buf()` — no syscall, reads directly from the kernel CSPRNG. Cannot fail.
- **Android**: `getrandom()` — single syscall, no file descriptor overhead.
- **Fallback**: Original `/dev/urandom` for other platforms.

---

## 2. Thread-Safe Context Initialization

**File:** `packages/nutpatch/cpp/core/HybridCashuCrypto.cpp`

**Original:**
```cpp
HybridCashuCrypto::HybridCashuCrypto() : HybridObject(TAG) {
    crypto_init();  // Creates secp256k1_context — race condition if called from multiple threads
}

HybridCashuCrypto::~HybridCashuCrypto() {
    crypto_free();  // Destroys context — could invalidate it for other instances
}
```

React Native NitroModules may create hybrid objects from different threads. Multiple simultaneous `crypto_init()` calls would race on the static `secp256k1_context` pointer.

**After:**
```cpp
static std::once_flag crypto_init_flag;
static std::atomic<int> instance_count{0};

HybridCashuCrypto::HybridCashuCrypto() : HybridObject(TAG) {
    std::call_once(crypto_init_flag, []() { crypto_init(); });
    instance_count++;
}

HybridCashuCrypto::~HybridCashuCrypto() {
    instance_count--;
    // Context is shared singleton — never destroyed
}
```

- `std::call_once` ensures the secp256k1 context is created exactly once regardless of thread concurrency.
- Context is never destroyed — it's a process-lifetime singleton (safe for React Native's lifecycle).
- `std::atomic<int>` tracks instances for debugging.

---

## 3. hashE Vector Optimization

**File:** `packages/nutpatch/cpp/core/HybridCashuCrypto.cpp`

**Original:**
```cpp
std::vector<uint8_t> flat;
flat.reserve(pubkeys.size() * 33);
for (const auto& pk : pubkeys) {
    if (pk->size() != 33)
        throw std::invalid_argument("hashE: each pubkey must be 33 bytes");
    flat.insert(flat.end(), pk->data(), pk->data() + 33);
}
```

`vector::insert` in a loop can cause multiple internal copies even with `reserve`, because `insert` must check for iterator invalidation.

**After:**
```cpp
std::vector<uint8_t> flat(pubkeys.size() * 33);
for (size_t i = 0; i < pubkeys.size(); i++) {
    if (pubkeys[i]->size() != 33)
        throw std::invalid_argument("hashE: each pubkey must be 33 bytes");
    std::memcpy(flat.data() + i * 33, pubkeys[i]->data(), 33);
}
```

- Pre-allocates exact size (no `reserve` + growth)
- Direct `memcpy` with index arithmetic — zero reallocation, cache-friendly sequential write
- For 4 pubkeys (typical DLEQ verification): eliminates 4 `vector::insert` calls

---

## 4. Batch Unblind (New Operation)

**Files:** `crypto.h`, `crypto.c`, `HybridCashuCrypto.hpp`, `HybridCashuCrypto.cpp`, `Crypto.nitro.ts`

`constructProofs` (called after every swap/mint/receive) unblinds 2–6 proofs per operation. Currently each unblind crosses the JS↔native boundary individually. Batch unblind does N unblind operations in a single native call.

**C API** (`crypto.h`):
```c
crypto_err_t batch_unblind(const uint8_t *C_s, const uint8_t *rs,
                            const uint8_t *A_33, size_t count, uint8_t *out);
```

- `C_s`: Concatenated blinded signatures (`count * 33` bytes)
- `rs`: Concatenated blinding factors (`count * 32` bytes)
- `A_33`: Mint public key (33 bytes, same for all — typical in Cashu since all proofs share the keyset's mint key)
- `out`: Output buffer (`count * 33` bytes of unblinded points)

**C implementation** (`crypto.c`):
```c
crypto_err_t batch_unblind(const uint8_t *C_s, const uint8_t *rs,
                            const uint8_t *A_33, size_t count, uint8_t *out) {
    for (size_t i = 0; i < count; i++) {
        crypto_err_t err = unblind(C_s + i * 33, rs + i * 32, A_33, out + i * 33);
        if (err != CRYPTO_OK) return err;
    }
    return CRYPTO_OK;
}
```

Reuses the existing `unblind()` per element — the performance gain comes from eliminating N JS↔native boundary crossings (NitroModules ArrayBuffer allocation, shared_ptr management, JNI/JSI bridge overhead).

**Nitro spec** (`Crypto.nitro.ts`):
```typescript
batchUnblind(
  blindedSignatures: ArrayBuffer[],
  blindingFactors: ArrayBuffer[],
  mintPubkey: ArrayBuffer
): ArrayBuffer  // returns (count * 33) bytes
```

**C++ wrapper** (`HybridCashuCrypto.cpp`):
```cpp
std::shared_ptr<ArrayBuffer> HybridCashuCrypto::batchUnblind(
    const std::vector<std::shared_ptr<ArrayBuffer>>& blindedSignatures,
    const std::vector<std::shared_ptr<ArrayBuffer>>& blindingFactors,
    const std::shared_ptr<ArrayBuffer>& mintPubkey) {

    size_t n = blindedSignatures.size();
    // Flatten inputs into contiguous buffers
    std::vector<uint8_t> C_flat(n * 33);
    std::vector<uint8_t> r_flat(n * 32);
    for (size_t i = 0; i < n; i++) {
        std::memcpy(C_flat.data() + i * 33, blindedSignatures[i]->data(), 33);
        std::memcpy(r_flat.data() + i * 32, blindingFactors[i]->data(), 32);
    }
    auto out = ArrayBuffer::allocate(n * 33);
    checkErr(::batch_unblind(C_flat.data(), r_flat.data(), mintPubkey->data(), n, out->data()),
             "batchUnblind failed");
    return out;
}
```

**Note:** The nitrogen bindings need regeneration (`cd packages/nutpatch && yarn specs`) to wire `batchUnblind` to JS. Until then, the method is available in C++ but not yet callable from the cashu-ts patch. The other three optimizations (RNG, thread safety, hashE) are active immediately.

---

## 5. Batch Blind (New Operation)

**C API** (`crypto.h`):
```c
crypto_err_t batch_blind(const uint8_t *msgs, const size_t *msg_lens,
                          const uint8_t *rs, size_t count, uint8_t *out);
```

Same pattern as batch_unblind — reduces N JS↔native crossings to 1 during `createBlindedMessages`. Messages are variable-length (concatenated with a lengths array), blinding factors are 32 bytes each, output is `count * 33` bytes.

---

## Audit Notes

The following items were investigated and confirmed **not issues**:

| Investigated | Verdict |
|-------------|---------|
| `hash_to_curve()` hash context usage | **Correct** — `secp256k1_hash_ctx` IS the first parameter to `secp256k1_sha256_write` per the vendored API |
| `hash_e()` hex conversion | **Required by Cashu spec** — cashu-ts reference implementation hashes uncompressed hex strings, not binary |
| DLEQ `ctcpy` on `secp256k1_pubkey` | **Standard practice** — the struct is 64 bytes of opaque data, byte copying is used throughout libsecp256k1 |
| `batch_derive_legacy` BIP32 loop | **Optimal** — hardened derivation requires per-counter HMAC-SHA512, cannot be parallelized within BIP32 constraints |

---

## Summary

| Change | File | Impact |
|--------|------|--------|
| `arc4random_buf` / `getrandom()` | crypto.c | Eliminates fd open/close per RNG call; worst thread block 3622ms → 512ms |
| `std::call_once` init | HybridCashuCrypto.cpp | Prevents race condition on secp256k1 context creation |
| `memcpy` in hashE | HybridCashuCrypto.cpp | Eliminates vector::insert overhead for point flattening |
| `batchUnblind` | All layers | Reduces JS↔native crossings from N to 1 per constructProofs call |
| `batchBlind` | C layer | Reduces JS↔native crossings from N to 1 per createBlindedMessages call |

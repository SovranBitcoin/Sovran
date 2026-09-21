# Entropy contract

Reference for the `entropy/*` review questions. Source paths identify owners for a human
investigation; their contents are not automatically present in a Jev request. A caller or
implementation you cannot see is unknown, not evidence of a defect. Tests may deliberately construct
weak entropy in order to assert that it is rejected.

## What counts as unguessable here

Security-relevant randomness — BIP-39 seed entropy, Nostr private keys, Cashu proof secrets and
blinding factors, P2PK keys, NIP-44/NIP-17 conversation keys and nonces, NIP-46 bunker secrets,
pairing codes and auth tokens — comes from one of:

- `crypto.getRandomValues`, backed by the platform CSPRNG
- `expo-crypto` (`getRandomBytesAsync`, `getRandomValues`)
- `randomBytes` from `@noble/hashes/utils`, or `@scure/*` and `nostr-tools` helpers that wrap it
  (`generateSecretKey`)
- the installed Coco/cashu-ts packages, for proof secrets and blinding factors they own

Everything else — `Math.random`, `Date.now`, `performance.now`, a counter, a device id, a user PIN,
a `uuid` from a non-crypto source, a hash of any of those — is guessable input. It may seed jitter,
an animation, a list key, a sampling decision or a placeholder. It may not become key material.

A value is "key material" if guessing it lets someone spend, sign, impersonate or decrypt. Judge
what the value **becomes**, not what it is called at the point it is produced.

## Three ways this fails in practice

Every published wallet-entropy theft falls into one of these. The naive case — `Math.random()`
called directly to make a key — is covered separately by `secrets/randomness` in the contributor
conventions. The three below are the ones where the code still *looks* correct.

### 1. A strong source silently replaced by a weak one

The intended CSPRNG is named in the source, but at runtime a weaker path executes and nothing fails.
No exception, no log, no test failure — the output is still bytes of the right length.

- **Coldcard (2026, firmware 4.0.1–4.1.9 and later lines).** A `#ifndef MICROPY_HW_ENABLE_RNG`
  guard tested whether the macro was *defined* rather than whether it was *nonzero*. Coinkite set it
  to `0` to disable the software path; the guard let it compile anyway, and because the fallback had
  the same function signature as the hardware TRNG wrapper, the build succeeded and the TRNG code
  sat in the binary uncalled. MicroPython's Yasmarang PRNG, seeded from chip id and timer registers
  and never reseeded, produced the seeds instead: ~40 bits effective on Mk2/Mk3, ~72 bits on
  Mk4/Mk5/Q, against 128. 594 BTC drained from ~500 devices in 25 minutes.
- **Randstorm (BitcoinJS, wallets created 2011–2015).** `SecureRandom()` fell back to
  `Math.random()` where `window.crypto` was missing or the browser's `Math.random` was itself weak.
  Keys that should have had 256 bits typically had ~48. Estimated to touch millions of wallets.
- **ESP32 / Blockstream Jade (CVE-2025-27840).** Raised as insufficient entropy in the chip's RNG.
  Blockstream disputes that Jade is exposed, and the reason is the mitigation worth copying: Jade
  does not trust one source. It runs a Bitcoin Core-style accumulator — a 32-byte state re-hashed
  with SHA-512 against CPU counters, battery state, ambient temperature, boot-time camera frames,
  the hardware RNG and entropy from the companion app — so a single weak contributor does not
  weaken the result.

**The question to ask:** can this code produce key material from something other than the approved
source without failing loudly? A `??`, `||`, `try`/`catch`, `typeof x !== "undefined"` ternary,
optional chain, polyfill, shim, mock or platform branch around an entropy read is the shape. A
fallback that *throws* is fine. A fallback that *returns bytes* is the bug.

### 2. A wide key derived from a narrow input

A CSPRNG may even be present, but only a small quantity of unguessable input reaches the key, and
the rest is expansion — hashing, stretching or a PRNG — which adds length, not entropy.

- **Milk Sad (CVE-2023-39910, Libbitcoin Explorer 3.0.0–3.6.0).** `bx seed` ran Mersenne Twister
  seeded with 32 bits of system clock. Asking for 256 bits returned "32 bits of high-precision clock
  time that was put through a blender and expanded to 256 bit without adding new information."
  2³² seeds is a few days of consumer hardware. Exploited in the wild from May 2023.
- **Trust Wallet browser extension (CVE-2023-31290, versions 0.0.172–0.0.182).** MT19937 seeded with
  a single 32-bit value produced the mnemonic — about four billion possible mnemonics, enumerable in
  hours. Exploited December 2022 and March 2023.

**The question to ask:** trace the key back to its unguessable input. Does it terminate at a
full-width read from an approved source, or at a timestamp, a counter, a device id, a PIN, one
32-bit draw, or a truncated/`slice`d/`% n`/`toString(36)`/`Number()`-converted portion of a larger
one? Non-crypto PRNGs by name — Mersenne Twister, `seedrandom`, `xorshift`, `mulberry32`, `chance`,
`faker` — never add entropy whatever they are seeded with. This is a structural question about where
the input comes from, not an arithmetic one about bit counts.

### 3. A per-use random value that can repeat

Some values must be unique per use, not merely unpredictable: an ECDSA/Schnorr signing nonce, an
AEAD nonce or IV, a Cashu blinding factor, a NIP-44 nonce. Repetition under the same key is fatal
even when the generator is otherwise sound.

- **Android `SecureRandom` (2013).** The OS generator was sometimes left unseeded and returned
  repeating output. bitcoinj-based wallets — Bitcoin Wallet, blockchain.info, BitcoinSpinner,
  Mycelium — signed two transactions with the same `k`. Anyone could scan the chain for two
  signatures sharing an `r` value and solve for the private key. 55.82 BTC confirmed stolen.

**The question to ask:** is a nonce, IV or blinding factor drawn once and then reused across two
signatures, encryptions or retries; cached, persisted, stored in a module-level or component-level
variable; derived deterministically from data that can repeat; or carried unchanged through a retry?
Re-sending an already-signed event is correct and is not this concern — see `nostr/retry-identity`.

## Where this repo produces entropy

`app/shared/lib/nostr/secureStorage.ts` (BIP-39 mnemonic), `app/features/nostrSigner/lib/bunkerSecrets.ts`
(NIP-46), `app/shared/lib/nostr/nip17.ts` (gift-wrap keys and timestamp jitter),
`wallet/src/payment-request-receive.ts` (request ids). Proof secrets and blinding factors belong to
the installed Coco packages, not to this repository.

## Allowed cases

- `Math.random`, `Date.now` or a counter for jitter, backoff, animation, list keys, sampling,
  placeholders, demo data or a non-security id. `app/shared/lib/pricelistFeed.ts` and
  `app/features/composer/ui/PollComposeForm.tsx` are existing examples.
- A random *timestamp* offset for metadata privacy — `nip17.ts` draws it from
  `crypto.getRandomValues`, which is stricter than required and not a finding either way.
- A fixed or seeded generator inside a test, fixture, benchmark or property-test harness, and a test
  constructing weak entropy in order to assert it is rejected.
- Expansion that is *documented as* expansion over an already-wide secret: BIP-32 child derivation,
  HKDF, BIP-39 passphrase stretching. The question is the width of the root, not of its children.
- A fallback that throws, returns an error Result, or refuses to produce a key.

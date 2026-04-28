import { type HybridObject } from 'react-native-nitro-modules'

export interface Crypto extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  hashToCurve(message: ArrayBuffer): ArrayBuffer
  blind(message: ArrayBuffer, blindingFactor: ArrayBuffer): ArrayBuffer
  unblind(
    blindedSignature: ArrayBuffer,
    blindingFactor: ArrayBuffer,
    mintPubkey: ArrayBuffer
  ): ArrayBuffer

  computeSha256(message: ArrayBuffer): ArrayBuffer
  hashE(pubkeys: ArrayBuffer[]): ArrayBuffer

  schnorrSign(seckey: ArrayBuffer, msg: ArrayBuffer): ArrayBuffer
  schnorrVerify(sig: ArrayBuffer, msg: ArrayBuffer, xonlyPubkey: ArrayBuffer): boolean

  seckeyGenerate(): ArrayBuffer
  createBlindSignature(B_: ArrayBuffer, seckey: ArrayBuffer): ArrayBuffer

  verifyDleqProof(
    B_: ArrayBuffer,
    C_: ArrayBuffer,
    A: ArrayBuffer,
    s: ArrayBuffer,
    e: ArrayBuffer
  ): boolean
  createDleqProof(B_: ArrayBuffer, seckey: ArrayBuffer): ArrayBuffer

  /**
   * Batch-unblind multiple signatures in a single native call.
   * Reduces JS↔native boundary crossings from N to 1.
   * All signatures use the same mint pubkey A.
   *
   * @param blindedSignatures Array of 33-byte compressed points (C_)
   * @param blindingFactors Array of 32-byte scalars (r)
   * @param mintPubkey 33-byte compressed mint public key (A, same for all)
   * @returns (count * 33) bytes: unblinded points C = C_ - r*A
   */
  batchUnblind(
    blindedSignatures: ArrayBuffer[],
    blindingFactors: ArrayBuffer[],
    mintPubkey: ArrayBuffer
  ): ArrayBuffer

  /**
   * Batch-derive NUT-13 legacy keyset secrets and blinding factors.
   * Path: m/129372'/0'/{keysetIdInt}'/{counter}'/{0|1}
   *
   * @returns (count * 64) bytes: for each counter, 32 bytes secret + 32 bytes blinding.
   */
  batchDeriveLegacy(
    seed: ArrayBuffer,
    keysetIdInt: number,
    startCounter: number,
    count: number
  ): ArrayBuffer

  /**
   * NIP-44 v2 ECDH — derives the raw 32-byte X coordinate of the shared
   * point between `seckey` and `xonlyPubkey`. The result is the IKM
   * NIP-44 feeds into HKDF-extract with salt "nip44-v2".
   *
   * Differs from libsecp256k1's default ECDH (which hashes the compressed
   * shared point through SHA-256) — Nostr's NIP-44 spec needs the raw X
   * bytes, so the C implementation uses a custom hash callback that
   * copies the X coordinate verbatim.
   *
   * @param seckey       32-byte recipient private key
   * @param xonlyPubkey  32-byte counterparty X-only pubkey (BIP340 / Nostr)
   * @returns 32-byte raw shared X coordinate
   */
  ecdhNip44(seckey: ArrayBuffer, xonlyPubkey: ArrayBuffer): ArrayBuffer

  /**
   * Batch variant of `ecdhNip44`. Derives a shared X for each counterparty
   * pubkey against the same recipient seckey. One JS↔native crossing per
   * call regardless of inbox size — used to warm a NIP-17 unwrap cache
   * for many distinct senders without paying the bridge tax per item.
   *
   * @param seckey        32-byte recipient private key
   * @param xonlyPubkeys  Array of 32-byte X-only pubkeys
   * @returns (count * 32) bytes: concatenated raw X outputs in input order
   */
  batchEcdhNip44(seckey: ArrayBuffer, xonlyPubkeys: ArrayBuffer[]): ArrayBuffer

  /**
   * ChaCha20 IETF stream cipher (RFC 8439). Symmetric — same call
   * encrypts and decrypts. Used by NIP-44 v2 with a 12-byte nonce
   * derived via HKDF-expand from the conversation key.
   *
   * @param key      32-byte ChaCha20 key
   * @param nonce    12-byte IETF nonce
   * @param counter  Initial block counter (NIP-44 always starts at 0)
   * @param data     Input plaintext or ciphertext
   * @returns Output buffer (length = data.byteLength)
   */
  chacha20Ietf(
    key: ArrayBuffer,
    nonce: ArrayBuffer,
    counter: number,
    data: ArrayBuffer,
  ): ArrayBuffer

  /**
   * HMAC-SHA256. Output is always 32 bytes. JS layers HKDF-expand on
   * top of this primitive to derive NIP-44 v2 message keys without
   * paying the pure-JS HMAC cost (HKDF-expand for 76 bytes of NIP-44
   * key material makes 3 HMAC calls per message).
   */
  hmacSha256(key: ArrayBuffer, data: ArrayBuffer): ArrayBuffer

  /**
   * PBKDF2-HMAC-SHA512 (RFC 8018). The hot path is BIP-39
   * mnemonicToSeed at `iterations=2048`, `dkLen=64` — pure-JS
   * PBKDF2-SHA512 takes ~3 s on Hermes per cold profile boot and
   * blocks every wallet code path until it finishes. Native drops
   * that to single-digit ms.
   *
   * `password` and `salt` are opaque byte strings; any UTF-8/NFKD
   * normalisation must be done JS-side before calling. For BIP-39:
   *   password = NFKD(mnemonic)                 (UTF-8 bytes)
   *   salt     = "mnemonic" + NFKD(passphrase)  (UTF-8 bytes)
   */
  pbkdf2HmacSha512(
    password: ArrayBuffer,
    salt: ArrayBuffer,
    iterations: number,
    dkLen: number,
  ): ArrayBuffer
}

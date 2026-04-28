//
// Created by d4rp4t on 01/04/2026.
//

#ifndef CRYPTO_H
#define CRYPTO_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CRYPTO_OK = 0,
    CRYPTO_ERR_INVALID_POINT,
    CRYPTO_ERR_INVALID_SCALAR,
    CRYPTO_ERR_HASH_TO_CURVE,
    CRYPTO_ERR_SCHNORR_SIGN,
    CRYPTO_ERR_SCHNORR_VERIFY,
    CRYPTO_ERR_RANDOM,
} crypto_err_t;

// Context
void crypto_init(void);
void crypto_free(void);

crypto_err_t hash_to_curve(const uint8_t *msg, size_t msg_len, uint8_t *out33);

crypto_err_t blind(const uint8_t *msg, size_t msg_len, const uint8_t *r32, uint8_t *out33);

crypto_err_t unblind(const uint8_t *C_33, const uint8_t *r32,
                     const uint8_t *A_33, uint8_t *out33);

crypto_err_t hash_e(const uint8_t *pubkeys_33, size_t num_pubkeys, uint8_t *out32);

void compute_sha256(const uint8_t *msg, size_t msg_len, uint8_t *out32);

crypto_err_t schnorr_sign(const uint8_t *seckey, const uint8_t *msg32, uint8_t *sig_out);

crypto_err_t schnorr_verify(const uint8_t *sig, const uint8_t *msg32,
                             const uint8_t *xonly_pubkey32);

crypto_err_t seckey_generate(uint8_t *out32);

crypto_err_t create_blind_signature(const uint8_t *B_33, const uint8_t *seckey,
                                     uint8_t *out33);

int verify_dleq_proof(const uint8_t *B_33, const uint8_t *C_33, const uint8_t *A_33,
                      const uint8_t *s32, const uint8_t *e32);

crypto_err_t create_dleq_proof(const uint8_t *B_33, const uint8_t *a32,
                                uint8_t *s_out32, uint8_t *e_out32);

/**
 * Batch-blind multiple messages in a single call.
 * Reduces JS↔native boundary crossings from N to 1.
 *
 * @param msgs      Concatenated messages (variable length)
 * @param msg_lens  Array of per-message lengths
 * @param rs        Blinding factors: count * 32 bytes
 * @param count     Number of messages
 * @param out       Output: count * 33 bytes (compressed points)
 */
crypto_err_t batch_blind(const uint8_t *msgs, const size_t *msg_lens,
                          const uint8_t *rs, size_t count, uint8_t *out);

/**
 * Batch-unblind multiple signatures in a single call.
 * All signatures use the same mint pubkey A.
 *
 * @param C_s   Blinded signatures: count * 33 bytes
 * @param rs    Blinding factors: count * 32 bytes
 * @param A_33  Mint public key (33 bytes, same for all)
 * @param count Number of signatures
 * @param out   Output: count * 33 bytes (unblinded points)
 */
crypto_err_t batch_unblind(const uint8_t *C_s, const uint8_t *rs,
                            const uint8_t *A_33, size_t count, uint8_t *out);

/**
 * Batch-derive NUT-13 legacy keyset secrets and blinding factors.
 *
 * Derives BIP32 path: m/129372'/0'/{keyset_id_int}'/{counter}'/{0 or 1}
 * for counter in [start_counter .. start_counter+count).
 *
 * @param seed       BIP39 master seed (64 bytes)
 * @param seed_len   Length of seed (must be 64)
 * @param keyset_id_int  getKeysetIdInt(keysetId) result (< 2^31)
 * @param start_counter  First counter value
 * @param count      Number of counter values to derive
 * @param out        Output buffer: count * 64 bytes (32 secret + 32 blinding per counter)
 * @return CRYPTO_OK on success
 */
crypto_err_t batch_derive_legacy(const uint8_t *seed, size_t seed_len,
                                  uint32_t keyset_id_int,
                                  uint32_t start_counter, uint32_t count,
                                  uint8_t *out);

/**
 * NIP-44 v2 ECDH: derive the raw 32-byte X-coordinate of the shared point
 * between `seckey` and the X-only `xonly_pubkey`. Differs from libsecp256k1's
 * default `secp256k1_ecdh` (which hashes the compressed-point output through
 * SHA-256) — Nostr's NIP-44 spec requires the raw X coordinate as IKM into
 * its HKDF-extract step. Returns 32 bytes regardless of whether we treat
 * the X-only pubkey as having even (0x02 prefix) or odd (0x03) Y; the X
 * coordinate of P and -P is identical so the prefix choice is arbitrary.
 *
 * @param seckey32        32-byte recipient private key
 * @param xonly_pubkey32  32-byte counterparty X-only pubkey (BIP340 / Nostr)
 * @param out32           32-byte output buffer for the raw X
 */
crypto_err_t ecdh_nip44(const uint8_t *seckey32,
                         const uint8_t *xonly_pubkey32,
                         uint8_t *out32);

/**
 * Batch variant of `ecdh_nip44`. Derives a shared X for each of `count`
 * counterparty pubkeys against the same `seckey`. One JS↔native crossing
 * regardless of inbox size — important when warming a NIP-17 cache from
 * dozens of distinct senders on first launch.
 *
 * @param seckey32           32-byte recipient private key
 * @param xonly_pubkeys_concat   count * 32 bytes of concatenated X-only pubkeys
 * @param count              Number of counterparty pubkeys
 * @param out                count * 32 bytes of concatenated shared X outputs
 */
crypto_err_t batch_ecdh_nip44(const uint8_t *seckey32,
                               const uint8_t *xonly_pubkeys_concat,
                               size_t count,
                               uint8_t *out);

/**
 * ChaCha20 IETF stream cipher (RFC 8439). Symmetric — same call
 * encrypts and decrypts. Used by NIP-44 v2 with a 12-byte nonce
 * derived via HKDF-expand from the conversation key. Output buffer
 * must be at least `data_len` bytes.
 *
 * @param key32     32-byte ChaCha20 key
 * @param nonce12   12-byte IETF nonce
 * @param counter   Initial block counter (NIP-44 always starts at 0)
 * @param data      Input plaintext or ciphertext
 * @param data_len  Length of data
 * @param out       Output buffer (caller-allocated, >= data_len bytes)
 */
crypto_err_t chacha20_ietf(const uint8_t *key32,
                            const uint8_t *nonce12,
                            uint32_t counter,
                            const uint8_t *data,
                            size_t data_len,
                            uint8_t *out);

/**
 * HMAC-SHA256. Output is always 32 bytes. Wrapper around the
 * already-vendored secp256k1 internal HMAC implementation — exposed
 * here so JS can build HKDF-expand on top of it without paying the
 * pure-JS HMAC cost (HKDF-expand for NIP-44's 76-byte output makes
 * 3 HMAC calls per message).
 *
 * @param key       HMAC key
 * @param key_len   Length of key
 * @param data      Message bytes to authenticate
 * @param data_len  Length of data
 * @param out32     Output buffer (always 32 bytes)
 */
crypto_err_t hmac_sha256(const uint8_t *key,
                          size_t key_len,
                          const uint8_t *data,
                          size_t data_len,
                          uint8_t *out32);

/**
 * PBKDF2-HMAC-SHA512 (RFC 8018). Used by BIP-39 mnemonicToSeed at
 * 2048 iterations, dkLen=64 — pure-JS PBKDF2-SHA512 takes ~3 s on
 * Hermes per cold profile boot, this drops it to single-digit ms.
 *
 * Caller is responsible for any UTF-8/NFKD normalisation; the C side
 * treats password and salt as opaque byte strings.
 *
 * @param password      Password bytes (typically NFKD-normalised mnemonic)
 * @param password_len  Length of password
 * @param salt          Salt bytes (typically "mnemonic" + NFKD passphrase)
 * @param salt_len      Length of salt
 * @param iterations    PBKDF2 iteration count (BIP-39: 2048)
 * @param dk_len        Desired derived-key length in bytes (BIP-39: 64)
 * @param out           Caller-allocated output buffer (>= dk_len bytes)
 */
crypto_err_t pbkdf2_hmac_sha512(const uint8_t *password, size_t password_len,
                                 const uint8_t *salt, size_t salt_len,
                                 uint32_t iterations, uint32_t dk_len,
                                 uint8_t *out);

#ifdef __cplusplus
}
#endif

#endif // CRYPTO_H

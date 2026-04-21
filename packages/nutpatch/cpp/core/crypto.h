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

#ifdef __cplusplus
}
#endif

#endif // CRYPTO_H

//
// Created by d4rp4t on 1/04/2026.
//
#include "crypto.h"
#define VERIFY_CHECK(x) ((void)(x))
#include "../vendor/secp256k1/src/util.h"
#include "../vendor/secp256k1/src/hash.h"
#include "../vendor/secp256k1/src/hash_impl.h"
#include <secp256k1.h>
#include <secp256k1_extrakeys.h>
#include <secp256k1_schnorrsig.h>

#include <fcntl.h>
#include <string.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <stdlib.h>  /* arc4random_buf */
#elif defined(__linux__)
#include <sys/syscall.h>  /* SYS_getrandom */
#endif

static const unsigned char DOMAIN_SEPARATOR[] = "Secp256k1_HashToCurve_Cashu_";
#define DOMAIN_SEPARATOR_LEN (sizeof(DOMAIN_SEPARATOR) - 1)

static const char HEX_CHARS[] = "0123456789abcdef";

static secp256k1_context *ctx = NULL;

void crypto_init(void) {
    ctx = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
}

void crypto_free(void) {
    secp256k1_context_destroy(ctx);
    ctx = NULL;
}

static void ctcpy(uint8_t *dst, const uint8_t *src, size_t len) {
    volatile uint8_t *d = dst;
    const volatile uint8_t *s = src;
    for (size_t i = 0; i < len; i++) d[i] = s[i];
}

static int ct_eq(const uint8_t *a, const uint8_t *b, size_t len) {
    volatile uint8_t diff = 0;
    for (size_t i = 0; i < len; i++) diff |= a[i] ^ b[i];
    return (1 & ((diff - 1) >> 8));
}

static int secure_random(uint8_t *buf, size_t len) {
#if defined(__APPLE__)
    /* arc4random_buf never fails on Apple platforms */
    arc4random_buf(buf, len);
    return 1;
#elif defined(__linux__) && defined(SYS_getrandom)
    ssize_t n = syscall(SYS_getrandom, buf, len, 0);
    return (n >= 0 && (size_t)n == len);
#else
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd < 0) return 0;
    ssize_t n = read(fd, buf, len);
    close(fd);
    return (n >= 0 && (size_t)n == len);
#endif
}

static void bytes_to_hex(const uint8_t *bytes, size_t len, char *out) {
    for (size_t i = 0; i < len; i++) {
        out[i * 2]     = HEX_CHARS[bytes[i] >> 4];
        out[i * 2 + 1] = HEX_CHARS[bytes[i] & 0xf];
    }
}

static crypto_err_t pubkey_serialize(const secp256k1_pubkey *key, uint8_t *out33) {
    size_t len = 33;
    secp256k1_ec_pubkey_serialize(ctx, out33, &len, key, SECP256K1_EC_COMPRESSED);
    return CRYPTO_OK;
}

static crypto_err_t pubkey_parse(const uint8_t *in33, secp256k1_pubkey *out) {
    if (!secp256k1_ec_pubkey_parse(ctx, out, in33, 33))
        return CRYPTO_ERR_INVALID_POINT;
    return CRYPTO_OK;
}

crypto_err_t hash_to_curve(const uint8_t *msg, size_t msg_len, uint8_t *out33) {
    secp256k1_hash_ctx hash_ctx;
    secp256k1_hash_ctx_init(&hash_ctx);

    // msg_hash = SHA256(DOMAIN_SEPARATOR || msg)
    uint8_t msg_hash[32];
    {
        secp256k1_sha256 hash;
        secp256k1_sha256_initialize(&hash);
        secp256k1_sha256_write(&hash_ctx, &hash, DOMAIN_SEPARATOR, DOMAIN_SEPARATOR_LEN);
        secp256k1_sha256_write(&hash_ctx, &hash, msg, msg_len);
        secp256k1_sha256_finalize(&hash_ctx, &hash, msg_hash);
    }

    for (uint32_t i = 0; i < UINT32_MAX; i++) {
        uint8_t point_bytes[33];
        point_bytes[0] = 0x02;

        uint8_t counter_le[4] = {
            i & 0xFF, (i >> 8) & 0xFF, (i >> 16) & 0xFF, (i >> 24) & 0xFF,
        };

        secp256k1_sha256 hash;
        secp256k1_sha256_initialize(&hash);
        secp256k1_sha256_write(&hash_ctx, &hash, msg_hash, 32);
        secp256k1_sha256_write(&hash_ctx, &hash, counter_le, 4);
        secp256k1_sha256_finalize(&hash_ctx, &hash, point_bytes + 1);

        secp256k1_pubkey point;
        if (secp256k1_ec_pubkey_parse(ctx, &point, point_bytes, 33) == 1) {
            pubkey_serialize(&point, out33);
            return CRYPTO_OK;
        }
    }
    return CRYPTO_ERR_HASH_TO_CURVE;
}

crypto_err_t blind(const uint8_t *msg, size_t msg_len, const uint8_t *r32, uint8_t *out33) {
    secp256k1_pubkey Y;
    {
        uint8_t Y_bytes[33];
        crypto_err_t err = hash_to_curve(msg, msg_len, Y_bytes);
        if (err != CRYPTO_OK) return err;
        if (pubkey_parse(Y_bytes, &Y) != CRYPTO_OK) return CRYPTO_ERR_INVALID_POINT;
    }

    secp256k1_pubkey rG;
    if (!secp256k1_ec_pubkey_create(ctx, &rG, r32))
        return CRYPTO_ERR_INVALID_SCALAR;

    const secp256k1_pubkey *points[2] = { &Y, &rG };
    secp256k1_pubkey B_;
    if (!secp256k1_ec_pubkey_combine(ctx, &B_, points, 2))
        return CRYPTO_ERR_INVALID_POINT;

    return pubkey_serialize(&B_, out33);
}

crypto_err_t unblind(const uint8_t *C_33, const uint8_t *r32,
                     const uint8_t *A_33, uint8_t *out33) {
    secp256k1_pubkey C_;
    if (pubkey_parse(C_33, &C_) != CRYPTO_OK) return CRYPTO_ERR_INVALID_POINT;

    secp256k1_pubkey A;
    if (pubkey_parse(A_33, &A) != CRYPTO_OK) return CRYPTO_ERR_INVALID_POINT;

    uint8_t neg_r[32];
    ctcpy(neg_r, r32, 32);
    if (!secp256k1_ec_seckey_negate(ctx, neg_r))
        return CRYPTO_ERR_INVALID_SCALAR;

    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &A, neg_r))
        return CRYPTO_ERR_INVALID_POINT;

    const secp256k1_pubkey *points[2] = { &C_, &A };
    secp256k1_pubkey C;
    if (!secp256k1_ec_pubkey_combine(ctx, &C, points, 2))
        return CRYPTO_ERR_INVALID_POINT;

    return pubkey_serialize(&C, out33);
}

crypto_err_t hash_e(const uint8_t *pubkeys_33, size_t num_pubkeys, uint8_t *out32) {
    secp256k1_hash_ctx hash_ctx;
    secp256k1_hash_ctx_init(&hash_ctx);

    secp256k1_sha256 hash;
    secp256k1_sha256_initialize(&hash);

    for (size_t i = 0; i < num_pubkeys; i++) {
        secp256k1_pubkey pubkey;
        if (!secp256k1_ec_pubkey_parse(ctx, &pubkey, pubkeys_33 + i * 33, 33))
            return CRYPTO_ERR_INVALID_POINT;

        uint8_t uncompressed[65];
        size_t len = 65;
        secp256k1_ec_pubkey_serialize(ctx, uncompressed, &len, &pubkey,
                                      SECP256K1_EC_UNCOMPRESSED);

        char hex[130];
        bytes_to_hex(uncompressed, 65, hex);
        secp256k1_sha256_write(&hash_ctx, &hash, (const uint8_t *)hex, 130);
    }

    secp256k1_sha256_finalize(&hash_ctx, &hash, out32);
    return CRYPTO_OK;
}

void compute_sha256(const uint8_t *msg, size_t msg_len, uint8_t *out32) {
    secp256k1_hash_ctx hash_ctx;
    secp256k1_hash_ctx_init(&hash_ctx);

    secp256k1_sha256 hash;
    secp256k1_sha256_initialize(&hash);
    secp256k1_sha256_write(&hash_ctx, &hash, msg, msg_len);
    secp256k1_sha256_finalize(&hash_ctx, &hash, out32);
}

crypto_err_t schnorr_sign(const uint8_t *seckey, const uint8_t *msg32, uint8_t *sig_out) {
    secp256k1_keypair keypair;
    if (!secp256k1_keypair_create(ctx, &keypair, seckey))
        return CRYPTO_ERR_INVALID_SCALAR;

    uint8_t aux_rand[32];
    if (!secure_random(aux_rand, 32))
        return CRYPTO_ERR_RANDOM;

    if (!secp256k1_schnorrsig_sign32(ctx, sig_out, msg32, &keypair, aux_rand))
        return CRYPTO_ERR_SCHNORR_SIGN;

    return CRYPTO_OK;
}

crypto_err_t schnorr_verify(const uint8_t *sig, const uint8_t *msg32,
                             const uint8_t *xonly_pubkey32) {
    secp256k1_xonly_pubkey pubkey;
    if (!secp256k1_xonly_pubkey_parse(ctx, &pubkey, xonly_pubkey32))
        return CRYPTO_ERR_INVALID_POINT;

    if (!secp256k1_schnorrsig_verify(ctx, sig, msg32, 32, &pubkey))
        return CRYPTO_ERR_SCHNORR_VERIFY;

    return CRYPTO_OK;
}

crypto_err_t seckey_generate(uint8_t *out32) {
    for (int i = 0; i < 100; i++) {
        if (!secure_random(out32, 32)) return CRYPTO_ERR_RANDOM;
        if (secp256k1_ec_seckey_verify(ctx, out32)) return CRYPTO_OK;
    }
    return CRYPTO_ERR_INVALID_SCALAR;
}

crypto_err_t create_blind_signature(const uint8_t *B_33, const uint8_t *seckey,
                                     uint8_t *out33) {
    secp256k1_pubkey B_;
    if (pubkey_parse(B_33, &B_) != CRYPTO_OK) return CRYPTO_ERR_INVALID_POINT;

    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &B_, seckey))
        return CRYPTO_ERR_INVALID_SCALAR;

    return pubkey_serialize(&B_, out33);
}

int verify_dleq_proof(const uint8_t *B_33, const uint8_t *C_33, const uint8_t *A_33,
                      const uint8_t *s32, const uint8_t *e32) {
    secp256k1_pubkey B_, C_, A;
    if (pubkey_parse(B_33, &B_) != CRYPTO_OK) return 0;
    if (pubkey_parse(C_33, &C_) != CRYPTO_OK) return 0;
    if (pubkey_parse(A_33, &A)  != CRYPTO_OK) return 0;

    uint8_t neg_e[32];
    ctcpy(neg_e, e32, 32);
    if (!secp256k1_ec_seckey_negate(ctx, neg_e)) return 0;

    // R1 = s*G + (-e)*A
    secp256k1_pubkey sG, neg_eA, R1;
    if (!secp256k1_ec_pubkey_create(ctx, &sG, s32)) return 0;
    ctcpy((uint8_t*)&neg_eA, (const uint8_t*)&A, sizeof(secp256k1_pubkey));
    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &neg_eA, neg_e)) return 0;
    { const secp256k1_pubkey *pts[2] = { &sG, &neg_eA };
      if (!secp256k1_ec_pubkey_combine(ctx, &R1, pts, 2)) return 0; }

    // R2 = s*B_ + (-e)*C_
    secp256k1_pubkey sB_, neg_eC_, R2;
    ctcpy((uint8_t*)&sB_, (const uint8_t*)&B_, sizeof(secp256k1_pubkey));
    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &sB_, s32)) return 0;
    ctcpy((uint8_t*)&neg_eC_, (const uint8_t*)&C_, sizeof(secp256k1_pubkey));
    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &neg_eC_, neg_e)) return 0;
    { const secp256k1_pubkey *pts[2] = { &sB_, &neg_eC_ };
      if (!secp256k1_ec_pubkey_combine(ctx, &R2, pts, 2)) return 0; }

    // e' = hash_e([R1, R2, A, C_])
    uint8_t flat[33 * 4];
    pubkey_serialize(&R1, flat +  0);
    pubkey_serialize(&R2, flat + 33);
    pubkey_serialize(&A,  flat + 66);
    pubkey_serialize(&C_, flat + 99);

    uint8_t e_prime[32];
    if (hash_e(flat, 4, e_prime) != CRYPTO_OK) return 0;

    return ct_eq(e_prime, e32, 32);
}

/* -----------------------------------------------------------------------
 * SHA-512  (FIPS 180-4)
 * ----------------------------------------------------------------------- */

typedef struct {
    uint64_t state[8];
    uint8_t  buf[128];
    uint64_t bytes;
} sha512_ctx;

static const uint64_t sha512_K[80] = {
    0x428a2f98d728ae22ULL,0x7137449123ef65cdULL,0xb5c0fbcfec4d3b2fULL,0xe9b5dba58189dbbcULL,
    0x3956c25bf348b538ULL,0x59f111f1b605d019ULL,0x923f82a4af194f9bULL,0xab1c5ed5da6d8118ULL,
    0xd807aa98a3030242ULL,0x12835b0145706fbeULL,0x243185be4ee4b28cULL,0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL,0x80deb1fe3b1696b1ULL,0x9bdc06a725c71235ULL,0xc19bf174cf692694ULL,
    0xe49b69c19ef14ad2ULL,0xefbe4786384f25e3ULL,0x0fc19dc68b8cd5b5ULL,0x240ca1cc77ac9c65ULL,
    0x2de92c6f592b0275ULL,0x4a7484aa6ea6e483ULL,0x5cb0a9dcbd41fbd4ULL,0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL,0xa831c66d2db43210ULL,0xb00327c898fb213fULL,0xbf597fc7beef0ee4ULL,
    0xc6e00bf33da88fc2ULL,0xd5a79147930aa725ULL,0x06ca6351e003826fULL,0x142929670a0e6e70ULL,
    0x27b70a8546d22ffcULL,0x2e1b21385c26c926ULL,0x4d2c6dfc5ac42aedULL,0x53380d139d95b3dfULL,
    0x650a73548baf63deULL,0x766a0abb3c77b2a8ULL,0x81c2c92e47edaee6ULL,0x92722c851482353bULL,
    0xa2bfe8a14cf10364ULL,0xa81a664bbc423001ULL,0xc24b8b70d0f89791ULL,0xc76c51a30654be30ULL,
    0xd192e819d6ef5218ULL,0xd69906245565a910ULL,0xf40e35855771202aULL,0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL,0x1e376c085141ab53ULL,0x2748774cdf8eeb99ULL,0x34b0bcb5e19b48a8ULL,
    0x391c0cb3c5c95a63ULL,0x4ed8aa4ae3418acbULL,0x5b9cca4f7763e373ULL,0x682e6ff3d6b2b8a3ULL,
    0x748f82ee5defb2fcULL,0x78a5636f43172f60ULL,0x84c87814a1f0ab72ULL,0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL,0xa4506cebde82bde9ULL,0xbef9a3f7b2c67915ULL,0xc67178f2e372532bULL,
    0xca273eceea26619cULL,0xd186b8c721c0c207ULL,0xeada7dd6cde0eb1eULL,0xf57d4f7fee6ed178ULL,
    0x06f067aa72176fbaULL,0x0a637dc5a2c898a6ULL,0x113f9804bef90daeULL,0x1b710b35131c471bULL,
    0x28db77f523047d84ULL,0x32caab7b40c72493ULL,0x3c9ebe0a15c9bebcULL,0x431d67c49c100d4cULL,
    0x4cc5d4becb3e42b6ULL,0x597f299cfc657e2aULL,0x5fcb6fab3ad6faecULL,0x6c44198c4a475817ULL
};

#define ROR64(x,n) (((x)>>(n))|((x)<<(64-(n))))
#define CH64(x,y,z)  (((x)&(y))^(~(x)&(z)))
#define MAJ64(x,y,z) (((x)&(y))^((x)&(z))^((y)&(z)))
#define S512_0(x) (ROR64(x,28)^ROR64(x,34)^ROR64(x,39))
#define S512_1(x) (ROR64(x,14)^ROR64(x,18)^ROR64(x,41))
#define s512_0(x) (ROR64(x, 1)^ROR64(x, 8)^((x)>>7))
#define s512_1(x) (ROR64(x,19)^ROR64(x,61)^((x)>>6))

static uint64_t be64(const uint8_t *p) {
    return ((uint64_t)p[0]<<56)|((uint64_t)p[1]<<48)|((uint64_t)p[2]<<40)|
           ((uint64_t)p[3]<<32)|((uint64_t)p[4]<<24)|((uint64_t)p[5]<<16)|
           ((uint64_t)p[6]<<8)|(uint64_t)p[7];
}

static void put_be64(uint8_t *p, uint64_t v) {
    p[0]=(uint8_t)(v>>56); p[1]=(uint8_t)(v>>48); p[2]=(uint8_t)(v>>40); p[3]=(uint8_t)(v>>32);
    p[4]=(uint8_t)(v>>24); p[5]=(uint8_t)(v>>16); p[6]=(uint8_t)(v>>8);  p[7]=(uint8_t)v;
}

static void sha512_transform(sha512_ctx *s, const uint8_t *blk) {
    uint64_t W[80], a,b,c,d,e,f,g,h;
    for (int i=0;i<16;i++) W[i] = be64(blk + i*8);
    for (int i=16;i<80;i++) W[i] = s512_1(W[i-2]) + W[i-7] + s512_0(W[i-15]) + W[i-16];
    a=s->state[0]; b=s->state[1]; c=s->state[2]; d=s->state[3];
    e=s->state[4]; f=s->state[5]; g=s->state[6]; h=s->state[7];
    for (int i=0;i<80;i++) {
        uint64_t t1 = h + S512_1(e) + CH64(e,f,g) + sha512_K[i] + W[i];
        uint64_t t2 = S512_0(a) + MAJ64(a,b,c);
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    s->state[0]+=a; s->state[1]+=b; s->state[2]+=c; s->state[3]+=d;
    s->state[4]+=e; s->state[5]+=f; s->state[6]+=g; s->state[7]+=h;
}

static void sha512_init(sha512_ctx *s) {
    s->state[0]=0x6a09e667f3bcc908ULL; s->state[1]=0xbb67ae8584caa73bULL;
    s->state[2]=0x3c6ef372fe94f82bULL; s->state[3]=0xa54ff53a5f1d36f1ULL;
    s->state[4]=0x510e527fade682d1ULL; s->state[5]=0x9b05688c2b3e6c1fULL;
    s->state[6]=0x1f83d9abfb41bd6bULL; s->state[7]=0x5be0cd19137e2179ULL;
    s->bytes = 0;
    memset(s->buf, 0, 128);
}

static void sha512_update(sha512_ctx *s, const uint8_t *data, size_t len) {
    size_t pos = (size_t)(s->bytes & 127);
    s->bytes += len;
    while (len) {
        size_t n = 128 - pos;
        if (n > len) n = len;
        memcpy(s->buf + pos, data, n);
        pos += n; data += n; len -= n;
        if (pos == 128) { sha512_transform(s, s->buf); pos = 0; }
    }
}

static void sha512_final(sha512_ctx *s, uint8_t *out64) {
    size_t pos = (size_t)(s->bytes & 127);
    s->buf[pos++] = 0x80;
    if (pos > 112) { memset(s->buf+pos, 0, 128-pos); sha512_transform(s, s->buf); pos=0; }
    memset(s->buf+pos, 0, 120-pos);
    put_be64(s->buf+120, s->bytes*8);
    sha512_transform(s, s->buf);
    for (int i=0;i<8;i++) put_be64(out64+i*8, s->state[i]);
}

static void hmac_sha512(const uint8_t *key, size_t key_len,
                         const uint8_t *msg, size_t msg_len,
                         uint8_t *out64) {
    uint8_t k_pad[128];
    sha512_ctx inner, outer;

    /* If key > 128, hash it first */
    if (key_len > 128) {
        sha512_ctx kh; sha512_init(&kh);
        sha512_update(&kh, key, key_len);
        uint8_t kd[64]; sha512_final(&kh, kd);
        memset(k_pad, 0, 128); memcpy(k_pad, kd, 64);
    } else {
        memset(k_pad, 0, 128); memcpy(k_pad, key, key_len);
    }

    /* inner = SHA512((key XOR ipad) || msg) */
    uint8_t ipad[128], opad[128];
    for (int i=0;i<128;i++) { ipad[i] = k_pad[i]^0x36; opad[i] = k_pad[i]^0x5c; }
    sha512_init(&inner);
    sha512_update(&inner, ipad, 128);
    sha512_update(&inner, msg, msg_len);
    uint8_t inner_hash[64];
    sha512_final(&inner, inner_hash);

    /* outer = SHA512((key XOR opad) || inner_hash) */
    sha512_init(&outer);
    sha512_update(&outer, opad, 128);
    sha512_update(&outer, inner_hash, 64);
    sha512_final(&outer, out64);
}

/* -----------------------------------------------------------------------
 * BIP-32 HD Key Derivation (for NUT-13 legacy keysets)
 * ----------------------------------------------------------------------- */

typedef struct {
    uint8_t key[32];
    uint8_t chain_code[32];
} bip32_key_t;

static void bip32_from_seed(const uint8_t *seed, size_t seed_len, bip32_key_t *out) {
    uint8_t I[64];
    hmac_sha512((const uint8_t *)"Bitcoin seed", 12, seed, seed_len, I);
    memcpy(out->key, I, 32);
    memcpy(out->chain_code, I + 32, 32);
}

static crypto_err_t bip32_derive_hardened(const bip32_key_t *parent,
                                           uint32_t index,
                                           bip32_key_t *child) {
    uint8_t data[37]; /* 0x00 || key(32) || index_be(4) */
    data[0] = 0x00;
    memcpy(data + 1, parent->key, 32);
    uint32_t idx = index | 0x80000000u;
    data[33] = (uint8_t)(idx >> 24); data[34] = (uint8_t)(idx >> 16);
    data[35] = (uint8_t)(idx >> 8);  data[36] = (uint8_t)idx;

    uint8_t I[64];
    hmac_sha512(parent->chain_code, 32, data, 37, I);

    /* child_key = IL + parent_key (mod n) */
    memcpy(child->key, I, 32);
    if (!secp256k1_ec_seckey_tweak_add(ctx, child->key, parent->key))
        return CRYPTO_ERR_INVALID_SCALAR;
    memcpy(child->chain_code, I + 32, 32);
    return CRYPTO_OK;
}

static crypto_err_t bip32_derive_normal(const bip32_key_t *parent,
                                         uint32_t index,
                                         bip32_key_t *child) {
    /* Compute compressed public key from parent private key */
    secp256k1_pubkey pub;
    if (!secp256k1_ec_pubkey_create(ctx, &pub, parent->key))
        return CRYPTO_ERR_INVALID_SCALAR;

    uint8_t pub33[33];
    size_t len = 33;
    secp256k1_ec_pubkey_serialize(ctx, pub33, &len, &pub, SECP256K1_EC_COMPRESSED);

    uint8_t data[37]; /* pubkey(33) || index_be(4) */
    memcpy(data, pub33, 33);
    data[33] = (uint8_t)(index >> 24); data[34] = (uint8_t)(index >> 16);
    data[35] = (uint8_t)(index >> 8);  data[36] = (uint8_t)index;

    uint8_t I[64];
    hmac_sha512(parent->chain_code, 32, data, 37, I);

    memcpy(child->key, I, 32);
    if (!secp256k1_ec_seckey_tweak_add(ctx, child->key, parent->key))
        return CRYPTO_ERR_INVALID_SCALAR;
    memcpy(child->chain_code, I + 32, 32);
    return CRYPTO_OK;
}

crypto_err_t batch_derive_legacy(const uint8_t *seed, size_t seed_len,
                                  uint32_t keyset_id_int,
                                  uint32_t start_counter, uint32_t count,
                                  uint8_t *out) {
    if (seed_len != 64) return CRYPTO_ERR_INVALID_SCALAR;

    /* Derive prefix: m/129372'/0'/{keyset_id_int}' */
    bip32_key_t master, level1, level2, keyset_key;
    bip32_from_seed(seed, seed_len, &master);

    crypto_err_t err;
    err = bip32_derive_hardened(&master, 129372, &level1);
    if (err != CRYPTO_OK) return err;
    err = bip32_derive_hardened(&level1, 0, &level2);
    if (err != CRYPTO_OK) return err;
    err = bip32_derive_hardened(&level2, keyset_id_int, &keyset_key);
    if (err != CRYPTO_OK) return err;

    /* For each counter: derive {counter}'/0 (secret) and {counter}'/1 (blinding) */
    for (uint32_t i = 0; i < count; i++) {
        uint32_t ctr = start_counter + i;
        bip32_key_t counter_key, secret_key, blinding_key;

        err = bip32_derive_hardened(&keyset_key, ctr, &counter_key);
        if (err != CRYPTO_OK) return err;

        err = bip32_derive_normal(&counter_key, 0, &secret_key);
        if (err != CRYPTO_OK) return err;

        err = bip32_derive_normal(&counter_key, 1, &blinding_key);
        if (err != CRYPTO_OK) return err;

        memcpy(out + i * 64,      secret_key.key, 32);
        memcpy(out + i * 64 + 32, blinding_key.key, 32);
    }

    return CRYPTO_OK;
}

crypto_err_t batch_blind(const uint8_t *msgs, const size_t *msg_lens,
                          const uint8_t *rs, size_t count, uint8_t *out) {
    for (size_t i = 0; i < count; i++) {
        size_t msg_offset = 0;
        for (size_t j = 0; j < i; j++) msg_offset += msg_lens[j];
        crypto_err_t err = blind(msgs + msg_offset, msg_lens[i],
                                  rs + i * 32, out + i * 33);
        if (err != CRYPTO_OK) return err;
    }
    return CRYPTO_OK;
}

crypto_err_t batch_unblind(const uint8_t *C_s, const uint8_t *rs,
                            const uint8_t *A_33, size_t count, uint8_t *out) {
    for (size_t i = 0; i < count; i++) {
        crypto_err_t err = unblind(C_s + i * 33, rs + i * 32, A_33, out + i * 33);
        if (err != CRYPTO_OK) return err;
    }
    return CRYPTO_OK;
}

crypto_err_t create_dleq_proof(const uint8_t *B_33, const uint8_t *a32,
                                uint8_t *s_out32, uint8_t *e_out32) {
    secp256k1_pubkey B_;
    if (pubkey_parse(B_33, &B_) != CRYPTO_OK) return CRYPTO_ERR_INVALID_POINT;

    uint8_t r[32];
    crypto_err_t err = seckey_generate(r);
    if (err != CRYPTO_OK) return err;

    // R1 = r*G
    secp256k1_pubkey R1;
    if (!secp256k1_ec_pubkey_create(ctx, &R1, r)) return CRYPTO_ERR_INVALID_SCALAR;

    // R2 = r*B_
    secp256k1_pubkey R2;
    ctcpy((uint8_t*)&R2, (const uint8_t*)&B_, sizeof(secp256k1_pubkey));
    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &R2, r)) return CRYPTO_ERR_INVALID_POINT;

    // C_ = a*B_
    secp256k1_pubkey C_;
    ctcpy((uint8_t*)&C_, (const uint8_t*)&B_, sizeof(secp256k1_pubkey));
    if (!secp256k1_ec_pubkey_tweak_mul(ctx, &C_, a32)) return CRYPTO_ERR_INVALID_POINT;

    // A = a*G
    secp256k1_pubkey A;
    if (!secp256k1_ec_pubkey_create(ctx, &A, a32)) return CRYPTO_ERR_INVALID_SCALAR;

    // e = hash_e([R1, R2, A, C_])
    uint8_t flat[33 * 4];
    pubkey_serialize(&R1, flat +  0);
    pubkey_serialize(&R2, flat + 33);
    pubkey_serialize(&A,  flat + 66);
    pubkey_serialize(&C_, flat + 99);
    if (hash_e(flat, 4, e_out32) != CRYPTO_OK) return CRYPTO_ERR_INVALID_POINT;

    // s = r + e*a mod n
    uint8_t ea[32];
    ctcpy(ea, a32, 32);
    if (!secp256k1_ec_seckey_tweak_mul(ctx, ea, e_out32)) return CRYPTO_ERR_INVALID_SCALAR;
    ctcpy(s_out32, r, 32);
    if (!secp256k1_ec_seckey_tweak_add(ctx, s_out32, ea)) return CRYPTO_ERR_INVALID_SCALAR;

    return CRYPTO_OK;
}

//
// Created by d4rp4t on 01/04/2026.
//

#include "HybridCashuCrypto.hpp"
#include "crypto.h"

#include <stdexcept>
#include <mutex>
#include <cstring>
#include <cmath>

namespace margelo::nitro::nutpatch {

static std::once_flag crypto_init_flag;
static std::atomic<int> instance_count{0};

HybridCashuCrypto::HybridCashuCrypto() : HybridObject(TAG) {
    std::call_once(crypto_init_flag, []() { crypto_init(); });
    instance_count++;
}

HybridCashuCrypto::~HybridCashuCrypto() {
    // Don't destroy context — it's shared and created once via call_once
    // crypto_free() would invalidate the context for other instances
    instance_count--;
}

// Helpers
static std::shared_ptr<ArrayBuffer> makeBuffer(size_t size) {
    return ArrayBuffer::allocate(size);
}

static void checkErr(crypto_err_t err, const char *msg) {
    if (err != CRYPTO_OK) throw std::runtime_error(msg);
}

// Methods
std::shared_ptr<ArrayBuffer> HybridCashuCrypto::hashToCurve(
    const std::shared_ptr<ArrayBuffer>& message) {

    auto out = makeBuffer(33);
    checkErr(::hash_to_curve(message->data(), message->size(), out->data()),
             "hashToCurve failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::blind(
    const std::shared_ptr<ArrayBuffer>& message,
    const std::shared_ptr<ArrayBuffer>& blindingFactor) {

    if (blindingFactor->size() != 32)
        throw std::invalid_argument("blind: blindingFactor must be 32 bytes");

    auto out = makeBuffer(33);
    checkErr(::blind(message->data(), message->size(), blindingFactor->data(), out->data()),
             "blind failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::unblind(
    const std::shared_ptr<ArrayBuffer>& blindedSignature,
    const std::shared_ptr<ArrayBuffer>& blindingFactor,
    const std::shared_ptr<ArrayBuffer>& mintPubkey) {

    if (blindedSignature->size() != 33)
        throw std::invalid_argument("unblind: blindedSignature must be 33 bytes");
    if (blindingFactor->size() != 32)
        throw std::invalid_argument("unblind: blindingFactor must be 32 bytes");
    if (mintPubkey->size() != 33)
        throw std::invalid_argument("unblind: mintPubkey must be 33 bytes");

    auto out = makeBuffer(33);
    checkErr(::unblind(blindedSignature->data(), blindingFactor->data(),
                       mintPubkey->data(), out->data()),
             "unblind failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::computeSha256(
    const std::shared_ptr<ArrayBuffer>& message) {

    auto out = makeBuffer(32);
    ::compute_sha256(message->data(), message->size(), out->data());
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::hashE(
    const std::vector<std::shared_ptr<ArrayBuffer>>& pubkeys) {

    // flatten: each pubkey must be 33 bytes — use direct memcpy, no vector::insert
    std::vector<uint8_t> flat(pubkeys.size() * 33);
    for (size_t i = 0; i < pubkeys.size(); i++) {
        if (pubkeys[i]->size() != 33)
            throw std::invalid_argument("hashE: each pubkey must be 33 bytes");
        std::memcpy(flat.data() + i * 33, pubkeys[i]->data(), 33);
    }

    auto out = makeBuffer(32);
    checkErr(::hash_e(flat.data(), pubkeys.size(), out->data()), "hashE failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::schnorrSign(
    const std::shared_ptr<ArrayBuffer>& seckey,
    const std::shared_ptr<ArrayBuffer>& msg) {

    if (seckey->size() != 32)
        throw std::invalid_argument("schnorrSign: seckey must be 32 bytes");
    if (msg->size() != 32)
        throw std::invalid_argument("schnorrSign: msg must be 32 bytes");

    auto out = makeBuffer(64);
    checkErr(::schnorr_sign(seckey->data(), msg->data(), out->data()),
             "schnorrSign failed");
    return out;
}

bool HybridCashuCrypto::schnorrVerify(
    const std::shared_ptr<ArrayBuffer>& sig,
    const std::shared_ptr<ArrayBuffer>& msg,
    const std::shared_ptr<ArrayBuffer>& xonlyPubkey) {

    if (sig->size() != 64 || msg->size() != 32 || xonlyPubkey->size() != 32)
        return false;

    return ::schnorr_verify(sig->data(), msg->data(), xonlyPubkey->data()) == CRYPTO_OK;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::seckeyGenerate() {
    auto out = makeBuffer(32);
    checkErr(::seckey_generate(out->data()), "seckeyGenerate failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::createBlindSignature(
    const std::shared_ptr<ArrayBuffer>& B_,
    const std::shared_ptr<ArrayBuffer>& seckey) {

    if (B_->size() != 33)
        throw std::invalid_argument("createBlindSignature: B_ must be 33 bytes");
    if (seckey->size() != 32)
        throw std::invalid_argument("createBlindSignature: seckey must be 32 bytes");

    auto out = makeBuffer(33);
    checkErr(::create_blind_signature(B_->data(), seckey->data(), out->data()),
             "createBlindSignature failed");
    return out;
}

bool HybridCashuCrypto::verifyDleqProof(
    const std::shared_ptr<ArrayBuffer>& B_,
    const std::shared_ptr<ArrayBuffer>& C_,
    const std::shared_ptr<ArrayBuffer>& A,
    const std::shared_ptr<ArrayBuffer>& s,
    const std::shared_ptr<ArrayBuffer>& e) {

    if (B_->size() != 33 || C_->size() != 33 || A->size() != 33)
        return false;
    if (s->size() != 32 || e->size() != 32)
        return false;

    return ::verify_dleq_proof(B_->data(), C_->data(), A->data(),
                                s->data(), e->data()) == 1;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::createDleqProof(
    const std::shared_ptr<ArrayBuffer>& B_,
    const std::shared_ptr<ArrayBuffer>& seckey) {

    if (B_->size() != 33)
        throw std::invalid_argument("createDleqProof: B_ must be 33 bytes");
    if (seckey->size() != 32)
        throw std::invalid_argument("createDleqProof: seckey must be 32 bytes");

    auto out = makeBuffer(64);
    checkErr(::create_dleq_proof(B_->data(), seckey->data(),
                                  out->data(), out->data() + 32),
             "createDleqProof failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::batchDeriveLegacy(
    const std::shared_ptr<ArrayBuffer>& seed,
    double keysetIdInt,
    double startCounter,
    double count) {

    if (seed->size() != 64)
        throw std::invalid_argument("batchDeriveLegacy: seed must be 64 bytes");

    uint32_t kid  = static_cast<uint32_t>(keysetIdInt);
    uint32_t ctr  = static_cast<uint32_t>(startCounter);
    uint32_t cnt  = static_cast<uint32_t>(count);

    if (cnt == 0 || cnt > 10000)
        throw std::invalid_argument("batchDeriveLegacy: count must be 1..10000");

    auto out = makeBuffer(static_cast<size_t>(cnt) * 64);
    checkErr(::batch_derive_legacy(seed->data(), seed->size(), kid, ctr, cnt, out->data()),
             "batchDeriveLegacy failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::batchUnblind(
    const std::vector<std::shared_ptr<ArrayBuffer>>& blindedSignatures,
    const std::vector<std::shared_ptr<ArrayBuffer>>& blindingFactors,
    const std::shared_ptr<ArrayBuffer>& mintPubkey) {

    size_t n = blindedSignatures.size();
    if (n != blindingFactors.size())
        throw std::invalid_argument("batchUnblind: arrays must be same length");
    if (n == 0) return makeBuffer(0);
    if (mintPubkey->size() != 33)
        throw std::invalid_argument("batchUnblind: mintPubkey must be 33 bytes");

    // Flatten inputs
    std::vector<uint8_t> C_flat(n * 33);
    std::vector<uint8_t> r_flat(n * 32);
    for (size_t i = 0; i < n; i++) {
        if (blindedSignatures[i]->size() != 33)
            throw std::invalid_argument("batchUnblind: each signature must be 33 bytes");
        if (blindingFactors[i]->size() != 32)
            throw std::invalid_argument("batchUnblind: each factor must be 32 bytes");
        std::memcpy(C_flat.data() + i * 33, blindedSignatures[i]->data(), 33);
        std::memcpy(r_flat.data() + i * 32, blindingFactors[i]->data(), 32);
    }

    auto out = makeBuffer(n * 33);
    checkErr(::batch_unblind(C_flat.data(), r_flat.data(), mintPubkey->data(), n, out->data()),
             "batchUnblind failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::ecdhNip44(
    const std::shared_ptr<ArrayBuffer>& seckey,
    const std::shared_ptr<ArrayBuffer>& xonlyPubkey) {

    if (seckey->size() != 32)
        throw std::invalid_argument("ecdhNip44: seckey must be 32 bytes");
    if (xonlyPubkey->size() != 32)
        throw std::invalid_argument("ecdhNip44: xonlyPubkey must be 32 bytes");

    auto out = makeBuffer(32);
    checkErr(::ecdh_nip44(seckey->data(), xonlyPubkey->data(), out->data()),
             "ecdhNip44 failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::batchEcdhNip44(
    const std::shared_ptr<ArrayBuffer>& seckey,
    const std::vector<std::shared_ptr<ArrayBuffer>>& xonlyPubkeys) {

    if (seckey->size() != 32)
        throw std::invalid_argument("batchEcdhNip44: seckey must be 32 bytes");

    size_t n = xonlyPubkeys.size();
    if (n == 0) return makeBuffer(0);

    // Flatten inputs into a single contiguous block — one allocation,
    // one pass through the C layer, instead of N JS↔native crossings.
    std::vector<uint8_t> pubkeys_flat(n * 32);
    for (size_t i = 0; i < n; i++) {
        if (xonlyPubkeys[i]->size() != 32)
            throw std::invalid_argument("batchEcdhNip44: each pubkey must be 32 bytes");
        std::memcpy(pubkeys_flat.data() + i * 32, xonlyPubkeys[i]->data(), 32);
    }

    auto out = makeBuffer(n * 32);
    checkErr(::batch_ecdh_nip44(seckey->data(), pubkeys_flat.data(), n, out->data()),
             "batchEcdhNip44 failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::chacha20Ietf(
    const std::shared_ptr<ArrayBuffer>& key,
    const std::shared_ptr<ArrayBuffer>& nonce,
    double counter,
    const std::shared_ptr<ArrayBuffer>& data) {

    if (key->size() != 32)
        throw std::invalid_argument("chacha20Ietf: key must be 32 bytes");
    if (nonce->size() != 12)
        throw std::invalid_argument("chacha20Ietf: nonce must be 12 bytes");
    if (counter < 0 || counter > 0xFFFFFFFFu)
        throw std::invalid_argument("chacha20Ietf: counter out of uint32 range");

    auto out = makeBuffer(data->size());
    checkErr(::chacha20_ietf(key->data(),
                              nonce->data(),
                              static_cast<uint32_t>(counter),
                              data->data(),
                              data->size(),
                              out->data()),
             "chacha20Ietf failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::hmacSha256(
    const std::shared_ptr<ArrayBuffer>& key,
    const std::shared_ptr<ArrayBuffer>& data) {

    auto out = makeBuffer(32);
    checkErr(::hmac_sha256(key->data(), key->size(),
                            data->data(), data->size(),
                            out->data()),
             "hmacSha256 failed");
    return out;
}

std::shared_ptr<ArrayBuffer> HybridCashuCrypto::pbkdf2HmacSha512(
    const std::shared_ptr<ArrayBuffer>& password,
    const std::shared_ptr<ArrayBuffer>& salt,
    double iterations,
    double dkLen) {

    // Validate at the bridge boundary so the C side can assume a
    // sane envelope. BIP-39 uses (2048, 64); the upper bounds here
    // are deliberately generous but still guard against accidental
    // huge values that would peg the JS thread.
    if (!std::isfinite(iterations) || iterations < 1.0 || iterations > 10000000.0)
        throw std::invalid_argument("pbkdf2HmacSha512: iterations out of range");
    if (!std::isfinite(dkLen) || dkLen < 1.0 || dkLen > 4096.0)
        throw std::invalid_argument("pbkdf2HmacSha512: dkLen out of range");

    auto iter32 = static_cast<uint32_t>(iterations);
    auto dk32   = static_cast<uint32_t>(dkLen);

    auto out = makeBuffer(dk32);
    checkErr(::pbkdf2_hmac_sha512(password->data(), password->size(),
                                   salt->data(), salt->size(),
                                   iter32, dk32, out->data()),
             "pbkdf2HmacSha512 failed");
    return out;
}

} // namespace margelo::nitro::nutpatch

//
// Created by d4rp4t on 01/04/2026.
//

#pragma once

#include "../../nitrogen/generated/shared/c++/HybridCryptoSpec.hpp"
#include <NitroModules/ArrayBuffer.hpp>
#include <vector>

namespace margelo::nitro::nutpatch {

using namespace margelo::nitro;

class HybridCashuCrypto : public HybridCryptoSpec {
public:
    HybridCashuCrypto();
    ~HybridCashuCrypto() override;

    std::shared_ptr<ArrayBuffer> hashToCurve(const std::shared_ptr<ArrayBuffer>& message) override;
    std::shared_ptr<ArrayBuffer> blind(const std::shared_ptr<ArrayBuffer>& message,
                                       const std::shared_ptr<ArrayBuffer>& blindingFactor) override;
    std::shared_ptr<ArrayBuffer> unblind(const std::shared_ptr<ArrayBuffer>& blindedSignature,
                                          const std::shared_ptr<ArrayBuffer>& blindingFactor,
                                          const std::shared_ptr<ArrayBuffer>& mintPubkey) override;

    std::shared_ptr<ArrayBuffer> computeSha256(const std::shared_ptr<ArrayBuffer>& message) override;
    std::shared_ptr<ArrayBuffer> hashE(const std::vector<std::shared_ptr<ArrayBuffer>>& pubkeys) override;

    std::shared_ptr<ArrayBuffer> schnorrSign(const std::shared_ptr<ArrayBuffer>& seckey,
                                              const std::shared_ptr<ArrayBuffer>& msg) override;
    bool schnorrVerify(const std::shared_ptr<ArrayBuffer>& sig,
                       const std::shared_ptr<ArrayBuffer>& msg,
                       const std::shared_ptr<ArrayBuffer>& xonlyPubkey) override;

    std::shared_ptr<ArrayBuffer> seckeyGenerate() override;
    std::shared_ptr<ArrayBuffer> createBlindSignature(const std::shared_ptr<ArrayBuffer>& B_,
                                                       const std::shared_ptr<ArrayBuffer>& seckey) override;

    bool verifyDleqProof(const std::shared_ptr<ArrayBuffer>& B_,
                         const std::shared_ptr<ArrayBuffer>& C_,
                         const std::shared_ptr<ArrayBuffer>& A,
                         const std::shared_ptr<ArrayBuffer>& s,
                         const std::shared_ptr<ArrayBuffer>& e) override;
    std::shared_ptr<ArrayBuffer> createDleqProof(const std::shared_ptr<ArrayBuffer>& B_,
                                                  const std::shared_ptr<ArrayBuffer>& seckey) override;

    std::shared_ptr<ArrayBuffer> batchDeriveLegacy(const std::shared_ptr<ArrayBuffer>& seed,
                                                    double keysetIdInt,
                                                    double startCounter,
                                                    double count) override;

    std::shared_ptr<ArrayBuffer> batchUnblind(
        const std::vector<std::shared_ptr<ArrayBuffer>>& blindedSignatures,
        const std::vector<std::shared_ptr<ArrayBuffer>>& blindingFactors,
        const std::shared_ptr<ArrayBuffer>& mintPubkey);

    // NIP-44 v2 raw-X ECDH — used by Nostr's NIP-44/NIP-17 message
    // encryption to derive the conversation key. See `crypto.h` for the
    // motivation behind exposing a non-default ECDH variant. NOTE: these
    // overrides depend on the Crypto.nitro.ts spec being regenerated via
    // `bun nitrogen` so HybridCryptoSpec exposes the matching pure-virtual
    // declarations — without that step the build will fail with "marked
    // override but does not override".
    std::shared_ptr<ArrayBuffer> ecdhNip44(const std::shared_ptr<ArrayBuffer>& seckey,
                                            const std::shared_ptr<ArrayBuffer>& xonlyPubkey) override;

    std::shared_ptr<ArrayBuffer> batchEcdhNip44(
        const std::shared_ptr<ArrayBuffer>& seckey,
        const std::vector<std::shared_ptr<ArrayBuffer>>& xonlyPubkeys) override;

    // Symmetric primitives for NIP-44 v2 — chacha20 cipher and HMAC-SHA256
    // for authentication / HKDF. JS layers HKDF-expand and the full
    // NIP-44 v2 decrypt orchestration on top of these. See
    // `shared/lib/nostr/nip44Native.ts` for the consumer.
    std::shared_ptr<ArrayBuffer> chacha20Ietf(
        const std::shared_ptr<ArrayBuffer>& key,
        const std::shared_ptr<ArrayBuffer>& nonce,
        double counter,
        const std::shared_ptr<ArrayBuffer>& data) override;

    std::shared_ptr<ArrayBuffer> hmacSha256(
        const std::shared_ptr<ArrayBuffer>& key,
        const std::shared_ptr<ArrayBuffer>& data) override;

    // PBKDF2-HMAC-SHA512 — drives BIP-39 mnemonicToSeed (c=2048, dkLen=64).
    // Pure-JS PBKDF2-SHA512 takes ~3 s on Hermes per cold-boot profile load;
    // native drops it below 50 ms. See `shared/lib/nostr/keyDerivation.ts`
    // for the consumer.
    std::shared_ptr<ArrayBuffer> pbkdf2HmacSha512(
        const std::shared_ptr<ArrayBuffer>& password,
        const std::shared_ptr<ArrayBuffer>& salt,
        double iterations,
        double dkLen) override;
};

} // namespace margelo::nitro::nutpatch

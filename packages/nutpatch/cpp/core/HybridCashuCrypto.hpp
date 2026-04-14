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
};

} // namespace margelo::nitro::nutpatch

import { defaultCredentialTypes, defaultCryptoProvider, } from "ts-mls";
import { generateKeyPackage as MLSGenerateKeyPackage, makeKeyPackageRef, } from "ts-mls/keyPackage.js";
import { createThreeMonthLifetime } from "../utils/timestamp.js";
import { ensureMarmotCapabilities } from "./capabilities.js";
import { getCredentialPubkey } from "./credential.js";
import { defaultCapabilities } from "./default-capabilities.js";
import { ensureLastResortExtension } from "./extensions.js";
/** Create default extensions for a key package */
export function keyPackageDefaultExtensions() {
    return ensureLastResortExtension([]);
}
/** Calculates a key package reference with the hash implementation based on the key package's cipher suite */
export async function calculateKeyPackageRef(keyPackage, cryptoProvider) {
    // In v2, keyPackage.cipherSuite is a numeric ciphersuite id.
    // Prefer id-first handling to avoid reverse mapping name<->id for correctness.
    const provider = cryptoProvider ?? defaultCryptoProvider;
    const ciphersuiteImpl = await provider.getCiphersuiteImpl(keyPackage.cipherSuite);
    return await makeKeyPackageRef(keyPackage, ciphersuiteImpl.hash);
}
/** Generate a marmot key package that is compliant with MIP-00 */
export async function generateKeyPackage({ credential, capabilities, lifetime, extensions, isLastResort = true, ciphersuiteImpl, }) {
    if (credential.credentialType !== defaultCredentialTypes.basic)
        throw new Error("Marmot key packages must use a basic credential");
    // Ensure the credential has a valid pubkey
    getCredentialPubkey(credential);
    // In v2, generateKeyPackage takes a single params object
    return await MLSGenerateKeyPackage({
        credential,
        capabilities: capabilities
            ? ensureMarmotCapabilities(capabilities)
            : defaultCapabilities(),
        lifetime: lifetime ?? createThreeMonthLifetime(),
        // Marmot requires support for last_resort capability signaling (MIP-00),
        // but individual KeyPackages may be single-use or last-resort reusable.
        // `isLastResort` controls whether this KeyPackage is marked reusable.
        extensions: isLastResort
            ? ensureLastResortExtension(extensions ?? [])
            : extensions,
        cipherSuite: ciphersuiteImpl,
    });
}
//# sourceMappingURL=key-package.js.map
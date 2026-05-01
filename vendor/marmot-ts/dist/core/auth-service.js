import { defaultCredentialTypes, } from "ts-mls";
/** Marmot credential policy (MIP-00): `basic` credential with 32-byte identity. */
export const marmotAuthService = {
    async validateCredential(credential, _signaturePublicKey) {
        if (credential.credentialType !== defaultCredentialTypes.basic)
            return false;
        const basic = credential;
        if (!(basic.identity instanceof Uint8Array))
            return false;
        if (basic.identity.length !== 32)
            return false;
        return true;
    },
};
//# sourceMappingURL=auth-service.js.map
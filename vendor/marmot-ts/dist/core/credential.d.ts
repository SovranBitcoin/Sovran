import { Credential, CredentialBasic } from "ts-mls/credential.js";
export declare function isHexKey(str: string): boolean;
/** Creates a MLS basic credential from a nostr public key. */
export declare function createCredential(pubkey: string): CredentialBasic;
/** Gets the nostr public key from a credential. */
export declare function getCredentialPubkey(credential: Credential): string;
/** Checks if two credentials are the same. */
export declare function isSameCredential(a: Credential, b: Credential): boolean;

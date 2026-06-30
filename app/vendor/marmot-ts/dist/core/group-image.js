/**
 * MIP-01 group image encryption and Blossom upload identity helpers.
 *
 * Provides ChaCha20-Poly1305 encryption/decryption for the group avatar image
 * stored on Blossom, and HKDF-based derivation of the Nostr keypair used to
 * authenticate uploads and deletions.
 *
 * No HTTP client is included. Callers are responsible for uploading encrypted
 * blobs to Blossom (or any content-addressed store).
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { expand as hkdf_expand } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { getPublicKey } from "applesauce-core/helpers";
// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
/** HKDF info label for MIP-01 Blossom upload keypair derivation. */
const MIP01_BLOSSOM_LABEL = enc.encode("mip01-blossom-upload-v1");
// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------
/**
 * Encrypts a group image using ChaCha20-Poly1305 (MIP-01).
 *
 * Generates cryptographically random `imageKey` and `imageNonce`, encrypts
 * the image, and pre-derives the Blossom upload keypair seed. All output
 * fields should be stored in `MarmotGroupData` via an MLS proposal/commit.
 *
 * @param imageData - The raw image bytes to encrypt
 * @returns Encryption outputs ready to store in `MarmotGroupData`
 */
export function encryptGroupImage(imageData) {
    const imageKey = randomBytes(32);
    const imageNonce = randomBytes(12);
    const encrypted = chacha20poly1305(imageKey, imageNonce).encrypt(imageData);
    const imageHash = sha256(encrypted);
    const imageUploadKey = hkdf_expand(sha256, imageKey, MIP01_BLOSSOM_LABEL, 32);
    return { encrypted, imageKey, imageNonce, imageHash, imageUploadKey };
}
/**
 * Decrypts a group image using fields from `MarmotGroupData` (MIP-01).
 *
 * @param encrypted - The encrypted blob downloaded from Blossom
 * @param imageKey - `MarmotGroupData.imageKey` (32 bytes)
 * @param imageNonce - `MarmotGroupData.imageNonce` (12 bytes)
 * @returns The decrypted image bytes
 * @throws If AEAD authentication or decryption fails
 */
export function decryptGroupImage(encrypted, imageKey, imageNonce) {
    return chacha20poly1305(imageKey, imageNonce).decrypt(encrypted);
}
/**
 * Derives the Nostr keypair used to authenticate Blossom upload/delete
 * requests for a group image (MIP-01).
 *
 * Derivation:
 * ```
 * upload_secret = HKDF-Expand(imageKey, "mip01-blossom-upload-v1", 32)
 * upload_keypair = secp256k1_keypair_from_secret(upload_secret)
 * ```
 *
 * This is the same value stored in `MarmotGroupData.imageUploadKey`. The
 * function exists so callers can re-derive the keypair from a previously
 * stored `imageKey` at any time — for example, to delete an old image blob
 * from Blossom after updating the group avatar.
 *
 * @param imageKey - `MarmotGroupData.imageKey` (32 bytes)
 * @returns The Blossom upload/delete keypair
 */
export function deriveGroupImageBlossomAuthKeypair(imageKey) {
    const secretKey = hkdf_expand(sha256, imageKey, MIP01_BLOSSOM_LABEL, 32);
    const pubkey = getPublicKey(secretKey);
    return { secretKey, pubkey };
}
//# sourceMappingURL=group-image.js.map
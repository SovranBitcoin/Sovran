/**
 * MIP-04 chat media encryption helpers.
 *
 * Provides per-file key derivation from the MLS epoch's exporter secret and
 * ChaCha20-Poly1305 AEAD encryption/decryption for media files shared in
 * Marmot group messages via `imeta` tags.
 *
 * No HTTP client is included. Callers are responsible for uploading encrypted
 * blobs to Blossom (or any content-addressed store) and building/parsing
 * `imeta` tags using applesauce helpers such as `createImetaTagForAttachment`
 * and `getFileMetadataFromImetaTag`.
 *
 * For group avatar image encryption see {@link ./group-image.js}.
 */
import type { CiphersuiteImpl } from "ts-mls/crypto/ciphersuite.js";
import type { ClientState } from "ts-mls/clientState.js";
import type { FileMetadata } from "applesauce-common/helpers";
import type { NostrEvent } from "applesauce-core/helpers";
/** The version string written to the `v` field of MIP-04 imeta tags. */
export declare const MIP04_VERSION: "mip04-v2";
/**
 * MIP-04 media attachment — a {@link FileMetadata} extended with the extra
 * fields required by the MIP-04 v2 encryption scheme.
 *
 * Use `createImetaTagForAttachment` from applesauce to serialize this into
 * an `imeta` tag for a group message, and `getFileMetadataFromImetaTag` to
 * parse it back. The `n` and `v` fields are passed through via the imeta
 * name-value pair format defined in NIP-92.
 */
export type MediaAttachment = Omit<FileMetadata, "sha256" | "type"> & Required<Pick<FileMetadata, "sha256" | "type">> & {
    /**
     * Original filename (e.g. `"photo.jpg"`).
     * Used in key derivation and AEAD associated data — must match exactly.
     */
    filename: string;
    /**
     * Hex-encoded 12-byte encryption nonce (24 hex characters).
     * Stored in the `n` field of the `imeta` tag.
     * Generated randomly by {@link encryptMediaFile} and required for decryption.
     */
    nonce: string;
    /**
     * MIP-04 encryption version. Always `"mip04-v2"` for new attachments.
     * Stored in the `v` field of the `imeta` tag.
     */
    version: typeof MIP04_VERSION;
};
/**
 * Result of {@link encryptMediaFile}.
 */
export type EncryptMediaFileResult = {
    /** The encrypted blob. Upload this to Blossom and use `SHA256(encrypted)` as the blob address. */
    encrypted: Uint8Array;
    /**
     * Populated {@link MediaAttachment} ready to be passed to
     * `createImetaTagForAttachment` (after setting the `url` field to the
     * Blossom upload URL).
     *
     * The `sha256` field contains the hex-encoded SHA-256 of the **plaintext**
     * file (the `x` imeta field), used for integrity verification after
     * decryption.
     *
     * The `nonce` field contains the hex-encoded 12-byte nonce used during
     * encryption.
     */
    attachment: MediaAttachment;
};
/**
 * Canonicalizes a MIME type for use in cryptographic operations (MIP-04).
 *
 * Rules (per MIP-04):
 * - Convert to lowercase
 * - Trim leading/trailing whitespace
 * - Strip parameters (everything after the first `;`)
 *
 * @param mimeType - The raw MIME type string
 * @returns The canonical MIME type
 */
export declare function canonicalizeMimeType(mimeType: string): string;
/**
 * Derives the per-file encryption key for a media file shared in a group
 * message (MIP-04 v2).
 *
 * Key derivation:
 * ```
 * exporter_secret = MLS-Exporter("marmot", "encrypted-media", 32)
 * context = "mip04-v2" || 0x00 || file_hash_bytes || 0x00 ||
 *           mime_type_bytes || 0x00 || filename_bytes || 0x00 || "key"
 * file_key = HKDF-Expand(exporter_secret, context, 32)
 * ```
 *
 * The key is deterministic for a given epoch + file, so re-encrypting the
 * same file in the same epoch produces the same key but a different
 * ciphertext (due to the random nonce).
 *
 * The `sha256`, `type`, and `filename` fields of the attachment must be set.
 * The MIME type is canonicalized automatically.
 *
 * @param clientState - The current MLS `ClientState` for the group
 * @param ciphersuite - The ciphersuite implementation used by the group
 * @param attachment - The attachment containing `sha256`, `type`, and `filename`
 * @returns 32-byte ChaCha20-Poly1305 encryption key
 */
export declare function deriveMediaEncryptionKey(clientState: ClientState, ciphersuite: CiphersuiteImpl, attachment: Pick<MediaAttachment, "sha256" | "type" | "filename">): Promise<Uint8Array>;
/**
 * Encrypts a media file for sharing in a Marmot group message (MIP-04 v2).
 *
 * Uses ChaCha20-Poly1305 AEAD with a randomly generated nonce. The
 * associated data (AAD) binds the scheme version, file hash, MIME type, and
 * filename to prevent metadata tampering.
 *
 * Typical usage:
 * ```ts
 * import { sha256 } from "@noble/hashes/sha2";
 * import { bytesToHex } from "@noble/hashes/utils";
 * import { createImetaTagForAttachment } from "applesauce-common/helpers";
 *
 * const attachment: Mip04MediaAttachment = {
 *   sha256: bytesToHex(sha256(fileBytes)),
 *   type: "image/jpeg",
 *   filename: "photo.jpg",
 *   nonce: "",          // filled by encryptMediaFile
 *   version: MIP04_VERSION,
 * };
 * const fileKey = await deriveMip04FileKey(clientState, ciphersuite, attachment);
 * const { encrypted, attachment: filled } = encryptMediaFile(fileBytes, fileKey, attachment);
 * // Upload `encrypted` to Blossom, then:
 * const imetaTag = createImetaTagForAttachment({ ...filled, url: blossomUrl });
 * ```
 *
 * @param file - The plaintext file bytes to encrypt
 * @param fileKey - 32-byte key from {@link deriveMediaEncryptionKey}
 * @param attachment - Attachment metadata; must have `sha256`, `type`, and `filename` set
 * @returns Encrypted blob and a fully populated {@link MediaAttachment}
 */
export declare function encryptMediaFile(file: Uint8Array, fileKey: Uint8Array, attachment: Pick<MediaAttachment, "sha256" | "type" | "filename"> & Partial<FileMetadata>): EncryptMediaFileResult;
/**
 * Decrypts a media file received in a Marmot group message (MIP-04 v2).
 *
 * Verifies the ChaCha20-Poly1305 authentication tag and then confirms the
 * SHA-256 of the decrypted content matches the `sha256` field from the
 * attachment, as required by MIP-04.
 *
 * The `sha256`, `type`, `filename`, and `nonce` fields must all be present.
 * Parse these from the `imeta` tag using `getFileMetadataFromImetaTag` from
 * applesauce, then cast/extend to {@link MediaAttachment}.
 *
 * @param encrypted - The encrypted blob downloaded from Blossom
 * @param fileKey - 32-byte key from {@link deriveMediaEncryptionKey}
 * @param attachment - The MIP-04 attachment from the group message's `imeta` tag
 * @returns The decrypted file bytes
 * @throws If AEAD authentication fails, required fields are missing, or the
 *         decrypted content hash does not match `attachment.sha256`
 */
export declare function decryptMediaFile(encrypted: Uint8Array, fileKey: Uint8Array, attachment: MediaAttachment): Uint8Array;
/**
 * Parses an `imeta` tag array into a {@link MediaAttachment}.
 *
 * The MIP-04-specific fields (`filename`, `n`, `v`) are read directly from
 * the raw tag entries because applesauce's {@link getFileMetadataFromImetaTag}
 * only copies known NIP-92 fields and silently drops unknown keys. Standard
 * NIP-92 fields (`url`, `type`/`m`, `sha256`/`x`, `size`, `dimensions`/`dim`,
 * `blurhash`, `thumbnail`/`thumb`, `alt`, etc.) are delegated to applesauce.
 *
 * Returns `null` if:
 * - The tag is not a valid `imeta` tag (first element is not `"imeta"`)
 * - The `v` field is absent or does not match {@link MIP04_VERSION}
 * - The `n` (nonce) field is absent or is not exactly 24 characters (hex-encoded 12-byte nonce)
 * - The `filename` field is absent or empty
 * - The `x` (sha256) field is absent or is not exactly 64 characters (hex-encoded 32-byte hash)
 * - The `m` (MIME type) field is absent or is not a valid `type/subtype` string
 *
 * Per the MIP-04 spec, clients MUST reject deprecated `mip04-v1` tags.
 *
 * @param tag - A raw `imeta` tag array from a Nostr event (e.g. `rumor.tags`)
 * @returns A fully-typed {@link MediaAttachment}, or `null` if the tag is
 *   not a valid MIP-04 v2 attachment
 */
export declare function parseMediaImetaTag(tag: string[]): MediaAttachment | null;
/**
 * Extracts all valid MIP-04 v2 attachments from a tag list.
 *
 * Non-`imeta` tags and `imeta` tags that fail MIP-04 validation (wrong or
 * absent `v` field, missing `n`/`filename`) are silently skipped.
 *
 * @param tags - The `tags` array from a Nostr event or rumor
 * @returns Array of valid {@link MediaAttachment} objects (may be empty)
 */
export declare function getMediaAttachments(tags: string[][]): MediaAttachment[];
/**
 * Extracts a MIP-04 v2 attachment from a NIP-94 kind 1063 file-metadata event.
 *
 * Kind 1063 events use flat tags (`url`, `m`, `x`, `filename`, `n`, `v`, …)
 * rather than the space-separated `imeta` format. Standard NIP-94 fields are
 * parsed by applesauce's {@link getFileMetadata}; the MIP-04-specific fields
 * (`filename`, `n`, `v`) are read directly from the flat tag list.
 *
 * Returns `null` if:
 * - The `v` tag is absent or does not match {@link MIP04_VERSION}
 * - The `n` (nonce) tag is absent or is not exactly 24 characters (hex-encoded 12-byte nonce)
 * - The `filename` tag is absent or empty
 * - The `x` (sha256) tag is absent or is not exactly 64 characters (hex-encoded 32-byte hash)
 * - The `m` (MIME type) tag is absent or is not a valid `type/subtype` string
 *
 * @param event - A kind 1063 Nostr event
 * @returns A fully-typed {@link MediaAttachment}, or `null` if the event
 *   does not carry a valid MIP-04 v2 attachment
 */
export declare function getMediaAttachmentFromFileEvent(event: NostrEvent): MediaAttachment | null;

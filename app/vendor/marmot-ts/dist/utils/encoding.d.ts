import { Rumor } from "applesauce-common/helpers/gift-wrap";
import { NostrEvent } from "applesauce-core/helpers/event";
/**
 * Encoding format for binary content in Nostr events.
 * - 'base64': Base64 encoding (~33% smaller, required for new implementations)
 * - 'hex': Hexadecimal encoding (deprecated, supported for backward compatibility)
 */
export type EncodingFormat = "base64" | "hex";
/**
 * Encodes binary data to a string using the specified format.
 *
 * @param bytes - The binary data to encode
 * @param format - The encoding format ('base64' or 'hex')
 * @returns The encoded string
 */
export declare function encodeContent(bytes: Uint8Array, format: EncodingFormat): string;
/**
 * Decodes a string to binary data using the specified or auto-detected format.
 *
 * @param content - The encoded string
 * @param format - Optional encoding format. If not specified, will auto-detect.
 * @returns The decoded binary data
 * @throws Error if the content cannot be decoded
 */
export declare function decodeContent(content: string, format?: EncodingFormat): Uint8Array;
/**
 * Detects the encoding format of a content string.
 *
 * @param content - The encoded string to analyze
 * @returns The detected encoding format
 */
export declare function detectEncoding(content: string): EncodingFormat;
/**
 * Extracts the encoding tag from a Nostr event.
 *
 * @param event - The Nostr event to check
 * @returns The encoding format specified in the event, or undefined if not present
 */
export declare function getEncodingTag(event: NostrEvent | Rumor): EncodingFormat | undefined;

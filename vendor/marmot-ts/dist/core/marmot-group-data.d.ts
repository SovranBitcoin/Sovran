import { type CustomExtension, type GroupContextExtension } from "ts-mls";
import { MarmotGroupData } from "./protocol.js";
/**
 * Encodes MarmotGroupData to bytes.
 *
 * @param data - The MarmotGroupData to encode
 * @returns Encoded bytes
 */
export declare function encodeMarmotGroupData(data: MarmotGroupData): Uint8Array;
/**
 * Decodes MarmotGroupData from bytes.
 *
 * @param data - The bytes to decode
 * @returns Decoded MarmotGroupData
 * @throws Error if decoding fails
 */
export declare function decodeMarmotGroupData(data: Uint8Array): MarmotGroupData;
export type CreateMarmotGroupDataOptions = Partial<Omit<MarmotGroupData, "version">>;
/** Creates a valid MarmotGroupData byte payload (MIP-01). */
export declare function createMarmotGroupData(opts?: CreateMarmotGroupDataOptions): Uint8Array;
/** Returns true if pubkey is included in adminPubkeys (case-insensitive). */
export declare function isAdmin(groupData: MarmotGroupData, pubkey: string): boolean;
/**
 * Converts MarmotGroupData to an Extension object for use in MLS groups.
 *
 * @param data - The Marmot group data to convert
 * @returns Extension object with Marmot Group Data Extension type and encoded data
 */
export declare function marmotGroupDataToExtension(data: MarmotGroupData): GroupContextExtension;
/** Type guard for the Marmot Group Data custom extension (0xf2ee). */
export declare function isMarmotGroupDataExtension(ext: GroupContextExtension): ext is CustomExtension;
/** Extracts and validates the Marmot Group Data extension payload bytes. */
export declare function getMarmotGroupDataExtensionBytes(ext: GroupContextExtension): Uint8Array;

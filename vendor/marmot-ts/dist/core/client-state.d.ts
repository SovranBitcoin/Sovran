import { ClientState, GroupInfo } from "ts-mls";
import { MarmotGroupData } from "./protocol.js";
/** Default ClientConfig for Marmot. */
export declare const defaultMarmotClientConfig: {
    keyRetentionConfig: import("ts-mls").KeyRetentionConfig;
    lifetimeConfig: import("ts-mls").LifetimeConfig;
    keyPackageEqualityConfig: import("ts-mls").KeyPackageEqualityConfig;
    paddingConfig: import("ts-mls").PaddingConfig;
};
/** Reads the MarmotGroupData from a ClientState or GroupInfo objects */
export declare function getMarmotGroupData(clientState: ClientState | GroupInfo): MarmotGroupData | null;
/** @deprecated use getMarmotGroupData instead */
export declare const extractMarmotGroupData: typeof getMarmotGroupData;
/** Reads the hex id of the group from a ClientState or GroupInfo object */
export declare function getGroupIdHex(clientState: ClientState | GroupInfo): string;
export declare function getNostrGroupIdHex(clientState: ClientState): string;
/** Reads the epoch number from a ClientState or GroupInfo object */
export declare function getEpoch(clientState: ClientState | GroupInfo): number;
/** Reads the number of members in the group from a ClientState ratchet tree */
export declare function getMemberCount(clientState: ClientState): number;
/** The serialized form of ClientState for storage (ts-mls TLS encoding). */
export type SerializedClientState = Uint8Array;
/** Serializes a ClientState object to a bytes array */
export declare function serializeClientState(state: ClientState): SerializedClientState;
/** Deserializes stored ClientState bytes (ts-mls TLS decoding). */
export declare function deserializeClientState(stored: SerializedClientState): ClientState;

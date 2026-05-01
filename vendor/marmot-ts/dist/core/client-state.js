import { bytesToHex } from "@noble/hashes/utils.js";
import { decode, encode, nodeTypes } from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { clientStateDecoder, clientStateEncoder } from "ts-mls/clientState.js";
import { decodeMarmotGroupData, isMarmotGroupDataExtension, } from "./marmot-group-data.js";
/** Default ClientConfig for Marmot. */
export const defaultMarmotClientConfig = {
    ...defaultClientConfig,
};
/** Reads the MarmotGroupData from a ClientState or GroupInfo objects */
export function getMarmotGroupData(clientState) {
    try {
        const marmotExtension = clientState.groupContext.extensions.find(isMarmotGroupDataExtension);
        if (!marmotExtension)
            return null;
        return decodeMarmotGroupData(marmotExtension.extensionData);
    }
    catch (error) {
        return null;
    }
}
/** @deprecated use getMarmotGroupData instead */
export const extractMarmotGroupData = getMarmotGroupData;
/** Reads the hex id of the group from a ClientState or GroupInfo object */
export function getGroupIdHex(clientState) {
    return bytesToHex(clientState.groupContext.groupId);
}
export function getNostrGroupIdHex(clientState) {
    const marmotData = getMarmotGroupData(clientState);
    if (!marmotData)
        throw new Error("MarmotGroupData not found in ClientState");
    return bytesToHex(marmotData.nostrGroupId);
}
/** Reads the epoch number from a ClientState or GroupInfo object */
export function getEpoch(clientState) {
    return Number(clientState.groupContext.epoch);
}
/** Reads the number of members in the group from a ClientState ratchet tree */
export function getMemberCount(clientState) {
    return clientState.ratchetTree.filter((node) => node && node.nodeType === nodeTypes.leaf).length;
}
/** Serializes a ClientState object to a bytes array */
export function serializeClientState(state) {
    return encode(clientStateEncoder, state);
}
/** Deserializes stored ClientState bytes (ts-mls TLS decoding). */
export function deserializeClientState(stored) {
    try {
        const decoded = decode(clientStateDecoder, stored);
        if (!decoded)
            throw new Error("Failed to deserialize ClientState: clientStateDecoder returned null");
        return decoded;
    }
    catch (error) {
        if (error instanceof Error)
            throw new Error(`Failed to deserialize ClientState: ${error.message}`);
        throw new Error("Failed to deserialize ClientState: Unknown error");
    }
}
//# sourceMappingURL=client-state.js.map
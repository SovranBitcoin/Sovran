import { ClientState, Credential } from "ts-mls";
import { LeafNode } from "ts-mls/leafNode.js";
/** Gets all the nostr pubkey keys in a group */
export declare function getGroupMembers(state: ClientState): string[];
/** Gets all leaf nodes for a given nostr pubkey in a group */
export declare function getPubkeyLeafNodes(state: ClientState, pubkey: string): LeafNode[];
/**
 * Gets all leaf node indexes for a given nostr pubkey in a group.
 *
 * @param state - The ClientState to search
 * @param pubkey - The nostr pubkey to find
 * @returns Array of leaf node indexes (numbers) for the given pubkey
 */
export declare function getPubkeyLeafNodeIndexes(state: ClientState, pubkey: string): number[];
/**
 * Gets all leaf node indexes for a given credential in a group.
 *
 * @param state - The ClientState to search
 * @param credential - The credential to find
 * @returns Array of leaf node indexes (numbers) for the given credential
 */
export declare function getCredentialLeafNodeIndexes(state: ClientState, credential: Credential): number[];

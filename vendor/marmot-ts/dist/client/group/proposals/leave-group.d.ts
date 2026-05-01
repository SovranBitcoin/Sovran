import { ProposalRemove } from "ts-mls/proposal.js";
import { ProposalAction } from "../marmot-group.js";
/**
 * Proposes removing all leaf nodes belonging to the given pubkey from the
 * group. Intended for self-removal (leaving), where the caller passes their
 * own public key.
 *
 * Per RFC 9420 §12.4 a member cannot *commit* a Remove targeting their own
 * leaf — the resulting proposals must be committed by another member (e.g.
 * an admin calling {@link MarmotGroup.commit}).
 *
 * @param pubkey - The Nostr public key (hex string) of the member leaving.
 * @returns A {@link ProposalAction} that yields one {@link ProposalRemove}
 *   per leaf node found for the given pubkey.
 */
export declare function proposeLeaveGroup(pubkey: string): ProposalAction<ProposalRemove[]>;

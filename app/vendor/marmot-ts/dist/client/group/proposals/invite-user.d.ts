import { NostrEvent } from "applesauce-core/helpers/event";
import { ProposalAdd, type KeyPackage } from "ts-mls";
import { ProposalAction } from "../marmot-group.js";
/** Builds a proposal to invite a user to the group from a key package event or raw key package */
export declare function proposeInviteUser(keyPackageEvent: KeyPackage | NostrEvent): ProposalAction<ProposalAdd>;

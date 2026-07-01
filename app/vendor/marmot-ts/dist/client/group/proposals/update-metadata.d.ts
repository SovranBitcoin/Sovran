import { type ProposalGroupContextExtensions } from "ts-mls/proposal.js";
import { MarmotGroupData } from "../../../core/protocol.js";
import type { ProposalAction } from "../marmot-group.js";
/** Builds a proposal to update a group's marmot group data extension */
export declare function proposeUpdateMetadata(metadata: Partial<MarmotGroupData>): ProposalAction<ProposalGroupContextExtensions>;

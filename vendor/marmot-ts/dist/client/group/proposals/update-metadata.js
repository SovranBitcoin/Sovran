import { defaultProposalTypes } from "ts-mls";
import { replaceExtension } from "../../../core/extensions.js";
import { marmotGroupDataToExtension } from "../../../core/marmot-group-data.js";
/** Builds a proposal to update a group's marmot group data extension */
export function proposeUpdateMetadata(metadata) {
    return async ({ state, groupData }) => {
        // Create updated group data, preserving existing values for unchanged fields
        const updatedGroupData = {
            ...groupData,
            ...metadata,
        };
        // Convert to MLS extension
        const updatedExtension = marmotGroupDataToExtension(updatedGroupData);
        return {
            proposalType: defaultProposalTypes.group_context_extensions,
            groupContextExtensions: {
                // Replace the marmot group data extension with the updated one
                extensions: replaceExtension(state.groupContext.extensions, updatedExtension),
            },
        };
    };
}
//# sourceMappingURL=update-metadata.js.map
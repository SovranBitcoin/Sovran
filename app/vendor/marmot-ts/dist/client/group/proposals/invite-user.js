import { isEvent } from "applesauce-core/helpers/event";
import { defaultProposalTypes } from "ts-mls";
import { getKeyPackage } from "../../../core/key-package-event.js";
/** Builds a proposal to invite a user to the group from a key package event or raw key package */
export function proposeInviteUser(keyPackageEvent) {
    return async () => {
        const keyPackage = isEvent(keyPackageEvent)
            ? getKeyPackage(keyPackageEvent)
            : keyPackageEvent;
        return {
            proposalType: defaultProposalTypes.add,
            add: { keyPackage },
        };
    };
}
//# sourceMappingURL=invite-user.js.map
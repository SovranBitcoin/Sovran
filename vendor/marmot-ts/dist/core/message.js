import { wireformats } from "ts-mls";
/** Check if a MLSMessage is a private message */
export function isPrivateMessage(message) {
    return message.wireformat === wireformats.mls_private_message;
}
//# sourceMappingURL=message.js.map
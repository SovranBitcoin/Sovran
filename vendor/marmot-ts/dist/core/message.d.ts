import { MlsMessage, MlsMessageProtocol, MlsPrivateMessage } from "ts-mls/message.js";
export type PrivateMessage = MlsMessageProtocol & MlsPrivateMessage;
/** Check if a MLSMessage is a private message */
export declare function isPrivateMessage(message: MlsMessage): message is PrivateMessage;

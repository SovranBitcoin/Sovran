import { CiphersuiteImpl } from "ts-mls";
import { ClientState } from "ts-mls/clientState.js";
import { GroupContextExtension } from "ts-mls";
import { CompleteKeyPackage } from "./key-package.js";
import { MarmotGroupData } from "./protocol.js";
export interface CreateGroupParams {
    /** Creator's complete key package (public + private) */
    creatorKeyPackage: CompleteKeyPackage;
    /** Marmot Group Data configuration */
    marmotGroupData: MarmotGroupData;
    /** Additional group context extensions (optional) */
    extensions?: GroupContextExtension[];
    /** Cipher suite implementation for cryptographic operations */
    ciphersuiteImpl: CiphersuiteImpl;
}
export interface CreateGroupResult {
    /** The ClientState for the created group */
    clientState: ClientState;
}
export declare function createGroup(params: CreateGroupParams): Promise<CreateGroupResult>;
export type SimpleGroupOptions = {
    description?: string;
    adminPubkeys?: string[];
    relays?: string[];
};
export declare function createSimpleGroup(creatorKeyPackage: CompleteKeyPackage, ciphersuiteImpl: CiphersuiteImpl, groupName?: string, options?: SimpleGroupOptions): Promise<CreateGroupResult>;

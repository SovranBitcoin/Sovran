import { type CustomExtension } from "ts-mls";
/**
 * Validates that a key package supports the required Marmot extensions.
 *
 * @param extensions - The extensions from a key package
 * @returns true if the Marmot Group Data Extension is supported
 */
export declare function supportsMarmotExtensions(extensions: Array<{
    extensionType: number;
}>): boolean;
/** Checks if an extension is the last_resort extension */
export declare function isLastResortExtension(extension: CustomExtension): extension is CustomExtension;
/**
 * Modifies an {@link Extension} array to ensure it includes the last_resort extension.
 * This is useful for ensuring that key packages are compliant with MIP-00.
 *
 * @param extensions - The extensions to modify
 * @returns The modified extensions
 */
export declare function ensureLastResortExtension(extensions: CustomExtension[]): CustomExtension[];
/** Replaces an extension in an array of extensions */
export declare function replaceExtension(extensions: Array<{
    extensionType: number;
}>, extension: {
    extensionType: number;
}): Array<{
    extensionType: number;
}>;

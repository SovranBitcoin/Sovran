import { useCallback } from 'react';
import { mnemonicToSeedSync } from 'bip39';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '@noble/secp256k1';

/**
 * Custom hook for specialized Cashu functions
 * This replaces specialized functions from cashuClient.ts that aren't in the main Coco API
 */
export function useCashuSpecialized() {
  /**
   * Derive mint backup keys from mnemonic
   * This replaces the old deriveMintBackupKeys function
   */
  const deriveMintBackupKeys = useCallback(
    (
      mnemonic: string
    ): {
      privateKeyHex: string;
      publicKeyHex: string;
      privateKeyBytes: Uint8Array;
    } => {
      // Derive seed from mnemonic
      const seed: Uint8Array = mnemonicToSeedSync(mnemonic);
      const domainSeparator = new TextEncoder().encode('cashu-mint-backup');
      const combinedData = new Uint8Array(seed.length + domainSeparator.length);
      combinedData.set(seed);
      combinedData.set(domainSeparator, seed.length);

      // Use SHA256 of combined data as private key
      const privateKeyBytes = sha256(combinedData);
      const privateKeyHex = bytesToHex(privateKeyBytes);
      const publicKeyHex = bytesToHex(getPublicKey(privateKeyBytes));

      return { privateKeyHex, privateKeyBytes, publicKeyHex };
    },
    []
  );

  /**
   * Check if a token has already been redeemed
   * This replaces the old checkIfAlreadyRedeemed function
   */
  const checkIfAlreadyRedeemed = useCallback((token: string): boolean => {
    // This would need to check against a database of redeemed tokens
    // For now, return false as a placeholder
    return false;
  }, []);

  return {
    deriveMintBackupKeys,
    checkIfAlreadyRedeemed,
  };
}

// Export the function directly for use in non-React contexts
export const deriveMintBackupKeys = (
  mnemonic: string
): {
  privateKeyHex: string;
  publicKeyHex: string;
  privateKeyBytes: Uint8Array;
} => {
  // Derive seed from mnemonic
  const seed: Uint8Array = mnemonicToSeedSync(mnemonic);
  const domainSeparator = new TextEncoder().encode('cashu-mint-backup');
  const combinedData = new Uint8Array(seed.length + domainSeparator.length);
  combinedData.set(seed);
  combinedData.set(domainSeparator, seed.length);

  // Use SHA256 of combined data as private key
  const privateKeyBytes = sha256(combinedData);
  const privateKeyHex = bytesToHex(privateKeyBytes);
  const publicKeyHex = bytesToHex(getPublicKey(privateKeyBytes));

  return { privateKeyHex, privateKeyBytes, publicKeyHex };
};

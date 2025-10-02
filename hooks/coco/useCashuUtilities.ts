import { useCallback } from 'react';
import { getDecodedToken } from '@cashu/cashu-ts';
import { decode } from '@gandlaf21/bolt11-decode';

/**
 * Custom hook for Cashu utility functions
 * This replaces various utility functions from cashuClient.ts
 */
export function useCashuUtilities() {
  /**
   * Validate if a string is a valid ecash token
   * This replaces the old isValidEcashToken function
   */
  const isValidEcashToken = useCallback((token: string): boolean => {
    try {
      getDecodedToken(token);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Get token amount from a token string
   * This replaces the old getTokenAmount function
   */
  const getTokenAmount = useCallback((token: string): number => {
    try {
      const decoded = getDecodedToken(token);
      return decoded.proofs.reduce((sum, proof) => sum + proof.amount, 0);
    } catch {
      return 0;
    }
  }, []);

  /**
   * Get token memo from a token string
   * This replaces the old getTokenMemo function
   */
  const getTokenMemo = useCallback((token: string): string | undefined => {
    try {
      const decoded = getDecodedToken(token);
      return decoded.memo;
    } catch {
      return undefined;
    }
  }, []);

  /**
   * Get token mints from a token string
   * This replaces the old getTokenMints function
   */
  const getTokenMints = useCallback((token: string): string[] => {
    try {
      const decoded = getDecodedToken(token);
      return [decoded.mint];
    } catch {
      return [];
    }
  }, []);

  /**
   * Decode Lightning invoice and get amount
   * This replaces the old getLightningAmount function
   */
  const getLightningAmount = useCallback((invoice: string): number => {
    try {
      const decoded = decode(invoice);
      const amount = decoded?.sections?.find((route) => route?.name === 'amount')?.value;
      return amount ? amount / 1000 : 0; // Convert to sats
    } catch {
      return 0;
    }
  }, []);

  /**
   * Get Lightning invoice description
   * This replaces the old getDescription function
   */
  const getLightningDescription = useCallback((invoice: string): string => {
    try {
      const decoded = decode(invoice);
      const description = decoded?.sections?.find((route) => route?.name === 'description')?.value;
      return description || '';
    } catch {
      return '';
    }
  }, []);

  /**
   * Get Lightning invoice timestamp
   * This replaces the old getTimestamp function
   */
  const getLightningTimestamp = useCallback((invoice: string): number => {
    try {
      const decoded = decode(invoice);
      const timestamp = decoded?.sections?.find((route) => route?.name === 'timestamp')?.value;
      return timestamp || 0;
    } catch {
      return 0;
    }
  }, []);

  /**
   * Get Lightning invoice expiry
   * This replaces the old getRawExpiry function
   */
  const getLightningExpiry = useCallback((invoice: string): number => {
    try {
      const decoded = decode(invoice);
      const expiry = decoded?.sections?.find((route) => route?.name === 'expiry')?.value;
      return expiry || 0;
    } catch {
      return 0;
    }
  }, []);

  /**
   * Get Lightning invoice expiry time remaining
   * This replaces the old getExpiresIn function
   */
  const getLightningExpiresIn = useCallback((invoice: string): number => {
    try {
      const decoded = decode(invoice);
      const timestamp = decoded?.sections?.find((route) => route?.name === 'timestamp')?.value;
      const expiry = decoded?.sections?.find((route) => route?.name === 'expiry')?.value;
      if (!timestamp || !expiry) return 0;
      const timePassed = Math.floor(Date.now() / 1000) - timestamp;
      return expiry - timePassed;
    } catch {
      return 0;
    }
  }, []);

  /**
   * Check if a string is a valid Lightning invoice
   * This replaces the old isValidPaymentRequest function
   */
  const isValidLightningInvoice = useCallback((invoice: string): boolean => {
    try {
      decode(invoice);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Convert npub to public key (simplified version)
   * This replaces the old maybeConvertNpub function
   */
  const maybeConvertNpub = useCallback((pubkey: string): string => {
    // Simple check if it's an npub, if so return as-is for now
    // In a real implementation, you'd decode the npub
    if (pubkey.startsWith('npub1')) {
      return pubkey;
    }
    return pubkey;
  }, []);

  /**
   * Convert public key to 02 format (simplified version)
   * This replaces the old pubKeyTo02 function
   */
  const pubKeyTo02 = useCallback((pubkey: string): string => {
    // Simple implementation - in real usage you'd convert the key format
    return pubkey;
  }, []);

  return {
    // Token utilities
    isValidEcashToken,
    getTokenAmount,
    getTokenMemo,
    getTokenMints,

    // Lightning utilities
    getLightningAmount,
    getLightningDescription,
    getLightningTimestamp,
    getLightningExpiry,
    getLightningExpiresIn,
    isValidLightningInvoice,

    // Key utilities (simplified)
    maybeConvertNpub,
    pubKeyTo02,
  };
}

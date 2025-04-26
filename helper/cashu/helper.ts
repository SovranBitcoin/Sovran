import { CashuMint, decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';
import _ from 'lodash';
import { getWallet } from 'helper/cashu';

/**
 * Checks if a token has been spent
 */
export async function checkTokenSpent({ token }) {
  const decodedToken = getDecodedToken(token);
  const { unit, mint, proofs } = decodedToken;

  const wallet = await getWallet({ unit, mintUrl: mint });
  return (await wallet.checkProofsStates(proofs)).some((p) => p.state === 'SPENT');
}

/**
 * Validates if a string is a valid ecash token
 */
export function isValidEcashToken(token: string): boolean {
  try {
    getDecodedToken(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if a string is a valid payment request
 */
export function isValidPaymentRequest(paymentRequest: string): boolean {
  try {
    return !!decodePaymentRequest(paymentRequest);
  } catch {
    return false;
  }
}

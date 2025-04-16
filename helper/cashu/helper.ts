import { CashuMint, decodePaymentRequest, getDecodedToken } from "@cashu/cashu-ts";
import _ from "lodash";
import { getWallet } from "helper/cashu";

/**
 * Validates if a mint meets the required nuts specifications
 */
export async function isValidMint(mint) {
  const requiredNuts = {
    nuts: {
      "15": [
        { unit: "sat", mpp: true },
        { unit: "usd", mpp: true },
      ],
    },
  };

  const mintInfo = await mint.getInfo();
  return _.isMatch(mintInfo, requiredNuts);
}

/**
 * Checks if a token has been spent
 */
export async function checkTokenSpent({ token }) {
  const decodedToken = getDecodedToken(token);
  const { unit, mint, proofs } = decodedToken;

  const wallet = await getWallet({ unit, mintUrl: mint });
  return (await wallet.checkProofsStates(proofs)).some(p => p.state === "SPENT");
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

/**
 * Creates a CashuMint instance from a token
 */
export async function getMintFromToken(token) {
  // Parse token if it's a string
  const tokenData = typeof token === "string" ? JSON.parse(token) : token;

  if (typeof tokenData !== "object") {
    throw new Error("Invalid token format. Token should be a JSON string or a Token object.");
  }

  const { mintUrl } = tokenData;
  if (!mintUrl) {
    throw new Error("Mint URL not found in the token.");
  }

  return new CashuMint(mintUrl);
}
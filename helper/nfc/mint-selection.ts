/**
 * Mint selection for NFC payments: normalize URLs and pick best mint from POS allowed list.
 */

import { NfcError } from './errors';
import { log, logDebug, logWarn } from './logger';

function normalizeMintUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

function findMintInAvailable(
  mintUrl: string,
  availableMints: Record<string, number>
): string | undefined {
  const normalizedSearch = normalizeMintUrl(mintUrl);
  for (const key of Object.keys(availableMints)) {
    if (normalizeMintUrl(key) === normalizedSearch) return key;
  }
  return undefined;
}

export interface MintSelectionResult {
  mintUrl: string;
  balance: number;
}

/**
 * Select best mint for payment: preferred mint if allowed and sufficient balance,
 * else highest-balance compatible mint. Throws NfcError if none found.
 */
export function selectBestMint(
  allowedMints: string[] | undefined,
  availableMints: Record<string, number>,
  amount: number,
  preferredMint?: string
): MintSelectionResult {
  const appMintUrls = Object.keys(availableMints);

  logDebug(`Available app mints: ${appMintUrls.length}`);

  if (!allowedMints || allowedMints.length === 0) {
    const matchedPreferred = preferredMint
      ? findMintInAvailable(preferredMint, availableMints)
      : undefined;
    if (matchedPreferred) {
      const balance = availableMints[matchedPreferred];
      if (balance >= amount) {
        log(`Using preferred mint (no restrictions): ${matchedPreferred}`);
        return { mintUrl: matchedPreferred, balance };
      }
      logWarn(`Preferred mint has insufficient balance: ${balance} < ${amount}`);
    }

    const mintsWithBalance = appMintUrls
      .filter((url) => availableMints[url] >= amount)
      .sort((a, b) => availableMints[b] - availableMints[a]);
    if (mintsWithBalance.length > 0) {
      const selected = mintsWithBalance[0];
      log(`Using mint with highest balance: ${selected}`);
      return { mintUrl: selected, balance: availableMints[selected] };
    }

    throw new NfcError(`You need at least one mint with ${amount} sats.`, 'INSUFFICIENT_BALANCE');
  }

  const compatibleMintMatches: { posUrl: string; appUrl: string }[] = [];
  for (const posMint of allowedMints) {
    const appMint = findMintInAvailable(posMint, availableMints);
    if (appMint) compatibleMintMatches.push({ posUrl: posMint, appUrl: appMint });
  }

  if (compatibleMintMatches.length === 0) {
    logWarn('No compatible mints found');
    throw new NfcError(
      "This terminal requires a mint you don't have. Add one of the supported mints to your wallet.",
      'NO_COMPATIBLE_MINT'
    );
  }

  const compatibleAppMints = compatibleMintMatches.map((m) => m.appUrl);
  log(`Compatible mints: ${compatibleAppMints.length}`);

  const matchedPreferred = preferredMint
    ? findMintInAvailable(preferredMint, availableMints)
    : undefined;
  if (
    matchedPreferred &&
    compatibleAppMints.includes(matchedPreferred) &&
    availableMints[matchedPreferred] >= amount
  ) {
    log(`Using preferred mint: ${matchedPreferred}`);
    return { mintUrl: matchedPreferred, balance: availableMints[matchedPreferred] };
  }

  const mintsWithSufficient = compatibleAppMints
    .filter((url) => availableMints[url] >= amount)
    .sort((a, b) => availableMints[b] - availableMints[a]);

  if (mintsWithSufficient.length > 0) {
    const selected = mintsWithSufficient[0];
    log(`Using compatible mint with sufficient balance: ${selected}`);
    return { mintUrl: selected, balance: availableMints[selected] };
  }

  const mintNames = allowedMints.map((url) => {
    try {
      return url.replace(/^https?:\/\//, '').split('/')[0] || url;
    } catch {
      return url;
    }
  });
  throw new NfcError(
    `You need at least ${amount} sats in either of these mints: ${mintNames.join(', ')}`,
    'INSUFFICIENT_BALANCE_AT_COMPATIBLE_MINT'
  );
}

import type { SendReachabilityStatus } from '@/shared/stores/profile/sendReachabilityStore';

interface SendTokenWarningCopy {
  title: string;
  description: string;
}

export function shouldShowMintOfflineWarning(
  entry: { state: string },
  mintWasOffline: boolean | undefined
): boolean {
  return mintWasOffline === true && entry.state !== 'finalized' && entry.state !== 'rolledBack';
}

export function getSendTokenReachabilityWarning(
  entry: { state: string },
  options: {
    mintWasOffline?: boolean;
    reachabilityStatus?: SendReachabilityStatus;
  }
): SendTokenWarningCopy | null {
  if (shouldShowMintOfflineWarning(entry, options.mintWasOffline)) {
    return {
      title: 'Mint was offline',
      description:
        'This token was created offline. The recipient may have trouble redeeming it until the mint is back online.',
    };
  }

  if (entry.state === 'finalized' || entry.state === 'rolledBack') return null;

  if (options.reachabilityStatus === 'device-offline') {
    return {
      title: 'You were offline',
      description:
        'This token was created from local proofs while your device was offline. The recipient can redeem it after they can reach the mint.',
    };
  }

  if (options.reachabilityStatus === 'mint-unreachable') {
    return {
      title: 'Mint appears offline',
      description:
        'This token was created from local proofs. The mint did not respond to a quick reachability check, so redemption may wait until it is reachable.',
    };
  }

  return null;
}

/**
 * @fileoverview Is this mint already installed? Answered synchronously.
 *
 * The screen-actions bridge answers the same question with
 * `manager.mint.isTrustedMint(mintUrl)` — an async call whose result lands on
 * the entry as `isTrusted` a beat after the screen paints. Gating UI on that
 * flashes: `!entry?.isTrusted` is true while the answer is merely UNKNOWN, so
 * an installed mint shows "Add mint" and then loses it, and its "Settings"
 * section pops in late.
 *
 * The trusted list is already in memory — `useColadaTrustedMintUrls` is a
 * `useSyncExternalStore` over the same tracker snapshot the payment machine
 * reads — so the honest answer is available on the FIRST render and no await
 * is needed.
 */
import { useMemo } from 'react';
import { useColadaTrustedMintUrls } from 'wallet/react';

import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { normalizeMintUrlKey } from '@/shared/lib/url';

/**
 * True when `mintUrl` is one of the wallet's trusted mints.
 *
 * Compared through `normalizeMintUrlKey` because the two sides reach this
 * screen by different routes: a discovery row carries the URL as nagg
 * published it, the trusted list carries it as coco stored it, and they differ
 * by scheme case and trailing slash.
 */
export function useIsMintTrusted(mintUrl: string | null | undefined): boolean {
  // `null` when ColadaProvider runs without a createColada instance; the
  // explicitly-bound wallet context is the fallback (the mint selector makes
  // the same choice).
  const trackedTrustedMintUrls = useColadaTrustedMintUrls();
  const walletContext = useWalletContext();
  const trustedMintUrls = trackedTrustedMintUrls ?? walletContext.trustedMintUrls;

  return useMemo(() => {
    if (!mintUrl) return false;
    const key = normalizeMintUrlKey(mintUrl);
    return trustedMintUrls.some((trusted) => normalizeMintUrlKey(trusted) === key);
  }, [trustedMintUrls, mintUrl]);
}

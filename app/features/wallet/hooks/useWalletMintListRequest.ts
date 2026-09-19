import { useCallback } from 'react';

import { usePaymentFlowMachine } from 'wallet/react';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

/**
 * Binds the wallet context to the payment-flow machine and returns the wallet
 * header's mint-pill handler: clear any stale payment context, then open the
 * machine's mint list from a fresh flow.
 */
export function useWalletMintListRequest(): () => void {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  return useCallback(() => {
    cashuLog.info('wallet.header.mint_selector.request', {
      source: 'wallet-header',
      trustedMintCount: walletContext.trustedMintUrls.length,
      hasPreferredMint: !!walletContext.preferredMintUrl,
    });
    clearPaymentContext('wallet.mint_selector');
    void machine.requestMintSelector({ reset: true });
  }, [machine, walletContext.preferredMintUrl, walletContext.trustedMintUrls.length]);
}

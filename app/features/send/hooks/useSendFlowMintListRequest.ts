import { useCallback, useEffect } from 'react';

import { usePaymentFlowMachine } from 'wallet/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

/**
 * Binds the wallet context to the payment-flow machine for the send-flow
 * Lightning route and returns its mint-pill handler, which opens the machine's
 * mint list inside the current flow (no reset, unlike the wallet header's).
 */
export function useSendFlowMintListRequest(): () => void {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  useEffect(() => {
    cashuLog.info('send.lightning.route.ready', {
      trustedMintCount: walletContext.trustedMintUrls.length,
      balanceMintCount: Object.keys(walletContext.mintBalances).length,
    });
  }, [walletContext.mintBalances, walletContext.trustedMintUrls.length]);

  return useCallback(() => {
    cashuLog.info('send.lightning.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);
}

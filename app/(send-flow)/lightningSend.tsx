/**
 * @fileoverview Send-flow Lightning send route.
 */

import { LightningSendRoute } from '@/features/send';
import { useEffect } from 'react';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

export default function LightningSendRouteWrapper() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  useEffect(() => {
    cashuLog.info('send.lightning.route.ready', {
      trustedMintCount: walletContext.trustedMintUrls.length,
      balanceMintCount: Object.keys(walletContext.mintBalances).length,
    });
  }, [walletContext.mintBalances, walletContext.trustedMintUrls.length]);

  const handleRequestMintList = () => {
    cashuLog.info('send.lightning.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  };

  return (
    <LightningSendRoute where="send-flow.lightningSend" onRequestMintList={handleRequestMintList} />
  );
}

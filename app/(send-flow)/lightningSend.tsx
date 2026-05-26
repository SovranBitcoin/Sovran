/**
 * @fileoverview Send-flow Lightning send route.
 */

import { LightningSendRoute } from '@/features/send';
import { useCallback } from 'react';
import { usePaymentFlowMachine } from 'colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

export default function LightningSendRouteWrapper() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleRequestMintList = useCallback(() => {
    cashuLog.info('send.lightning.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <LightningSendRoute where="send-flow.lightningSend" onRequestMintList={handleRequestMintList} />
  );
}

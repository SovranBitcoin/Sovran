import { useCallback } from 'react';
import { useColadaContext } from 'wallet/react';

import { useMintStore } from '@/shared/stores/profile/mintStore';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { aiLog } from '@/shared/lib/logger';

/** Start the wallet's Fixed Amount receive in sats, with no provider recipient. */
export function useNavigateToAddFunds(): () => void {
  const { machine } = useColadaContext();
  return useCallback(() => {
    clearPaymentContext('ai.receive');
    useMintStore.getState().setActiveUnit('sat');
    machine.startReceiveLightning({ reset: true }).catch((error: unknown) => {
      aiLog.error('ai.receive.start_failed', { error });
    });
  }, [machine]);
}

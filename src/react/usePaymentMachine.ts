import { useMemo } from 'react';

import { useLatestRef } from './useLatestRef';
import { createPaymentMachine } from '../machine/createMachine';
import type { PaymentMachine, StepHandlerMap } from '../machine/types';
import type { Detectors, WalletContext } from '../types';

export interface UsePaymentMachineConfig {
  handlers: StepHandlerMap;
  detectors?: Detectors;
  walletContext: WalletContext;
  unit?: string;
}

/**
 * Creates a stable PaymentMachine that reads the latest walletContext,
 * handlers, and unit on every send() without recreating the machine.
 */
export function usePaymentMachine({
  handlers,
  detectors,
  walletContext,
  unit = 'sat',
}: UsePaymentMachineConfig): PaymentMachine {
  const walletContextRef = useLatestRef(walletContext);
  const handlersRef = useLatestRef(handlers);
  const unitRef = useLatestRef(unit);

  return useMemo(
    () =>
      createPaymentMachine({
        handlers: new Proxy(
          {},
          {
            get: (_target, key: string) => (handlersRef.current as Record<string, unknown>)[key],
          }
        ) as StepHandlerMap,
        detectors,
        getContext: () => walletContextRef.current,
        getUnit: () => unitRef.current,
      }),
    [detectors ?? 'default']
  );
}

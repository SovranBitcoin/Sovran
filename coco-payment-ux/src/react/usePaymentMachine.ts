import { useMemo, useRef } from 'react';

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
  const walletContextRef = useRef(walletContext);
  const handlersRef = useRef(handlers);
  const unitRef = useRef(unit);

  walletContextRef.current = walletContext;
  handlersRef.current = handlers;
  unitRef.current = unit;

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

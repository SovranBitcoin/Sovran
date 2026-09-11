import { useEffect, useMemo, type MutableRefObject } from 'react';

import { useLatestRef } from './useLatestRef';
import { logger } from '../logger';
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
 * Builds the machine, in module scope on purpose.
 *
 * The machine has to read the LATEST handlers/context/unit on every `send()`
 * without being rebuilt, which is what the three latest-value refs are for.
 * But a closure created during render that reads `someRef.current` is exactly
 * what the React Compiler rejects ("Passing a ref to a function may read its
 * value during render"), and that one rejection switched the compiler off for
 * the whole hook — every consumer of `usePaymentMachine` rendering unmemoized
 * with no signal, since `wallet/` sat outside the bailout ratchet.
 *
 * Handing the ref OBJECTS to a function outside the component is accepted:
 * nothing reads `.current` inside render, and every read still happens where
 * it always did — at `send()` time, from the machine's own callbacks.
 */
function buildPaymentMachine(
  handlersRef: MutableRefObject<StepHandlerMap>,
  walletContextRef: MutableRefObject<WalletContext>,
  unitRef: MutableRefObject<string>,
  detectors: Detectors | undefined,
): PaymentMachine {
  logger.info('react.usePaymentMachine.create', {
    unit: unitRef.current,
    handlerCount: Object.keys(handlersRef.current).length,
    detectorOverride: !!detectors,
  });
  return createPaymentMachine({
    handlers: new Proxy(
      {},
      {
        get: (_target, key: string) =>
          (handlersRef.current as Record<string, unknown>)[key],
      },
    ) as StepHandlerMap,
    detectors,
    getContext: () => walletContextRef.current,
    getUnit: () => unitRef.current,
  });
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

  useEffect(() => {
    logger.debug('react.usePaymentMachine.bindContext', {
      unit,
      handlerCount: Object.keys(handlers).length,
      trustedMintCount: walletContext.trustedMintUrls.length,
      balanceMintCount: Object.keys(walletContext.mintBalances).length,
      proofMintCount: Object.keys(walletContext.proofAmounts).length,
      readyProofCount: Object.values(walletContext.proofAmounts).reduce(
        (sum, proofs) => sum + proofs.length,
        0,
      ),
      hasPreferredMint: !!walletContext.preferredMintUrl,
    });
  }, [handlers, unit, walletContext]);

  // The dep list names the refs it reaches as well as the detector override.
  // They are stable for the life of the hook, so the machine is still built
  // exactly once per `detectors` identity — the list is longer, not looser.
  return useMemo(
    () =>
      buildPaymentMachine(handlersRef, walletContextRef, unitRef, detectors),
    [detectors ?? 'default', handlersRef, walletContextRef, unitRef],
  );
}

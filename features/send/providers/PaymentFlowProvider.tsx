import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  createPaymentMachine,
  selectMintContext,
  type FlowContext,
  type MintResolutionContext,
  type PaymentMachine,
  type StepHandlerMap,
  type WalletContext,
} from 'coco-payment-ux';
import { useManager } from 'coco-cashu-react';

import { createSovranHandlers } from '@/features/send/lib/paymentHandlers';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

interface PaymentFlowContextValue {
  machine: PaymentMachine;
  walletContextRef: React.MutableRefObject<WalletContext | null>;
  unitRef: React.MutableRefObject<string>;
  optionDismissRef: React.MutableRefObject<(() => void) | undefined>;
}

const PaymentFlowContext = createContext<PaymentFlowContextValue | null>(null);

export function PaymentFlowProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const pubkeyRef = useRef(keys?.pubkey);
  pubkeyRef.current = keys?.pubkey;

  const walletContextRef = useRef<WalletContext | null>(null);
  const unitRef = useRef('sat');
  const optionDismissRef = useRef<(() => void) | undefined>(undefined);
  const handlersRef = useRef<StepHandlerMap>({});
  const machineRef = useRef<PaymentMachine | null>(null);

  if (!machineRef.current) {
    machineRef.current = createPaymentMachine({
      handlers: new Proxy(
        {},
        {
          get: (_target, key: string) => (handlersRef.current as Record<string, unknown>)[key],
        }
      ) as StepHandlerMap,
      getContext: () => {
        if (!walletContextRef.current) {
          throw new Error('PaymentFlowProvider has no wallet context bound yet.');
        }
        return walletContextRef.current;
      },
      getUnit: () => unitRef.current,
      onPersistMint: (mintUrl) => {
        const pubkey = pubkeyRef.current;
        if (pubkey) {
          useMintStore.getState().setSelectedMint(pubkey, mintUrl);
        }
      },
    });
  }

  handlersRef.current = createSovranHandlers({
    manager,
    onSend: (event) => {
      void machineRef.current?.send(event);
    },
    onOptionDismiss: () => {
      optionDismissRef.current?.();
    },
  });

  const value = useMemo<PaymentFlowContextValue>(
    () => ({
      machine: machineRef.current!,
      walletContextRef,
      unitRef,
      optionDismissRef,
    }),
    []
  );

  return <PaymentFlowContext.Provider value={value}>{children}</PaymentFlowContext.Provider>;
}

interface UsePaymentFlowMachineConfig {
  walletContext: WalletContext;
  unit?: string;
  onOptionDismiss?: () => void;
}

export function usePaymentFlowMachine({
  walletContext,
  unit = 'sat',
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): PaymentMachine {
  const ctx = useContext(PaymentFlowContext);
  if (!ctx) {
    throw new Error('PaymentFlowProvider is missing. Wrap the app with PaymentFlowProvider.');
  }

  ctx.walletContextRef.current = walletContext;
  ctx.unitRef.current = unit;

  useEffect(() => {
    ctx.optionDismissRef.current = onOptionDismiss;
    return () => {
      if (ctx.optionDismissRef.current === onOptionDismiss) {
        ctx.optionDismissRef.current = undefined;
      }
    };
  }, [ctx, onOptionDismiss]);

  return ctx.machine;
}

/** Legacy alias during migration */
export const usePaymentFlowResolver = usePaymentFlowMachine;

/**
 * Returns the mint URL currently tracked by the active payment flow.
 */
export function usePaymentFlowMint(): string | undefined {
  const ctx = useContext(PaymentFlowContext);
  const flowCtx = useSyncExternalStore(
    ctx?.machine.subscribe ?? (() => () => {}),
    ctx?.machine.getContext ?? (() => ({ unit: 'sat' })),
    ctx?.machine.getContext ?? (() => ({ unit: 'sat' }))
  ) as FlowContext;
  return flowCtx.mintUrl;
}

export function usePaymentFlowMintContext({
  walletContext,
  unit = 'sat',
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): MintResolutionContext | null {
  const machine = usePaymentFlowMachine({ walletContext, unit, onOptionDismiss });
  const flowCtx = useSyncExternalStore(machine.subscribe, machine.getContext, machine.getContext);

  return useMemo(() => selectMintContext(flowCtx, walletContext), [flowCtx, walletContext]);
}

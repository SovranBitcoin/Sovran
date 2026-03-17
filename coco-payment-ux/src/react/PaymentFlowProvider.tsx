// ---------------------------------------------------------------------------
// PaymentFlowProvider — React context + hooks for the payment flow machine
//
// Creates a singleton PaymentMachine, holds live refs for wallet context,
// unit, and handlers, and exposes hooks to bind and consume the machine.
//
// The wallet (e.g. Sovran) provides:
//   - createHandlers: factory that receives the machine and returns StepHandlerMap
//   - operations / notifications / onPersistMint: machine creation config
//
// Screen components call usePaymentFlowMachine to inject their current
// wallet context + unit. Child hooks read the machine from context.
// ---------------------------------------------------------------------------

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import { createPaymentMachine } from '../machine/createMachine';
import { selectMintContext } from '../machine/selectMintContext';
import type {
  FlowContext,
  MachineOperations,
  NotificationHandlerMap,
  PaymentMachine,
  StepHandlerMap,
} from '../machine/types';
import type { MintResolutionContext } from '../machine/selectMintContext';
import type { Detectors, WalletContext } from '../types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Live refs exposed to the handler factory so handlers can read
 * values that change after creation (e.g. option dismiss callback).
 */
export interface PaymentFlowRefs {
  getOptionDismiss: () => (() => void) | undefined;
}

export interface PaymentFlowProviderConfig {
  /**
   * Factory called once after the machine is created. Returns the
   * `StepHandlerMap` for the machine. The machine instance and live
   * refs are provided so handlers can reference them without stale closures.
   */
  createHandlers: (machine: PaymentMachine, refs: PaymentFlowRefs) => StepHandlerMap;
  /** Async wallet operations (send, mint quote, build mint list). */
  operations?: MachineOperations;
  /** Error/validation notification handlers. */
  notifications?: NotificationHandlerMap;
  /** Called when the machine wants to persist the user's preferred mint. */
  onPersistMint?: (mintUrl: string) => void;
  /** Custom protocol detectors. Falls back to built-in detectors. */
  detectors?: Detectors;
  /**
   * Optional external wallet context ref. When provided, the provider
   * uses this ref instead of creating an internal one. This lets the
   * wallet share the ref with operations that need live wallet state
   * (e.g. reading proofAmounts in buildMintListItems).
   */
  walletContextRef?: React.MutableRefObject<WalletContext | null>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PaymentFlowContextValue {
  machine: PaymentMachine;
  walletContextRef: React.MutableRefObject<WalletContext | null>;
  unitRef: React.MutableRefObject<string>;
  optionDismissRef: React.MutableRefObject<(() => void) | undefined>;
}

const PaymentFlowContext = createContext<PaymentFlowContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface PaymentFlowProviderProps {
  config: PaymentFlowProviderConfig;
  children: React.ReactNode;
}

export function PaymentFlowProvider({ config, children }: PaymentFlowProviderProps) {
  const internalWalletContextRef = useRef<WalletContext | null>(null);
  const walletContextRef = config.walletContextRef ?? internalWalletContextRef;
  const unitRef = useRef('sat');
  const optionDismissRef = useRef<(() => void) | undefined>(undefined);
  const handlersRef = useRef<StepHandlerMap>({});
  const machineRef = useRef<PaymentMachine | null>(null);

  // Capture config in a ref for the initial creation block
  const configRef = useRef(config);
  configRef.current = config;

  if (!machineRef.current) {
    const { createHandlers, operations, notifications, onPersistMint, detectors } =
      configRef.current;

    machineRef.current = createPaymentMachine({
      handlers: new Proxy(
        {},
        {
          get: (_target, key: string) => (handlersRef.current as Record<string, unknown>)[key],
        }
      ) as StepHandlerMap,
      detectors,
      getContext: () => {
        if (!walletContextRef.current) {
          throw new Error('PaymentFlowProvider has no wallet context bound yet.');
        }
        return walletContextRef.current;
      },
      getUnit: () => unitRef.current,
      onPersistMint,
      operations,
      notifications,
    });

    handlersRef.current = createHandlers(machineRef.current, {
      getOptionDismiss: () => optionDismissRef.current,
    });
  }

  const value = useMemo<PaymentFlowContextValue>(
    () => ({
      machine: machineRef.current!,
      walletContextRef,
      unitRef,
      optionDismissRef,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return <PaymentFlowContext.Provider value={value}>{children}</PaymentFlowContext.Provider>;
}

// ---------------------------------------------------------------------------
// Internal context accessor
// ---------------------------------------------------------------------------

function usePaymentFlowContext(): PaymentFlowContextValue {
  const ctx = useContext(PaymentFlowContext);
  if (!ctx) {
    throw new Error('PaymentFlowProvider is missing. Wrap the app with PaymentFlowProvider.');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface UsePaymentFlowMachineConfig {
  walletContext: WalletContext;
  unit?: string;
  onOptionDismiss?: () => void;
}

/**
 * Binds the current screen's wallet context and unit to the shared machine.
 * Returns the stable PaymentMachine instance.
 */
export function usePaymentFlowMachine({
  walletContext,
  unit = 'sat',
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): PaymentMachine {
  const ctx = usePaymentFlowContext();

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

/**
 * Returns the mint URL currently tracked by the active payment flow.
 */
export function usePaymentFlowMint(): string | undefined {
  const ctx = usePaymentFlowContext();
  const flowCtx = useSyncExternalStore(
    ctx.machine.subscribe,
    ctx.machine.getContext,
    ctx.machine.getContext
  ) as FlowContext;
  return flowCtx.mintUrl;
}

/**
 * Returns the full mint resolution context for the current flow.
 */
export function usePaymentFlowMintContext({
  walletContext,
  unit = 'sat',
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): MintResolutionContext | null {
  const machine = usePaymentFlowMachine({ walletContext, unit, onOptionDismiss });
  const flowCtx = useSyncExternalStore(machine.subscribe, machine.getContext, machine.getContext);

  return useMemo(() => selectMintContext(flowCtx, walletContext), [flowCtx, walletContext]);
}

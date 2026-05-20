// ---------------------------------------------------------------------------
// useScreenActions — post-terminal + amount-entry screen actions
//
// Handlers come from CocoPaymentUXProvider (`actions` prop). Optional
// `screenActionsBridge` supplies wallet context, history subscriptions,
// decoration, and scan provenance.
//
// Usage:
//   const { entry, error, actions, source } = useScreenActions('sendToken', entryParam);
//   const { entry, error, actions, source } = useScreenActions(
//     'amountEntry',
//     entrySeed,
//     { amountConfig }
//   );
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';

import { useLatestRef } from './useLatestRef';
import type { CreateAmountActionManagerConfig , QuickSendSuggestion } from '../amount-actions/types';
import {
  createScreenActionManager,
  shouldApplyEntryUpdate as defaultShouldApply,
  mergeEntryUpdate as defaultMerge,
  decorateEntry as defaultDecorate,
} from '../screen-actions/createManager';
import { createDefaultScreenActionHandlers } from '../screen-actions/defaultHandlers';
import type {
  ActionState,
  DecoratedEntryFields,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from '../screen-actions/types';

import { useCocoPaymentUXContext } from './CocoPaymentUXProvider';

// ---------------------------------------------------------------------------
// Entry parsing
// ---------------------------------------------------------------------------

function parseEntryParam(param: Record<string, unknown> | string | undefined): {
  parsed: Record<string, unknown> | null;
  error: string | null;
} {
  if (!param) {
    return { parsed: null, error: 'Missing transaction data. Please try again.' };
  }
  if (typeof param === 'string') {
    try {
      return { parsed: JSON.parse(param) as Record<string, unknown>, error: null };
    } catch {
      return { parsed: null, error: 'Invalid transaction data. Please try again.' };
    }
  }
  return { parsed: param, error: null };
}

function parseAmountEntryParam(param: Record<string, unknown> | string | undefined): {
  parsed: Record<string, unknown> | null;
  error: string | null;
} {
  if (param == null) {
    return { parsed: {}, error: null };
  }
  if (typeof param === 'string') {
    if (!param.trim()) return { parsed: {}, error: null };
    try {
      return { parsed: JSON.parse(param) as Record<string, unknown>, error: null };
    } catch {
      return { parsed: null, error: 'Invalid amount screen data.' };
    }
  }
  return { parsed: param, error: null };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoundAction = ActionState & {
  execute: (params?: Record<string, unknown>) => Promise<void>;
};

/**
 * Advanced: full config when not using provider-driven handlers.
 * Prefer `useScreenActions(screenType, entryParam)` at the call site.
 */
export interface UseScreenActionsConfig<S extends ScreenType> {
  screenType: S;
  handlers: ScreenActionHandlerMap[S];
  /** Default handlers used as fallback when no wallet handler is registered. */
  defaultHandlers?: ScreenActionHandlerMap[S];
  entryParam: Record<string, unknown> | string | undefined;
  getExtraContext?: () => Record<string, unknown>;
  onEntryUpdate?: (callback: (entry: Record<string, unknown>) => void) => () => void;
  shouldApplyEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>
  ) => boolean;
  mergeEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>
  ) => Record<string, unknown>;
  amountConfig?: CreateAmountActionManagerConfig;
}

export type UseScreenActionsResult<S extends ScreenType, E = Record<string, unknown>> = {
  entry: E | null;
  error: string | null;
  actions: Record<ScreenActionName[S], BoundAction>;
  /** Mint URL for this screen instance (from entry data, not global flow state). */
  mintUrl: string | undefined;
  source: S extends 'amountEntry' ? null : string | null;
  suggestions: QuickSendSuggestion[];
};

// ---------------------------------------------------------------------------
// Internal: config-based manager (tests / advanced callers)
// ---------------------------------------------------------------------------

export function useScreenActionsWithConfig<S extends ScreenType>(
  config: UseScreenActionsConfig<S>
): Omit<UseScreenActionsResult<S>, 'source'> {
  const {
    screenType,
    handlers,
    defaultHandlers,
    entryParam,
    getExtraContext,
    onEntryUpdate,
    shouldApplyEntryUpdate,
    mergeEntryUpdate,
    amountConfig,
  } = config;

  const getExtraContextRef = useLatestRef(getExtraContext);
  const shouldApplyEntryUpdateRef = useLatestRef(shouldApplyEntryUpdate);
  const mergeEntryUpdateRef = useLatestRef(mergeEntryUpdate);
  const amountConfigRef = useLatestRef(amountConfig);

  const { parsed, error } = useMemo(
    () =>
      screenType === 'amountEntry'
        ? parseAmountEntryParam(entryParam as Record<string, unknown> | string | undefined)
        : parseEntryParam(entryParam),
    [screenType, entryParam]
  );

  const managerRef = useRef<ScreenActionManager<S> | null>(null);

  if (!managerRef.current) {
    managerRef.current = createScreenActionManager<S>({
      screenType,
      handlers,
      defaultHandlers,
      getContext: () => ({
        entry: managerRef.current?.getEntry() ?? {},
        manager: null,
        setEntry: (e: Record<string, unknown>) => managerRef.current?.setEntry(e),
        ...getExtraContextRef.current?.(),
      }),
      amountConfig:
        screenType === 'amountEntry' ? (amountConfigRef.current ?? undefined) : undefined,
    });
  }

  const actionManager = managerRef.current;

  useEffect(() => {
    if (parsed != null) {
      actionManager.setEntry(parsed);
    }
  }, [parsed, actionManager]);

  useEffect(() => {
    if (parsed == null || !onEntryUpdate) return;

    return onEntryUpdate((updated) => {
      const currentEntry = actionManager.getEntry();
      const shouldApply = shouldApplyEntryUpdateRef.current ?? defaultShouldApply;
      if (shouldApply(currentEntry, updated)) {
        const merge = mergeEntryUpdateRef.current ?? defaultMerge;
        actionManager.setEntry(merge(currentEntry, updated));
      }
    });
  }, [parsed, onEntryUpdate, actionManager]);

  const rawState = useSyncExternalStore(
    actionManager.subscribe,
    actionManager.inspect,
    actionManager.inspect
  );

  const actions = useMemo(() => {
    const bound = {} as Record<ScreenActionName[S], BoundAction>;
    for (const [name, state] of Object.entries(rawState) as [ScreenActionName[S], ActionState][]) {
      bound[name] = {
        ...state,
        execute: (params?: Record<string, unknown>) => actionManager.execute(name, params),
      };
    }
    return bound;
  }, [rawState, actionManager]);

  const entry = actionManager.getEntry();
  const suggestions: QuickSendSuggestion[] = Array.isArray(entry?.suggestions)
    ? (entry.suggestions as QuickSendSuggestion[])
    : [];

  return { entry, error, actions, mintUrl: undefined, suggestions };
}

// ---------------------------------------------------------------------------
// Public API — handlers + bridge from CocoPaymentUXProvider
// ---------------------------------------------------------------------------

export function useScreenActions<E extends Record<string, unknown> = Record<string, unknown>>(
  screenType: 'amountEntry',
  entryParam?: E | string | undefined,
  options?: { amountConfig?: CreateAmountActionManagerConfig }
): UseScreenActionsResult<'amountEntry', E>;

export function useScreenActions<
  S extends Exclude<ScreenType, 'amountEntry'>,
  E extends Record<string, unknown> = Record<string, unknown>,
>(
  screenType: S,
  entryParam: E | string | undefined
): UseScreenActionsResult<S, E & DecoratedEntryFields>;

export function useScreenActions(
  screenType: ScreenType,
  entryParam: Record<string, unknown> | string | undefined,
  options?: { amountConfig?: CreateAmountActionManagerConfig }
): UseScreenActionsResult<ScreenType, any> {
  const {
    machine,
    walletContextRef,
    screenActionHandlers,
    screenActionsBridge,
    getLocaleRef,
    getOfflineRef,
    getBtcPriceRef,
    getDisplayCurrencyRef,
    notificationsRef,
    operationsRef,
    navigationRef,
    writeClipboardRef,
    shareContentRef,
  } = useCocoPaymentUXContext();
  const isAmountEntry = screenType === 'amountEntry';
  const skipDecoration = isAmountEntry || screenType === 'mintSelector';

  const machineRef = useLatestRef(machine);
  const bridgeRef = useLatestRef(screenActionsBridge);

  const getExtraContext = useCallback(
    () => ({
      paymentMachine: machineRef.current,
      writeClipboard: writeClipboardRef.current,
      shareContent: shareContentRef.current,
      notify: (event: string, ...args: unknown[]) => {
        const notifications = notificationsRef.current;
        if (!notifications) return;
        const handler = (notifications as Record<string, ((...a: unknown[]) => void) | undefined>)[
          event
        ];
        if (typeof handler === 'function') handler(...args);
      },
      ...(bridgeRef.current?.getExtraContext?.() ?? {}),
    }),
    []
  );

  const onEntryUpdate = useCallback(
    (callback: (entry: Record<string, unknown>) => void) => {
      const bridge = bridgeRef.current;
      if (!bridge?.onEntryUpdate) return () => {};
      return bridge.onEntryUpdate(screenType, callback);
    },
    [screenType]
  );

  const handlersRaw = isAmountEntry
    ? screenActionHandlers.amountEntry
    : screenActionHandlers[screenType as Exclude<ScreenType, 'amountEntry'>];
  const handlers = (handlersRaw ?? {}) as ScreenActionHandlerMap[typeof screenType];

  // Build default handlers from operations + notifications + navigation.
  // Uses refs so the handlers always read fresh values.
  const allDefaults = useMemo(
    () =>
      createDefaultScreenActionHandlers({
        getMachine: () => machineRef.current,
        getOperations: () => operationsRef.current,
        getOffline: () => getOfflineRef.current?.() ?? false,
        notify: (event: string, ...args: unknown[]) => {
          const notifications = notificationsRef.current;
          if (!notifications) return;
          const handler = (
            notifications as Record<string, ((...a: unknown[]) => void) | undefined>
          )[event];
          if (typeof handler === 'function') handler(...args);
        },
        navigation: {
          scanQr: (...args) => navigationRef.current?.scanQr?.(...args),
          mintInfo: (...args) => navigationRef.current?.mintInfo?.(...args),
          addMint: () => navigationRef.current?.addMint?.(),
          goBack: () => navigationRef.current?.goBack?.(),
        },
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const defaultHandlersForScreen = (
    isAmountEntry
      ? allDefaults.amountEntry
      : allDefaults[screenType as Exclude<ScreenType, 'amountEntry'>]
  ) as ScreenActionHandlerMap[typeof screenType];

  const shouldApply = screenActionsBridge?.shouldApplyEntryUpdate ?? defaultShouldApply;
  const mergeEntry = screenActionsBridge?.mergeEntryUpdate ?? defaultMerge;

  const [, bumpGlobal] = useReducer((n: number) => n + 1, 0);
  const subscribeGlobal = screenActionsBridge?.subscribeGlobalScreenActions;
  useEffect(() => {
    const sub = subscribeGlobal?.(() => bumpGlobal());
    return () => sub?.();
  }, [subscribeGlobal]);

  // Auto-derive amountConfig from provider context when not explicitly provided.
  // Every reactive field is a getter so the manager — created once and held
  // in managerRef across the screen's lifetime — re-reads destination, unit,
  // and display currency on every inspect(). Without this, opening amountEntry
  // a second time from a different destination (sendEcash → meltQuote) or
  // after a settings currency change keeps the first-render snapshot.
  const derivedAmountConfig = useMemo((): CreateAmountActionManagerConfig | undefined => {
    if (!isAmountEntry || options?.amountConfig) return undefined;
    return {
      getMintUrl: () => machineRef.current.getContext().mintUrl,
      getProofAmounts: () => {
        const mint = machineRef.current.getContext().mintUrl;
        return mint ? (walletContextRef.current?.proofAmounts[mint] ?? []) : [];
      },
      getBtcPrice: () => getBtcPriceRef.current?.() ?? 0,
      offlineOptimization: () => machineRef.current.getContext().destination === 'sendEcash',
      unit: () => machineRef.current.getContext().unit,
      fiatCurrency: () => getDisplayCurrencyRef.current?.()?.code,
      fiatSymbol: () => getDisplayCurrencyRef.current?.()?.symbol,
    };
    // Refs are stable across renders; getter closures read .current on each
    // inspect() so the manager always sees the latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAmountEntry, options?.amountConfig]);

  const effectiveAmountConfig = isAmountEntry
    ? (options?.amountConfig ?? derivedAmountConfig)
    : undefined;

  const base = useScreenActionsWithConfig({
    screenType: screenType as ScreenType,
    handlers,
    defaultHandlers: defaultHandlersForScreen,
    entryParam,
    getExtraContext,
    onEntryUpdate: isAmountEntry ? undefined : onEntryUpdate,
    shouldApplyEntryUpdate: isAmountEntry ? undefined : shouldApply,
    mergeEntryUpdate: isAmountEntry ? undefined : mergeEntry,
    amountConfig: effectiveAmountConfig,
  });

  const language = screenActionsBridge?.getLocale?.() ?? getLocaleRef.current?.() ?? 'en';

  const entry = useMemo(() => {
    if (skipDecoration) return base.entry;
    if (screenActionsBridge?.decorateEntry) {
      return screenActionsBridge.decorateEntry(base.entry, { language });
    }
    return defaultDecorate(base.entry, language);
  }, [skipDecoration, base.entry, screenActionsBridge, language]);

  const source = useMemo((): string | null => {
    if (skipDecoration) return null;
    return screenActionsBridge?.getSourceLabel?.(base.entry) ?? null;
  }, [skipDecoration, base.entry, screenActionsBridge]);

  // Derive mintUrl from the raw entry (before decoration converts it to FormattedString).
  const mintUrl = useMemo((): string | undefined => {
    const raw = base.entry;
    if (!raw) return undefined;
    const url = raw.mintUrl ?? raw.selectedMintUrl;
    return typeof url === 'string' && url.length > 0 ? url : undefined;
  }, [base.entry]);

  if (isAmountEntry) {
    return {
      entry,
      error: base.error,
      actions: base.actions as Record<ScreenActionName['amountEntry'], BoundAction>,
      mintUrl,
      source: null,
      suggestions: base.suggestions,
    } as UseScreenActionsResult<ScreenType, any>;
  }

  return {
    entry,
    error: base.error,
    actions: base.actions,
    mintUrl,
    source,
    suggestions: [],
  } as UseScreenActionsResult<ScreenType, any>;
}

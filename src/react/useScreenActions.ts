// ---------------------------------------------------------------------------
// useScreenActions — post-terminal + amount-entry screen actions
//
// Handlers come from ColadaProvider (`actions` prop). Optional
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

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { useLatestRef } from './useLatestRef';
import type {
  CreateAmountActionManagerConfig,
  QuickSendSuggestion,
} from '../amount-actions/types';
import {
  createScreenActionSession,
  type ScreenActionSession,
} from '../screen-actions/session';
import {
  decorateEntry as defaultDecorate,
  mergeEntryUpdate as defaultMerge,
  shouldApplyEntryUpdate as defaultShouldApply,
} from '../screen-actions/createManager';
import { createDefaultScreenActionHandlers } from '../screen-actions/defaultHandlers';
import type {
  ActionState,
  DecoratedEntryFields,
  ScreenActionHandlerMap,
  ScreenActionName,
  ScreenActionsBridge,
  ScreenType,
} from '../screen-actions/types';

import { useColadaContext } from './ColadaProvider';

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
  onEntryUpdate?: (
    callback: (entry: Record<string, unknown>) => void,
  ) => () => void;
  shouldApplyEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>,
  ) => boolean;
  mergeEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>,
  ) => Record<string, unknown>;
  amountConfig?: CreateAmountActionManagerConfig;
}

export type UseScreenActionsResult<
  S extends ScreenType,
  E = Record<string, unknown>,
> = {
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
  config: UseScreenActionsConfig<S>,
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
  const onEntryUpdateRef = useLatestRef(onEntryUpdate);

  const sessionRef = useRef<ScreenActionSession<S> | null>(null);

  if (!sessionRef.current) {
    sessionRef.current = createScreenActionSession<S>({
      screenType,
      handlers,
      defaultHandlers,
      entrySeed: entryParam,
      getExtraContext: () => getExtraContextRef.current?.() ?? {},
      subscribeEntryUpdates: onEntryUpdate
        ? (callback) => onEntryUpdateRef.current?.(callback) ?? (() => {})
        : undefined,
      shouldApplyEntryUpdate: shouldApplyEntryUpdate
        ? (current, updated) =>
            shouldApplyEntryUpdateRef.current!(current, updated)
        : undefined,
      mergeEntryUpdate: mergeEntryUpdate
        ? (current, updated) => mergeEntryUpdateRef.current!(current, updated)
        : undefined,
      amountConfig:
        screenType === 'amountEntry'
          ? (amountConfigRef.current ?? undefined)
          : undefined,
      decorateEntry: (entry) => entry,
    });
  }

  const session = sessionRef.current;

  useEffect(() => {
    session.setEntrySeed(entryParam);
  }, [entryParam, session]);

  useEffect(() => {
    return () => session.dispose();
  }, [session]);

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.inspect,
    session.inspect,
  );

  const actions = useMemo(() => {
    const bound = {} as Record<ScreenActionName[S], BoundAction>;
    for (const [name, state] of Object.entries(snapshot.actions) as [
      ScreenActionName[S],
      ActionState,
    ][]) {
      bound[name] = {
        ...state,
        execute: (params?: Record<string, unknown>) =>
          session.execute(name, params),
      };
    }
    return bound;
  }, [snapshot.actions, session]);

  return {
    entry: snapshot.entry,
    error: snapshot.error,
    actions,
    mintUrl: snapshot.mintUrl,
    suggestions: snapshot.suggestions,
  };
}

// ---------------------------------------------------------------------------
// Public API — handlers + bridge from ColadaProvider
// ---------------------------------------------------------------------------

export function useScreenActions<
  E extends Record<string, unknown> = Record<string, unknown>,
>(
  screenType: 'amountEntry',
  entryParam?: E | string | undefined,
  options?: { amountConfig?: CreateAmountActionManagerConfig },
): UseScreenActionsResult<'amountEntry', E>;

export function useScreenActions<
  S extends Exclude<ScreenType, 'amountEntry'>,
  E extends Record<string, unknown> = Record<string, unknown>,
>(
  screenType: S,
  entryParam: E | string | undefined,
): UseScreenActionsResult<S, E & DecoratedEntryFields>;

export function useScreenActions(
  screenType: ScreenType,
  entryParam: Record<string, unknown> | string | undefined,
  options?: { amountConfig?: CreateAmountActionManagerConfig },
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
    adaptersRef,
    subscriptionBusRef,
    notificationsRef,
    operationsRef,
    navigationRef,
    writeClipboardRef,
    shareContentRef,
  } = useColadaContext();
  const isAmountEntry = screenType === 'amountEntry';

  const machineRef = useLatestRef(machine);
  const bridgeRef = useLatestRef(screenActionsBridge);

  const getExtraContextRef = useLatestRef(() => ({
    paymentMachine: machineRef.current,
    writeClipboard: writeClipboardRef.current,
    shareContent: shareContentRef.current,
    adapters: adaptersRef.current,
    notify: (event: string, ...args: unknown[]) => {
      const notifications = notificationsRef.current;
      if (!notifications) return;
      const handler = (
        notifications as Record<string, ((...a: unknown[]) => void) | undefined>
      )[event];
      if (typeof handler === 'function') handler(...args);
    },
  }));

  const sessionBridgeRef = useRef<ScreenActionsBridge | null>(null);
  if (!sessionBridgeRef.current) {
    sessionBridgeRef.current = {
      getExtraContext: () => bridgeRef.current?.getExtraContext?.() ?? {},
      subscribeEntryUpdates: (type, callback, bus) =>
        bridgeRef.current?.subscribeEntryUpdates?.(type, callback, bus) ??
        (() => {}),
      shouldApplyEntryUpdate: (current, updated) =>
        bridgeRef.current?.shouldApplyEntryUpdate?.(current, updated) ??
        defaultShouldApply(current, updated),
      mergeEntryUpdate: (current, updated) =>
        bridgeRef.current?.mergeEntryUpdate?.(current, updated) ??
        defaultMerge(current, updated),
      decorateEntry: (entry, ctx) =>
        bridgeRef.current?.decorateEntry?.(entry, ctx) ??
        defaultDecorate(entry, ctx.language),
      getLocale: () =>
        bridgeRef.current?.getLocale?.() ?? getLocaleRef.current?.() ?? 'en',
      getSourceLabel: (entry) =>
        bridgeRef.current?.getSourceLabel?.(entry) ?? null,
    };
  }

  const handlersRaw = isAmountEntry
    ? screenActionHandlers.amountEntry
    : screenActionHandlers[screenType as Exclude<ScreenType, 'amountEntry'>];
  const handlers = (handlersRaw ??
    {}) as ScreenActionHandlerMap[typeof screenType];

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
            notifications as Record<
              string,
              ((...a: unknown[]) => void) | undefined
            >
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
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const defaultHandlersForScreen = (
    isAmountEntry
      ? allDefaults.amountEntry
      : allDefaults[screenType as Exclude<ScreenType, 'amountEntry'>]
  ) as ScreenActionHandlerMap[typeof screenType];

  // Auto-derive amountConfig from provider context when not explicitly provided.
  // Every reactive field is a getter so the manager — created once and held
  // in managerRef across the screen's lifetime — re-reads destination, unit,
  // and display currency on every inspect(). Without this, opening amountEntry
  // a second time from a different destination (sendEcash → meltQuote) or
  // after a settings currency change keeps the first-render snapshot.
  const derivedAmountConfig = useMemo(():
    | CreateAmountActionManagerConfig
    | undefined => {
    if (!isAmountEntry || options?.amountConfig) return undefined;
    return {
      getMintUrl: () => machineRef.current.getContext().mintUrl,
      getProofAmounts: () => {
        const mint = machineRef.current.getContext().mintUrl;
        return mint ? (walletContextRef.current?.proofAmounts[mint] ?? []) : [];
      },
      getBtcPrice: () => getBtcPriceRef.current?.() ?? 0,
      offlineOptimization: () =>
        machineRef.current.getContext().destination === 'sendEcash',
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

  const sessionRef = useRef<ScreenActionSession<ScreenType> | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createScreenActionSession({
      screenType,
      handlers,
      defaultHandlers: defaultHandlersForScreen,
      entrySeed: entryParam,
      getExtraContext: () => getExtraContextRef.current(),
      amountConfig: effectiveAmountConfig,
      subscriptionBus: subscriptionBusRef.current,
      bridge: sessionBridgeRef.current ?? undefined,
    });
  }

  const session = sessionRef.current;

  useEffect(() => {
    session.setEntrySeed(entryParam);
  }, [entryParam, session]);

  useEffect(() => {
    return () => session.dispose();
  }, [session]);

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.inspect,
    session.inspect,
  );

  const actions = useMemo(() => {
    const bound = {} as Record<ScreenActionName[ScreenType], BoundAction>;
    for (const [name, state] of Object.entries(snapshot.actions) as [
      ScreenActionName[ScreenType],
      ActionState,
    ][]) {
      bound[name] = {
        ...state,
        execute: (params?: Record<string, unknown>) =>
          session.execute(name, params),
      };
    }
    return bound;
  }, [snapshot.actions, session]);

  if (isAmountEntry) {
    return {
      entry: snapshot.entry,
      error: snapshot.error,
      actions: actions as Record<ScreenActionName['amountEntry'], BoundAction>,
      mintUrl: snapshot.mintUrl,
      source: null,
      suggestions: snapshot.suggestions,
    } as UseScreenActionsResult<ScreenType, any>;
  }

  return {
    entry: snapshot.entry,
    error: snapshot.error,
    actions,
    mintUrl: snapshot.mintUrl,
    source: snapshot.source,
    suggestions: [],
  } as UseScreenActionsResult<ScreenType, any>;
}

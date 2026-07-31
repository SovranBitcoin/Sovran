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
import { logger } from '../logger';
import {
  getUnitAmountEnvelope,
  type AmountEntryEnvelope,
} from '../mint-capabilities';
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

function summarizeEntryParam(
  entryParam: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (entryParam == null) return { entryKind: 'none' };
  if (typeof entryParam === 'string') {
    return { entryKind: 'string', entryLength: entryParam.length };
  }

  const keys = Object.keys(entryParam);
  const normalized = keys.map((key) => key.toLowerCase());
  return {
    entryKind: 'object',
    entryKeyCount: keys.length,
    hasAmount: normalized.includes('amount'),
    hasMintUrl: normalized.includes('minturl'),
    hasToken: normalized.some((key) => key.includes('token')),
    hasPaymentRequest: normalized.some((key) => key.includes('paymentrequest')),
    hasMeltTarget: normalized.some((key) => key.includes('melttarget')),
    hasQuoteId: normalized.some((key) => key.includes('quoteid')),
    hasOperationId: normalized.some((key) => key.includes('operationid')),
  };
}

function summarizeHandlerMap(
  handlers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const names = Object.keys(handlers ?? {}).sort();
  return {
    handlerCount: names.length,
    handlerNames: names,
  };
}

function summarizeActionStates(
  actions: Record<string, ActionState>,
): Record<string, unknown> {
  const entries = Object.entries(actions);
  let availableCount = 0;
  let loadingCount = 0;
  let variantCount = 0;
  let unavailableCount = 0;

  for (const [, state] of entries) {
    if (state.available) availableCount += 1;
    else unavailableCount += 1;
    if (state.loading) loadingCount += 1;
    variantCount += state.variants?.length ?? 0;
  }

  return {
    actionCount: entries.length,
    availableCount,
    unavailableCount,
    loadingCount,
    variantCount,
    actionNames: entries.map(([name]) => name).sort(),
  };
}

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
    logger.info('react.useScreenActionsWithConfig.session.create', {
      screenType,
      ...summarizeEntryParam(entryParam),
      ...summarizeHandlerMap(handlers as Record<string, unknown> | undefined),
      defaultHandlerCount: Object.keys(defaultHandlers ?? {}).length,
      hasGetExtraContext: !!getExtraContext,
      hasEntryUpdates: !!onEntryUpdate,
      hasShouldApplyEntryUpdate: !!shouldApplyEntryUpdate,
      hasMergeEntryUpdate: !!mergeEntryUpdate,
      hasAmountConfig: !!amountConfig,
    });
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
  const snapshotKeyRef = useRef<string | null>(null);

  useEffect(() => {
    logger.debug('react.useScreenActionsWithConfig.entrySeed', {
      screenType,
      ...summarizeEntryParam(entryParam),
    });
    session.setEntrySeed(entryParam);
  }, [entryParam, screenType, session]);

  useEffect(() => {
    return () => {
      logger.info('react.useScreenActionsWithConfig.session.dispose', {
        screenType,
      });
      session.dispose();
    };
  }, [screenType, session]);

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.inspect,
    session.inspect,
  );

  useEffect(() => {
    const actionSummary = summarizeActionStates(snapshot.actions);
    const key = JSON.stringify({
      screenType,
      error: snapshot.error,
      mintUrlLength: snapshot.mintUrl?.length ?? 0,
      suggestionCount: snapshot.suggestions.length,
      ...actionSummary,
      ...summarizeEntryParam(snapshot.entry),
    });
    if (snapshotKeyRef.current === key) return;
    snapshotKeyRef.current = key;
    logger.debug('react.useScreenActionsWithConfig.snapshot', {
      screenType,
      hasError: !!snapshot.error,
      errorLength: snapshot.error?.length ?? 0,
      hasMintUrl: !!snapshot.mintUrl,
      mintUrlLength: snapshot.mintUrl?.length ?? 0,
      suggestionCount: snapshot.suggestions.length,
      ...summarizeEntryParam(snapshot.entry),
      ...actionSummary,
    });
  }, [screenType, snapshot]);

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

  const envelopeCacheRef = useRef<{
    walletCtx: unknown;
    unit: string;
    destination: unknown;
    method: unknown;
    envelope: AmountEntryEnvelope | null;
  } | null>(null);

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
      // Quick-send suggestions belong to every ecash SEND path: direct sends
      // and paying a NUT-18 payment request. Melt (lightning/onchain) and the
      // receive destinations never show them. Deliberately wider than
      // offlineOptimization — a payment request needs a live transport, so the
      // offline icon / fiat-window optimization must stay direct-send only.
      suggestionsEnabled: () => {
        const destination = machineRef.current.getContext().destination;
        return destination === 'sendEcash' || destination === 'paymentRequest';
      },
      unit: () => machineRef.current.getContext().unit,
      fiatCurrency: () => getDisplayCurrencyRef.current?.()?.code,
      fiatSymbol: () => getDisplayCurrencyRef.current?.()?.symbol,
      getAmountEnvelope: () => {
        const walletCtx = walletContextRef.current;
        if (!walletCtx) return null;
        const machineCtx = machineRef.current.getContext();
        // The method actually in play (bolt11/bolt12/onchain) governs the
        // melt/mint bounds, so it's part of the envelope's identity.
        const method =
          machineCtx.destination === 'meltQuote'
            ? machineCtx.meltQuoteMethod
            : machineCtx.destination === 'mintQuote'
              ? machineCtx.mintQuoteMethod
              : undefined;
        // The manager re-reads this on every keystroke AND every inspect
        // (useSyncExternalStore getSnapshot runs 2+× per render), while the
        // envelope only changes with the wallet context, unit, destination, or
        // method — memoize on those so typing doesn't re-derive per-mint bounds
        // several times per key.
        const cached = envelopeCacheRef.current;
        if (
          cached &&
          cached.walletCtx === walletCtx &&
          cached.unit === machineCtx.unit &&
          cached.destination === machineCtx.destination &&
          cached.method === method
        ) {
          return cached.envelope;
        }
        const envelope = getUnitAmountEnvelope(
          walletCtx,
          machineCtx.unit,
          machineCtx.destination,
          method,
        );
        envelopeCacheRef.current = {
          walletCtx,
          unit: machineCtx.unit,
          destination: machineCtx.destination,
          method,
          envelope,
        };
        return envelope;
      },
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
    logger.info('react.useScreenActions.session.create', {
      screenType,
      isAmountEntry,
      ...summarizeEntryParam(entryParam),
      ...summarizeHandlerMap(handlers as Record<string, unknown> | undefined),
      defaultHandlerCount: Object.keys(defaultHandlersForScreen ?? {}).length,
      hasBridge: !!screenActionsBridge,
      hasSubscriptionBus: !!subscriptionBusRef.current,
      hasEffectiveAmountConfig: !!effectiveAmountConfig,
      hasProvidedAmountConfig: !!options?.amountConfig,
      hasDerivedAmountConfig: !!derivedAmountConfig,
    });
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
  const snapshotKeyRef = useRef<string | null>(null);

  useEffect(() => {
    logger.debug('react.useScreenActions.entrySeed', {
      screenType,
      isAmountEntry,
      ...summarizeEntryParam(entryParam),
    });
    session.setEntrySeed(entryParam);
  }, [entryParam, isAmountEntry, screenType, session]);

  useEffect(() => {
    return () => {
      logger.info('react.useScreenActions.session.dispose', {
        screenType,
        isAmountEntry,
      });
      session.dispose();
    };
  }, [isAmountEntry, screenType, session]);

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.inspect,
    session.inspect,
  );

  useEffect(() => {
    const actionSummary = summarizeActionStates(snapshot.actions);
    const key = JSON.stringify({
      screenType,
      isAmountEntry,
      error: snapshot.error,
      mintUrlLength: snapshot.mintUrl?.length ?? 0,
      sourceLength: snapshot.source?.length ?? 0,
      suggestionCount: snapshot.suggestions.length,
      ...actionSummary,
      ...summarizeEntryParam(snapshot.entry),
    });
    if (snapshotKeyRef.current === key) return;
    snapshotKeyRef.current = key;
    logger.debug('react.useScreenActions.snapshot', {
      screenType,
      isAmountEntry,
      hasError: !!snapshot.error,
      errorLength: snapshot.error?.length ?? 0,
      hasMintUrl: !!snapshot.mintUrl,
      mintUrlLength: snapshot.mintUrl?.length ?? 0,
      hasSource: !!snapshot.source,
      sourceLength: snapshot.source?.length ?? 0,
      suggestionCount: snapshot.suggestions.length,
      ...summarizeEntryParam(snapshot.entry),
      ...actionSummary,
    });
  }, [isAmountEntry, screenType, snapshot]);

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

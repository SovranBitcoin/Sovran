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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';

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

/**
 * Builds the session for `useScreenActionsWithConfig`, in module scope.
 *
 * Every getter below reads `someRef.current` — correct, and exactly what the
 * session needs so it always sees the caller's latest callbacks. But a closure
 * CREATED during render that reads a ref is what the React Compiler rejects
 * ("Passing a ref to a function may read its value during render"), and one
 * rejection switches the compiler off for the whole hook. Outside the
 * component the reads are unchanged and the analysis no longer applies.
 */
function buildConfigSession<S extends ScreenType>(
  config: UseScreenActionsConfig<S>,
  refs: {
    getExtraContextRef: MutableRefObject<
      UseScreenActionsConfig<S>['getExtraContext']
    >;
    onEntryUpdateRef: MutableRefObject<
      UseScreenActionsConfig<S>['onEntryUpdate']
    >;
    shouldApplyEntryUpdateRef: MutableRefObject<
      UseScreenActionsConfig<S>['shouldApplyEntryUpdate']
    >;
    mergeEntryUpdateRef: MutableRefObject<
      UseScreenActionsConfig<S>['mergeEntryUpdate']
    >;
    amountConfigRef: MutableRefObject<
      UseScreenActionsConfig<S>['amountConfig']
    >;
  },
): ScreenActionSession<S> {
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

  return createScreenActionSession<S>({
    screenType,
    handlers,
    defaultHandlers,
    entrySeed: entryParam,
    getExtraContext: () => refs.getExtraContextRef.current?.() ?? {},
    subscribeEntryUpdates: onEntryUpdate
      ? (callback) => refs.onEntryUpdateRef.current?.(callback) ?? (() => {})
      : undefined,
    shouldApplyEntryUpdate: shouldApplyEntryUpdate
      ? (current, updated) =>
          refs.shouldApplyEntryUpdateRef.current!(current, updated)
      : undefined,
    mergeEntryUpdate: mergeEntryUpdate
      ? (current, updated) =>
          refs.mergeEntryUpdateRef.current!(current, updated)
      : undefined,
    amountConfig:
      screenType === 'amountEntry'
        ? (refs.amountConfigRef.current ?? undefined)
        : undefined,
    decorateEntry: (entry) => entry,
  });
}

export function useScreenActionsWithConfig<S extends ScreenType>(
  config: UseScreenActionsConfig<S>,
): Omit<UseScreenActionsResult<S>, 'source'> {
  const {
    screenType,
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

  // Created exactly once, through a `useState` initializer rather than the
  // `if (!ref.current)` lazy-init idiom this used to use. Reading a ref back
  // out in the render body — `const session = sessionRef.current` — is a ref
  // access during render, which is both a Rules-of-React violation and what
  // stopped the React Compiler from compiling this hook at all.
  //
  // ⚠️ `createScreenActionSession` subscribes at construction, and a `useState`
  // initializer is double-invoked under React StrictMode — which would leak
  // the discarded session's subscriptions. StrictMode is off in the app that
  // consumes this (`index.js` hands straight to Expo Router), and the same
  // caveat already stands on the lazy initializer in
  // `NotificationFollowersScreen`. Turning StrictMode on means giving the
  // session an idempotent construction, not reverting this: the ref idiom it
  // replaced is a ref read in render, which the compiler refuses outright.
  const [session] = useState(() =>
    buildConfigSession<S>(config, {
      getExtraContextRef,
      onEntryUpdateRef,
      shouldApplyEntryUpdateRef,
      mergeEntryUpdateRef,
      amountConfigRef,
    }),
  );
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

/**
 * The provider context, as a type. Everything below takes the ref OBJECTS off
 * it rather than their values: reading `.current` is what these getters are
 * for, but a closure created during render that reads a ref is what the React
 * Compiler rejects — and one rejection stops it compiling the entire hook, so
 * every component using screen actions renders unmemoized. Built out here, the
 * reads are identical and the render-scope analysis no longer applies.
 */
type ColadaRefs = ReturnType<typeof useColadaContext>;

function notifyThrough(
  notificationsRef: ColadaRefs['notificationsRef'],
): (event: string, ...args: unknown[]) => void {
  return (event, ...args) => {
    const notifications = notificationsRef.current;
    if (!notifications) return;
    const handler = (
      notifications as Record<string, ((...a: unknown[]) => void) | undefined>
    )[event];
    if (typeof handler === 'function') handler(...args);
  };
}

function buildExtraContextGetter(refs: {
  machineRef: MutableRefObject<ColadaRefs['machine']>;
  writeClipboardRef: ColadaRefs['writeClipboardRef'];
  shareContentRef: ColadaRefs['shareContentRef'];
  adaptersRef: ColadaRefs['adaptersRef'];
  notificationsRef: ColadaRefs['notificationsRef'];
}): () => Record<string, unknown> {
  const notify = notifyThrough(refs.notificationsRef);
  return () => ({
    paymentMachine: refs.machineRef.current,
    writeClipboard: refs.writeClipboardRef.current,
    shareContent: refs.shareContentRef.current,
    adapters: refs.adaptersRef.current,
    notify,
  });
}

function buildSessionBridge(refs: {
  bridgeRef: MutableRefObject<ScreenActionsBridge | undefined>;
  getLocaleRef: ColadaRefs['getLocaleRef'];
}): ScreenActionsBridge {
  const { bridgeRef, getLocaleRef } = refs;
  return {
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

function buildDefaultHandlers(refs: {
  machineRef: MutableRefObject<ColadaRefs['machine']>;
  operationsRef: ColadaRefs['operationsRef'];
  getOfflineRef: ColadaRefs['getOfflineRef'];
  notificationsRef: ColadaRefs['notificationsRef'];
  navigationRef: ColadaRefs['navigationRef'];
}): ReturnType<typeof createDefaultScreenActionHandlers> {
  const { machineRef, operationsRef, getOfflineRef, navigationRef } = refs;
  return createDefaultScreenActionHandlers({
    getMachine: () => machineRef.current,
    getOperations: () => operationsRef.current,
    getOffline: () => getOfflineRef.current?.() ?? false,
    notify: notifyThrough(refs.notificationsRef),
    navigation: {
      scanQr: (...args) => navigationRef.current?.scanQr?.(...args),
      mintInfo: (...args) => navigationRef.current?.mintInfo?.(...args),
      addMint: () => navigationRef.current?.addMint?.(),
      goBack: () => navigationRef.current?.goBack?.(),
    },
  });
}

/**
 * The amount-entry config derived from provider context, in module scope for
 * the same reason as the builders above: every field is a getter that reads a
 * ref, and building them during render is what the React Compiler rejects.
 *
 * The envelope memo lives in this closure rather than in a hook-level ref. It
 * is private memoisation for `getAmountEnvelope` — nothing else ever read it —
 * and being a ref was the only thing that made it visible to render at all.
 */
function buildDerivedAmountConfig(refs: {
  machineRef: MutableRefObject<ColadaRefs['machine']>;
  walletContextRef: ColadaRefs['walletContextRef'];
  getBtcPriceRef: ColadaRefs['getBtcPriceRef'];
  getDisplayCurrencyRef: ColadaRefs['getDisplayCurrencyRef'];
}): CreateAmountActionManagerConfig {
  const {
    machineRef,
    walletContextRef,
    getBtcPriceRef,
    getDisplayCurrencyRef,
  } = refs;
  let cached: {
    walletCtx: unknown;
    unit: string;
    destination: unknown;
    method: unknown;
    envelope: AmountEntryEnvelope | null;
  } | null = null;

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
      cached = {
        walletCtx,
        unit: machineCtx.unit,
        destination: machineCtx.destination,
        method,
        envelope,
      };
      return envelope;
    },
  };
}

/**
 * Builds the provider-driven session. Module scope so the one remaining
 * render-time `subscriptionBusRef.current` read moves out of the component
 * with it — that single read was enough to keep the whole hook uncompiled.
 */
function buildScreenSession(
  args: {
    screenType: ScreenType;
    isAmountEntry: boolean;
    handlers: ScreenActionHandlerMap[ScreenType];
    defaultHandlers: ScreenActionHandlerMap[ScreenType];
    entryParam: Record<string, unknown> | string | undefined;
    screenActionsBridge: ScreenActionsBridge | undefined;
    amountConfig: CreateAmountActionManagerConfig | undefined;
    providedAmountConfig: CreateAmountActionManagerConfig | undefined;
    derivedAmountConfig: CreateAmountActionManagerConfig | undefined;
    getExtraContext: () => Record<string, unknown>;
    sessionBridge: ScreenActionsBridge;
  },
  subscriptionBusRef: ColadaRefs['subscriptionBusRef'],
): ScreenActionSession<ScreenType> {
  const subscriptionBus = subscriptionBusRef.current;
  logger.info('react.useScreenActions.session.create', {
    screenType: args.screenType,
    isAmountEntry: args.isAmountEntry,
    ...summarizeEntryParam(args.entryParam),
    ...summarizeHandlerMap(
      args.handlers as Record<string, unknown> | undefined,
    ),
    defaultHandlerCount: Object.keys(args.defaultHandlers ?? {}).length,
    hasBridge: !!args.screenActionsBridge,
    hasSubscriptionBus: !!subscriptionBus,
    hasEffectiveAmountConfig: !!args.amountConfig,
    hasProvidedAmountConfig: !!args.providedAmountConfig,
    hasDerivedAmountConfig: !!args.derivedAmountConfig,
  });
  return createScreenActionSession({
    screenType: args.screenType,
    handlers: args.handlers,
    defaultHandlers: args.defaultHandlers,
    entrySeed: args.entryParam,
    getExtraContext: args.getExtraContext,
    amountConfig: args.amountConfig,
    subscriptionBus,
    bridge: args.sessionBridge,
  });
}

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

  // Built once, from the ref OBJECTS, outside the component. Every getter
  // still reads `.current` when the session calls it — the reads are
  // unchanged. What changed is that the closures are no longer created during
  // render, which is what the React Compiler refuses to compile past.
  const [getExtraContext] = useState(() =>
    buildExtraContextGetter({
      machineRef,
      writeClipboardRef,
      shareContentRef,
      adaptersRef,
      notificationsRef,
    }),
  );

  const [sessionBridge] = useState(() =>
    buildSessionBridge({ bridgeRef, getLocaleRef }),
  );

  const handlersRaw = isAmountEntry
    ? screenActionHandlers.amountEntry
    : screenActionHandlers[screenType as Exclude<ScreenType, 'amountEntry'>];
  const handlers = (handlersRaw ??
    {}) as ScreenActionHandlerMap[typeof screenType];

  // Build default handlers from operations + notifications + navigation.
  // Uses refs so the handlers always read fresh values.
  const allDefaults = useMemo(
    () =>
      buildDefaultHandlers({
        machineRef,
        operationsRef,
        getOfflineRef,
        notificationsRef,
        navigationRef,
      }),
    [machineRef, operationsRef, getOfflineRef, notificationsRef, navigationRef],
  );
  const defaultHandlersForScreen = (
    isAmountEntry
      ? allDefaults.amountEntry
      : allDefaults[screenType as Exclude<ScreenType, 'amountEntry'>]
  ) as ScreenActionHandlerMap[typeof screenType];

  // Auto-derive amountConfig from provider context when not explicitly
  // provided. Every reactive field is a getter so the manager — created once
  // and held for the screen's lifetime — re-reads destination, unit, and
  // display currency on every inspect(). Without this, opening amountEntry a
  // second time from a different destination (sendEcash → meltQuote) or after
  // a settings currency change keeps the first-render snapshot.
  const derivedAmountConfig = useMemo(
    () =>
      !isAmountEntry || options?.amountConfig
        ? undefined
        : buildDerivedAmountConfig({
            machineRef,
            walletContextRef,
            getBtcPriceRef,
            getDisplayCurrencyRef,
          }),
    [
      isAmountEntry,
      options?.amountConfig,
      machineRef,
      walletContextRef,
      getBtcPriceRef,
      getDisplayCurrencyRef,
    ],
  );

  const effectiveAmountConfig = isAmountEntry
    ? (options?.amountConfig ?? derivedAmountConfig)
    : undefined;

  // Created exactly once, through a `useState` initializer rather than the
  // `if (!ref.current)` lazy-init idiom. Reading the session back out of a ref
  // in the render body is a ref access during render — a Rules-of-React
  // violation, and one of the things that kept this hook uncompiled.
  //
  // ⚠️ `createScreenActionSession` subscribes at construction, and a `useState`
  // initializer is double-invoked under React StrictMode — which would leak
  // the discarded session's subscriptions. StrictMode is off in the app that
  // consumes this (`index.js` hands straight to Expo Router), and the same
  // caveat already stands on the lazy initializer in
  // `NotificationFollowersScreen`. Turning StrictMode on means giving the
  // session an idempotent construction, not reverting this: the ref idiom it
  // replaced is a ref read in render, which the compiler refuses outright.
  const [session] = useState(() =>
    buildScreenSession(
      {
        screenType,
        isAmountEntry,
        handlers,
        defaultHandlers: defaultHandlersForScreen,
        entryParam,
        screenActionsBridge,
        amountConfig: effectiveAmountConfig,
        providedAmountConfig: options?.amountConfig,
        derivedAmountConfig,
        getExtraContext,
        sessionBridge,
      },
      subscriptionBusRef,
    ),
  );
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

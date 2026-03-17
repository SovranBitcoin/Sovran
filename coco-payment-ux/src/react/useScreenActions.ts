// ---------------------------------------------------------------------------
// useScreenActions — post-terminal screen action management
//
// Creates a ScreenActionManager, subscribes to entry updates, and returns
// bound actions with execute functions. Platform-specific concerns (wallet
// manager, history events) are injected via config.
//
// Usage:
//   const { entry, error, actions } = useScreenActions({
//     screenType: 'sendToken',
//     handlers: mySendTokenHandlers,
//     entryParam: routeParams.sendHistoryEntry,
//     getExtraContext: () => ({ manager: walletManager }),
//     onEntryUpdate: (cb) => manager.on('history:updated', ({ entry }) => cb(entry)),
//   });
//
//   // In UI:
//   <Button disabled={!actions.copy.available} loading={actions.copy.loading}
//           onPress={actions.copy.execute} />
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { createScreenActionManager } from '../screen-actions/createManager';
import type {
  ActionState,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from '../screen-actions/types';

// ---------------------------------------------------------------------------
// Entry parsing
// ---------------------------------------------------------------------------

function parseEntryParam<T>(param: T | string | undefined): {
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
  return { parsed: param as Record<string, unknown>, error: null };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoundAction = ActionState & { execute: () => Promise<void> };

export interface UseScreenActionsConfig<S extends ScreenType> {
  screenType: S;
  /** Action handlers for this screen type. */
  handlers: ScreenActionHandlerMap[S];
  /** Raw entry param — JSON string or parsed object. */
  entryParam: Record<string, unknown> | string | undefined;
  /**
   * Returns extra context merged into the action context on every execute.
   * Use a ref-reader if the value changes between renders.
   */
  getExtraContext?: () => Record<string, unknown>;
  /**
   * Subscribe to entry updates from the wallet (e.g. history:updated events).
   * Called with a callback that should be invoked with the updated entry.
   * Return an unsubscribe function.
   */
  onEntryUpdate?: (callback: (entry: Record<string, unknown>) => void) => () => void;
  /**
   * Custom matcher for incoming entry updates. Defaults to matching by `id` + `type`.
   * Useful when a synthetic preview entry later attaches to a real history/operation entry.
   */
  shouldApplyEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>
  ) => boolean;
  /**
   * Custom merge for incoming entry updates. Defaults to replacing the entry wholesale.
   * Useful when live updates must preserve preview metadata on the current screen entry.
   */
  mergeEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>
  ) => Record<string, unknown>;
}

export interface UseScreenActionsResult<S extends ScreenType> {
  entry: Record<string, unknown> | null;
  error: string | null;
  actions: Record<ScreenActionName[S], BoundAction>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScreenActions<S extends ScreenType>(
  config: UseScreenActionsConfig<S>
): UseScreenActionsResult<S> {
  const {
    screenType,
    handlers,
    entryParam,
    getExtraContext,
    onEntryUpdate,
    shouldApplyEntryUpdate,
    mergeEntryUpdate,
  } = config;

  const getExtraContextRef = useRef(getExtraContext);
  getExtraContextRef.current = getExtraContext;
  const shouldApplyEntryUpdateRef = useRef(shouldApplyEntryUpdate);
  shouldApplyEntryUpdateRef.current = shouldApplyEntryUpdate;
  const mergeEntryUpdateRef = useRef(mergeEntryUpdate);
  mergeEntryUpdateRef.current = mergeEntryUpdate;

  const { parsed, error } = useMemo(() => parseEntryParam(entryParam), [entryParam]);

  const managerRef = useRef<ScreenActionManager<S> | null>(null);

  if (!managerRef.current) {
    managerRef.current = createScreenActionManager<S>({
      screenType,
      handlers,
      getContext: () => ({
        entry: managerRef.current?.getEntry() ?? {},
        manager: null, // Wallet provides via getExtraContext
        setEntry: (e: Record<string, unknown>) => managerRef.current?.setEntry(e),
        ...getExtraContextRef.current?.(),
      }),
    });
  }

  const actionManager = managerRef.current;

  // Seed the initial entry
  useEffect(() => {
    if (parsed) {
      actionManager.setEntry(parsed);
    }
  }, [parsed, actionManager]);

  // Subscribe to entry updates
  useEffect(() => {
    if (!parsed || !onEntryUpdate) return;

    return onEntryUpdate((updated) => {
      const currentEntry = actionManager.getEntry();
      const shouldApply = shouldApplyEntryUpdateRef.current ?? defaultShouldApplyEntryUpdate;
      if (shouldApply(currentEntry, updated)) {
        const mergeEntry = mergeEntryUpdateRef.current ?? defaultMergeEntryUpdate;
        actionManager.setEntry(mergeEntry(currentEntry, updated));
      }
    });
  }, [parsed, onEntryUpdate, actionManager]);

  // Subscribe to manager state via useSyncExternalStore
  const rawState = useSyncExternalStore(
    actionManager.subscribe,
    actionManager.inspect,
    actionManager.inspect
  );

  // Bind execute to each action name (stable refs via the manager)
  const actions = useMemo(() => {
    const bound = {} as Record<ScreenActionName[S], BoundAction>;
    for (const [name, state] of Object.entries(rawState) as [ScreenActionName[S], ActionState][]) {
      bound[name] = {
        ...state,
        execute: () => actionManager.execute(name),
      };
    }
    return bound;
  }, [rawState, actionManager]);

  const entry = actionManager.getEntry();

  return { entry, error, actions };
}

function defaultShouldApplyEntryUpdate(
  currentEntry: Record<string, unknown> | null,
  updatedEntry: Record<string, unknown>
): boolean {
  const currentId = currentEntry?.id;
  const currentType = currentEntry?.type;
  const updatedId = updatedEntry.id;
  const updatedType = updatedEntry.type;

  return (
    typeof currentId === 'string' &&
    typeof currentType === 'string' &&
    currentId === updatedId &&
    currentType === updatedType
  );
}

function defaultMergeEntryUpdate(
  _currentEntry: Record<string, unknown> | null,
  updatedEntry: Record<string, unknown>
): Record<string, unknown> {
  return updatedEntry;
}

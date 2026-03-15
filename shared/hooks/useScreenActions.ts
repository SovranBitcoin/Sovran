import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import type { HistoryEntry } from 'coco-cashu-core';

import { debugLog } from '@/shared/lib/debugLog';
import { useManager } from 'coco-cashu-react';

import {
  createScreenActionManager,
  type ActionState,
  type ScreenActionHandlerMap,
  type ScreenActionManager,
  type ScreenActionName,
  type ScreenType,
} from 'coco-payment-ux';

import { createSovranScreenActionHandlers } from '@/features/send/lib/screenActionHandlers';

// ---------------------------------------------------------------------------
// Entry parsing (mirrors useHistoryEntry logic)
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
// Lazy handler singleton
// ---------------------------------------------------------------------------

let _handlers: ScreenActionHandlerMap | null = null;
function getHandlers(): ScreenActionHandlerMap {
  if (!_handlers) {
    _handlers = createSovranScreenActionHandlers();
  }
  return _handlers;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

type BoundAction = ActionState & { execute: () => Promise<void> };

export interface UseScreenActionsResult<
  S extends ScreenType,
  E extends HistoryEntry = HistoryEntry,
> {
  entry: E | null;
  error: string | null;
  actions: Record<ScreenActionName[S], BoundAction>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScreenActions<S extends ScreenType, E extends HistoryEntry = HistoryEntry>(
  screenType: S,
  entryParam: E | string | undefined,
  extraContext?: Record<string, unknown>
): UseScreenActionsResult<S, E> {
  const manager = useManager();

  const extraContextRef = useRef(extraContext);
  extraContextRef.current = extraContext;

  useEffect(() => {
    if (extraContext && Object.keys(extraContext).length > 0) {
      debugLog({
        location: 'useScreenActions',
        message: 'extraContext provided (e.g. operationId for meltQuote)',
        phase: 'entry',
        data: { screenType, keys: Object.keys(extraContext) },
      });
    }
  }, [screenType, extraContext]);

  const { parsed, error } = useMemo(() => parseEntryParam(entryParam), [entryParam]);

  const managerRef = useRef<ScreenActionManager<S> | null>(null);

  if (!managerRef.current) {
    const handlers = getHandlers();
    managerRef.current = createScreenActionManager<S>({
      screenType,
      handlers: handlers[screenType] as ScreenActionHandlerMap[S],
      getContext: () => ({
        entry: managerRef.current?.getEntry() ?? {},
        manager,
        setEntry: (e: Record<string, unknown>) => managerRef.current?.setEntry(e),
        ...extraContextRef.current,
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

  // Subscribe to history:updated and push new entries into the manager.
  // Uses the *current* entry ID (from actionManager.getEntry()) rather than
  // the initial parsedId so that when a handler replaces a synthetic entry
  // with a real one (e.g. melt preview → real operation), subsequent events
  // match on the real ID.
  useEffect(() => {
    if (!parsed) return;

    const handleHistoryUpdated = ({ entry: updated }: { mintUrl: string; entry: HistoryEntry }) => {
      const currentEntry = actionManager.getEntry();
      const currentId = (currentEntry as { id?: string } | null)?.id;
      const currentType = (currentEntry as { type?: string } | null)?.type;
      if (currentId && updated.id === currentId && updated.type === currentType) {
        actionManager.setEntry(updated as unknown as Record<string, unknown>);
      }
    };

    const unsubscribe = manager.on('history:updated', handleHistoryUpdated);
    return () => {
      unsubscribe();
    };
  }, [parsed, manager, actionManager]);

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

  return {
    entry: actionManager.getEntry() as E | null,
    error,
    actions,
  };
}

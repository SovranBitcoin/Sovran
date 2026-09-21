import { useEffect, useRef } from 'react';

import { paymentLog } from '@/shared/lib/logger';

import type { MintRow } from './useMintRowsWithCache';

/** One row as the list paints it, short enough to survive the logger's string cap. */
function describeRow(row: MintRow): string {
  const reason = row.reason ? `(${row.reason.code})` : '';
  const units = row.supportedUnits ? row.supportedUnits.join(',') || 'none' : 'unknown';
  const named = row.displayName && row.displayName !== row.mintUrl ? 'named' : 'url-only';
  return `${row.status}${reason} units=${units} meta=${row.metaState} ${named} ${row.iconUrl ? 'icon' : 'no-icon'} balance=${row.balance}`;
}

/**
 * What one painted list looks like and how it differs from the one before it.
 * Both maps are keyed by mint with one short string each: the logger keeps only
 * the first few items of an array. `changes` is what makes a false first render
 * visible — a row that appears, disappears or gains its units after frame 1.
 */
export function describeMintSelectorFrame(
  previous: Record<string, string> | null,
  rows: readonly MintRow[]
): { rows: Record<string, string>; changes: Record<string, string> } {
  const next = Object.fromEntries(rows.map((row) => [row.mintUrl, describeRow(row)]));
  const changes: Record<string, string> = {};
  if (previous) {
    for (const [mintUrl, described] of Object.entries(next)) {
      const before = previous[mintUrl];
      if (before === undefined) changes[mintUrl] = `ADDED: ${described}`;
      else if (before !== described) changes[mintUrl] = `WAS: ${before}`;
    }
    for (const mintUrl of Object.keys(previous)) {
      if (!(mintUrl in next)) changes[mintUrl] = 'REMOVED';
    }
  }
  return { rows: next, changes };
}

interface MintSelectorFrameLogArgs {
  flow: 'send' | 'receive';
  /** Who asked for the picker: the entry's scope and destination. */
  scope: unknown;
  destination: unknown;
  /** The machine step while this frame painted. */
  step: string;
  /** Where the rows came from: the live step, the last live step, or the route entry. */
  source: 'live' | 'previous-live' | 'entry' | 'none';
  itemsStatus: 'loading' | 'ready' | 'failed' | undefined;
  rows: readonly MintRow[];
}

/**
 * Logs every distinct list the mint selector paints, numbered from its mount.
 * Frame 1 with `changes: {}` and no later frame is the goal; anything after it
 * names the row that moved and what it looked like before.
 */
export function useMintSelectorFrameLog({
  flow,
  scope,
  destination,
  step,
  source,
  itemsStatus,
  rows,
}: MintSelectorFrameLogArgs): void {
  const mountedAtRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const previousRef = useRef<Record<string, string> | null>(null);
  const previousKeyRef = useRef('');

  useEffect(() => {
    mountedAtRef.current ??= performance.now();
    const described = describeMintSelectorFrame(previousRef.current, rows);
    const key = JSON.stringify([source, itemsStatus, step, described.rows]);
    if (key === previousKeyRef.current) return;
    previousKeyRef.current = key;
    previousRef.current = described.rows;
    frameRef.current += 1;
    paymentLog.info('mint.selector.frame', {
      frame: frameRef.current,
      msSinceMount: Math.round(performance.now() - mountedAtRef.current),
      flow,
      scope: scope ?? null,
      destination: destination ?? null,
      step,
      source,
      itemsStatus: itemsStatus ?? null,
      rowCount: rows.length,
      changeCount: Object.keys(described.changes).length,
      changes: described.changes,
      rows: described.rows,
    });
  }, [flow, scope, destination, step, source, itemsStatus, rows]);
}

import { useEffect, useRef, useState } from 'react';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { normalizeUrlForApi } from '@/shared/lib/url';
import { log, mintUrlLogFields } from '@/shared/lib/logger';

type MintImportStage =
  'waiting' | 'adding' | 'restoring' | 'complete' | 'restore-failed' | 'failed';
type MintImportItem = { url: string; stage: MintImportStage };
type MintImportState = { running: boolean; items: MintImportItem[] };

async function runMintImport(items: MintImportItem[], publish: (running: boolean) => void) {
  log.info('mint.add.batch.start', { count: items.length });
  try {
    const manager = CocoManager.getInstance();
    const isCurrentManager = () =>
      CocoManager.isInitialized() && CocoManager.getInstance() === manager;
    for (const item of items) {
      if (!isCurrentManager()) break;
      const startTime = performance.now();
      item.stage = 'adding';
      publish(true);
      try {
        await manager.mint.addMint(item.url, { trusted: true });
        log.info('mint.add.item.added', {
          ...mintUrlLogFields(item.url),
          duration_ms: Math.round(performance.now() - startTime),
        });
      } catch {
        item.stage = 'failed';
        log.warn('mint.add.item.failed', mintUrlLogFields(item.url));
        publish(true);
        continue;
      }
      // Keep a successfully added mint even if restoration fails or the profile changes.
      item.stage = 'restore-failed';
      if (!isCurrentManager()) break;
      item.stage = 'restoring';
      publish(true);
      const restoreTime = performance.now();
      try {
        await manager.wallet.restore(item.url);
        item.stage = 'complete';
        log.info('mint.add.restore.success', {
          ...mintUrlLogFields(item.url),
          duration_ms: Math.round(performance.now() - restoreTime),
        });
      } catch {
        item.stage = 'restore-failed';
        log.warn('mint.add.restore.failed', mintUrlLogFields(item.url));
      }
      publish(true);
    }
  } catch {
    log.warn('mint.add.batch.manager_unavailable');
  } finally {
    for (const item of items)
      if (item.stage === 'waiting' || item.stage === 'adding') item.stage = 'failed';
    publish(false);
  }
}

/** One batch per screen. A completed import remains visible until explicitly dismissed. */
export function useMintImport() {
  const [state, setState] = useState<MintImportState | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = async (urls: Iterable<string>) => {
    if (inFlight.current) return;
    const items: MintImportItem[] = [...new Set([...urls].map(normalizeUrlForApi))].map((url) => ({
      url,
      stage: 'waiting',
    }));
    if (items.length === 0) return;
    inFlight.current = true;
    const publish = (running: boolean) => {
      if (mounted.current) setState({ running, items: items.map((item) => ({ ...item })) });
    };
    publish(true);
    await runMintImport(items, publish).finally(() => {
      inFlight.current = false;
    });
  };

  return {
    state,
    start,
    dismiss: () => {
      if (!inFlight.current) setState(null);
    },
  };
}

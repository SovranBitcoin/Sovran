import { useCallback, useEffect, useState } from 'react';
import type { MarmotClient } from '@internet-privacy/marmot-ts';
import { useWhitenoise } from '../WhitenoiseContext';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { wnLog } from '@/shared/lib/logger';

const TARGET_KEY_PACKAGE_COUNT = 2;

type WhitenoiseSetupState = {
  isReady: boolean;
  keyPackageCount: number;
  isLoading: boolean;
  isBootstrapping: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
};

async function readCount(client: MarmotClient): Promise<number> {
  return client.keyPackages.count();
}

// Bodies live at module scope: try/finally cannot be lowered by the React
// Compiler and made every consumer of this hook carry an uncompiled hook slot.
type WhitenoiseClient = ReturnType<typeof useWhitenoise>['client'];
type WhitenoiseRelays = ReturnType<typeof useWhitenoise>['relays'];

async function refreshImpl(
  client: WhitenoiseClient,
  io: {
    setKeyPackageCount: (value: number) => void;
    setIsLoading: (value: boolean) => void;
    setError: (value: string | null) => void;
  }
): Promise<void> {
  if (!client) return;
  io.setIsLoading(true);
  try {
    const count = await readCount(client);
    io.setKeyPackageCount(count);
    io.setError(null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.setError(message);
    wnLog.warn('whitenoise.setup.refresh_failed', { error: message });
  } finally {
    io.setIsLoading(false);
  }
}

async function bootstrapImpl(
  client: WhitenoiseClient,
  relays: WhitenoiseRelays,
  io: {
    setKeyPackageCount: (value: number) => void;
    setIsBootstrapping: (value: boolean) => void;
    setError: (value: string | null) => void;
  }
): Promise<void> {
  if (!client) {
    io.setError('White Noise client not ready');
    return;
  }
  if (relays.length === 0) {
    io.setError('No relays configured');
    return;
  }
  io.setIsBootstrapping(true);
  io.setError(null);
  const targetRelays = [...relays];
  try {
    const startCount = await readCount(client);
    const need = Math.max(0, TARGET_KEY_PACKAGE_COUNT - startCount);
    wnLog.info('whitenoise.setup.bootstrap.start', {
      startCount,
      need,
      relays: targetRelays.length,
    });
    for (let i = 0; i < need; i++) {
      await client.keyPackages.create({ relays: targetRelays, isLastResort: true });
    }
    const finalCount = await readCount(client);
    io.setKeyPackageCount(finalCount);
    wnLog.info('whitenoise.setup.bootstrap.done', { count: finalCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.setError(message);
    wnLog.error('whitenoise.setup.bootstrap_failed', { error: message });
  } finally {
    io.setIsBootstrapping(false);
  }
}

export function useWhitenoiseSetup(): WhitenoiseSetupState {
  const { client, relays } = useWhitenoise();
  const [keyPackageCount, setKeyPackageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () => refreshImpl(client, { setKeyPackageCount, setIsLoading, setError }),
    [client]
  );

  useEffect(() => {
    void refresh();
    if (!client) return;
    // Listener path updates the count directly. A full `refresh()` here
    // would (a) flash isLoading on every event and disable the action
    // button mid-bootstrap, and (b) fire one count() RPC per
    // create() inside the bootstrap loop instead of one at the end.
    const onAdded = () => setKeyPackageCount((c) => c + 1);
    const onRemoved = () => setKeyPackageCount((c) => Math.max(0, c - 1));
    client.keyPackages.on('keyPackageAdded', onAdded);
    client.keyPackages.on('keyPackageRemoved', onRemoved);
    return () => {
      client.keyPackages.off('keyPackageAdded', onAdded);
      client.keyPackages.off('keyPackageRemoved', onRemoved);
    };
  }, [client, refresh]);

  const bootstrapInner = useCallback(
    () => bootstrapImpl(client, relays, { setKeyPackageCount, setIsBootstrapping, setError }),
    [client, relays]
  );

  // Key-package creation is finite-resource work — a duplicate concurrent
  // bootstrap would publish two key packages per slot and burn relay
  // round-trips. `isBootstrapping` is React state and lands too late.
  const bootstrap = useSingleFlight(bootstrapInner);

  return {
    isReady: keyPackageCount >= TARGET_KEY_PACKAGE_COUNT,
    keyPackageCount,
    isLoading,
    isBootstrapping,
    error,
    bootstrap,
    refresh,
  };
}

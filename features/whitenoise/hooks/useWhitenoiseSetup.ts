import { useCallback, useEffect, useState } from 'react';
import type { MarmotClient } from '@internet-privacy/marmot-ts';
import { useWhitenoise } from '../WhitenoiseProvider';
import { log } from '@/shared/lib/logger';

const wnLog = log.child({ module: 'whitenoise' });

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

export function useWhitenoiseSetup(): WhitenoiseSetupState {
  const { client, relays } = useWhitenoise();
  const [keyPackageCount, setKeyPackageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setIsLoading(true);
    try {
      const count = await readCount(client);
      setKeyPackageCount(count);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      wnLog.warn('whitenoise.setup.refresh_failed', { error: message });
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    if (!client) return;
    const onAdded = () => void refresh();
    const onRemoved = () => void refresh();
    client.keyPackages.on('keyPackageAdded', onAdded);
    client.keyPackages.on('keyPackageRemoved', onRemoved);
    return () => {
      client.keyPackages.off('keyPackageAdded', onAdded);
      client.keyPackages.off('keyPackageRemoved', onRemoved);
    };
  }, [client, refresh]);

  const bootstrap = useCallback(async () => {
    if (!client) {
      setError('White Noise client not ready');
      return;
    }
    if (relays.length === 0) {
      setError('No relays configured');
      return;
    }
    setIsBootstrapping(true);
    setError(null);
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
      setKeyPackageCount(finalCount);
      wnLog.info('whitenoise.setup.bootstrap.done', { count: finalCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      wnLog.error('whitenoise.setup.bootstrap_failed', { error: message });
    } finally {
      setIsBootstrapping(false);
    }
  }, [client, relays]);

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

import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { initLog, useInitMount } from '@/shared/lib/logger';
import { createPricelistFeed, type PricelistFeed } from '@/shared/lib/pricelistFeed';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';

initLog('Module', 'PricelistProvider loaded');

export const PricelistProvider = ({ children }: { children: React.ReactNode }) => {
  useInitMount('PricelistProvider');
  const setBtcPrices = usePricelistStore((s) => s.setBtcPrices);
  const setLoading = usePricelistStore((s) => s.setLoading);
  const setError = usePricelistStore((s) => s.setError);
  // Only the phone reporting no network pauses the feed. Failed reachability
  // probes do not: Coinbase's /v2/time can be the only probe, and Coinbase
  // being down is exactly when the feed must still reach Mempool.space; the
  // feed's own backoff bounds those retries.
  const { isDisconnected } = useOfflineStatus();

  const feedRef = useRef<PricelistFeed | null>(null);
  const offlineRef = useRef(isDisconnected);

  // Disconnected pauses the feed (cancelling any request); reconnecting
  // refreshes at once when a poll is due or the last one failed. The feed
  // ignores a repeated state. Declared first so a feed created below starts
  // from the current connectivity rather than dialling out while offline.
  useEffect(() => {
    offlineRef.current = isDisconnected;
    feedRef.current?.setOffline(isDisconnected);
  }, [isDisconnected]);

  useEffect(() => {
    const feed = createPricelistFeed({
      onPrices: setBtcPrices,
      onLoading: setLoading,
      onError: setError,
    });
    feedRef.current = feed;
    feed.setOffline(offlineRef.current);
    feed.start();
    return () => {
      feedRef.current = null;
      feed.stop();
    };
  }, [setBtcPrices, setLoading, setError]);

  // Refresh on foreground. The feed deduplicates requests and skips resumes
  // within 60 seconds of a successful poll.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      feedRef.current?.resume('foreground');
    });
    return () => subscription.remove();
  }, []);

  return <>{children}</>;
};

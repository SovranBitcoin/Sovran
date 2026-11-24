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
  const { isOffline } = useOfflineStatus();

  const feedRef = useRef<PricelistFeed | null>(null);
  const offlineRef = useRef(isOffline);

  // Confirmed offline pauses the feed (cancelling any request); reconnecting
  // refreshes at once when a poll is due or the last one failed. The feed
  // ignores a repeated state. Declared first so a feed created below starts
  // from the current connectivity rather than dialling out while offline.
  useEffect(() => {
    offlineRef.current = isOffline;
    feedRef.current?.setOffline(isOffline);
  }, [isOffline]);

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

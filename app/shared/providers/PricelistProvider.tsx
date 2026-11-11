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

  useEffect(() => {
    const feed = createPricelistFeed({
      onPrices: setBtcPrices,
      onLoading: setLoading,
      onError: setError,
    });
    feedRef.current = feed;
    feed.start();
    return () => {
      feedRef.current = null;
      feed.stop();
    };
  }, [setBtcPrices, setLoading, setError]);

  // Refresh on foreground or connectivity recovery. The feed deduplicates
  // requests and skips resumes within 60 seconds of a successful poll.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      feedRef.current?.resume('foreground');
    });
    return () => subscription.remove();
  }, []);

  const wasOfflineRef = useRef(false);
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = isOffline;
    // Only the offline→online EDGE. Firing on the initial `false` would just
    // re-enter a request already in flight from the effect above.
    if (isOffline || !wasOffline) return;
    feedRef.current?.resume('online');
  }, [isOffline]);

  return <>{children}</>;
};

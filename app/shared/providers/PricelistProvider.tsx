import React, { useEffect, createContext, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { initLog, useInitMount } from '@/shared/lib/logger';
import { createPricelistFeed, type PricelistFeed } from '@/shared/lib/pricelistFeed';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';

initLog('Module', 'PricelistProvider loaded');

interface PricelistContextType {
  btcPrice?: number;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
}

const PricelistContext = createContext<PricelistContextType | null>(null);

export const PricelistProvider = ({ children }: { children: React.ReactNode }) => {
  useInitMount('PricelistProvider');
  // Reactive slices: useShallow so the provider only re-renders when one of
  // these three actually changes (each WS price tick rewrites `pricelist`,
  // but `isLoading` and `error` stay equal — without useShallow we'd churn
  // on every frame regardless).
  const { pricelist, isLoading, error } = usePricelistStore(
    useShallow((s) => ({ pricelist: s.pricelist, isLoading: s.isLoading, error: s.error }))
  );
  // Actions and `isStale` (a pure derivation) are stable references — pull
  // them individually so they never contribute to re-renders.
  const setBtcPrices = usePricelistStore((s) => s.setBtcPrices);
  const setLoading = usePricelistStore((s) => s.setLoading);
  const setError = usePricelistStore((s) => s.setError);
  const isDataStale = usePricelistStore((s) => s.isStale);
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

  // Re-arm on the two events that mean "the reason we failed may be gone".
  // The backoff ladder is a burst limit, so without these a launch that spent
  // its five attempts offline would never reconnect for the rest of the
  // session. Foreground mirrors what the NIP-46 signer service already does
  // for its relay sockets; the offline flag is the app's single connectivity
  // owner, already debounced against Android's transport flapping, so this
  // adds no second poller.
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
    // re-enter a dial already in flight from the effect above.
    if (isOffline || !wasOffline) return;
    feedRef.current?.resume('online');
  }, [isOffline]);

  const contextValue = useMemo<PricelistContextType>(
    () => ({
      btcPrice: pricelist?.usd?.btc,
      isLoading,
      error,
      isStale: isDataStale(5), // Consider data stale after 5 minutes
    }),
    [pricelist, isLoading, error, isDataStale]
  );

  return <PricelistContext.Provider value={contextValue}>{children}</PricelistContext.Provider>;
};

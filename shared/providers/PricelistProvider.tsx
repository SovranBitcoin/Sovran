import React, { useEffect, createContext } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePricelistStore, BitcoinPrices } from '@/shared/stores/global/pricelistStore';
import { log, initLog, useInitMount } from '@/shared/lib/logger';
import { PricelistWsMessage, loggableIssues, parseWith } from '@sovranbitcoin/schemas';

initLog('Module', 'PricelistProvider loaded');

const PRICELIST_URL = 'wss://ws.sovran.money';

const parsePricelistWs = parseWith(PricelistWsMessage, 'pricelist.ws');

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

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 1000; // Start with 1 second

    const connect = () => {
      if (ws?.readyState === WebSocket.OPEN) return;

      log.info('pricelist.ws.connecting');
      setLoading(true);
      setError(null);

      try {
        ws = new WebSocket(PRICELIST_URL);

        ws.onopen = () => {
          log.info('pricelist.ws.connected');
          setLoading(false);
          setError(null);
          reconnectAttempts = 0; // Reset on successful connection
        };

        ws.onmessage = (event) => {
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch (err) {
            log.error('pricelist.ws.json_error', { error: err });
            return; // Keep socket open; ignore malformed frame.
          }
          const parsed = parsePricelistWs(raw);
          if (parsed.isErr()) {
            log.warn('pricelist.ws.parse_rejected', {
              issues: loggableIssues(parsed.error),
            });
            // Drop unknown-shape frames silently — price UI keeps its
            // last-valid value rather than surfacing an error.
            return;
          }
          setBtcPrices(parsed.value.btcPrices as BitcoinPrices);
        };

        ws.onerror = (err) => {
          log.error('pricelist.ws.error', { error: err });
          setError('Connection error');
          setLoading(false);
        };

        ws.onclose = () => {
          log.info('pricelist.ws.closed');
          setLoading(false);

          // Attempt to reconnect if we haven't exceeded max attempts
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            log.info('pricelist.ws.reconnecting', {
              attempt: reconnectAttempts,
              max: maxReconnectAttempts,
            });

            reconnectTimeout = setTimeout(
              () => {
                connect();
              },
              reconnectDelay * Math.pow(2, reconnectAttempts - 1)
            ); // Exponential backoff
          } else {
            log.error('pricelist.ws.max_reconnects');
            setError('Connection lost. Please check your internet connection.');
          }
        };
      } catch (err) {
        log.error('pricelist.ws.create_failed', { error: err });
        setError('Failed to connect to price feed');
        setLoading(false);
      }
    };

    // Start connection
    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [setBtcPrices, setLoading, setError]);

  const contextValue = {
    btcPrice: pricelist?.usd?.btc,
    isLoading,
    error,

    // Consider data stale after 5 minutes
    isStale: isDataStale(5),
  };

  return <PricelistContext.Provider value={contextValue}>{children}</PricelistContext.Provider>;
};

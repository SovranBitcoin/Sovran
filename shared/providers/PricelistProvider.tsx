import React, { useEffect, createContext } from 'react';
import { usePricelistStore, BitcoinPrices } from '@/shared/stores/global/pricelistStore';
import { PRICELIST_URL } from '@/shared/lib/apiClient';
import { log } from '@/shared/lib/logger';

interface PricelistContextType {
  btcPrice?: number;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
}

const PricelistContext = createContext<PricelistContextType | null>(null);

export const PricelistProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    pricelist,
    isLoading,
    error,
    setBtcPrice,
    setBtcPrices,
    setLoading,
    setError,
    isStale: isDataStale,
  } = usePricelistStore();

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
          try {
            const data = JSON.parse(event.data);
            log.debug('pricelist.ws.data', { data });

            // Handle multi-currency format: { btcPrices: { USD, GBP, EUR } }
            if (data?.btcPrices && typeof data.btcPrices === 'object') {
              const prices = data.btcPrices as BitcoinPrices;
              if (
                typeof prices.USD === 'number' &&
                typeof prices.GBP === 'number' &&
                typeof prices.EUR === 'number'
              ) {
                setBtcPrices(prices);
                return;
              }
            }

            // Legacy: single price format
            if (typeof data?.btcPrice === 'number') {
              setBtcPrice(data.btcPrice);
            } else if (data?.usd?.btc) {
              // Handle different data formats
              setBtcPrice(data.usd.btc);
            }
          } catch (err) {
            log.error('pricelist.ws.parse_error', { error: err });
            setError('Failed to parse price data');
          }
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
  }, [setBtcPrice, setBtcPrices, setLoading, setError]);

  const contextValue: PricelistContextType = {
    btcPrice: pricelist?.usd?.btc,
    isLoading,
    error,
    isStale: isDataStale(5), // Consider data stale after 5 minutes
  };

  return <PricelistContext.Provider value={contextValue}>{children}</PricelistContext.Provider>;
};

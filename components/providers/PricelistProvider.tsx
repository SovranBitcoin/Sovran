import React, { useEffect, createContext } from 'react';
import { usePricelist } from 'helper/redux/pricelist';
import { PRICELIST_URL } from 'helper/apiClient';

const PricelistContext = createContext<{ btcPrice?: number } | null>(null);

export const PricelistProvider = ({ children }: { children: React.ReactNode }) => {
  const { pricelist, setPricelist } = usePricelist();

  useEffect(() => {
    const ws = new WebSocket(PRICELIST_URL);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.btcPrice === 'number') {
          setPricelist(data.btcPrice);
        }
      } catch (err) {
        console.log('Pricelist WS error', err);
      }
    };

    ws.onerror = (err) => {
      console.log('Pricelist WS error', err);
    };

    return () => {
      ws.close();
    };
  }, [setPricelist]);

  return (
    <PricelistContext.Provider value={{ btcPrice: pricelist?.usd?.btc }}>
      {children}
    </PricelistContext.Provider>
  );
};

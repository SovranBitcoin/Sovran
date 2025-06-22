import React, { useEffect, createContext, useContext } from 'react';
import { usePricelist } from 'helper/redux/pricelist';

const PricelistContext = createContext<{ btcPrice?: number } | null>(null);

export const usePricelistProvider = () => {
  const context = useContext(PricelistContext);
  if (!context) {
    throw new Error('usePricelistProvider must be used within a PricelistProvider');
  }
  return context;
};

export const PricelistProvider = ({ children }: { children: React.ReactNode }) => {
  const { pricelist, setPricelist } = usePricelist();

  useEffect(() => {
    const ws = new WebSocket('wss://esim.sovran.cash/ws');

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

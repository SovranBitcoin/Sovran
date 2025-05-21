import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setPricelist } from 'helper/redux/pricelist/actions';

const PRICE_WS_URL = 'ws://localhost:8080';

interface PriceMessage {
  btcPrice: number;
}

export const PriceProvider = ({ children }: { children: React.ReactNode }) => {
  const dispatch = useDispatch();

  useEffect(() => {
    const ws = new WebSocket(PRICE_WS_URL);

    ws.onmessage = (event) => {
      try {
        const data: PriceMessage = JSON.parse(event.data);
        if (typeof data.btcPrice === 'number') {
          dispatch(setPricelist(data.btcPrice));
        }
      } catch (err) {
        console.error('Error parsing price message', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [dispatch]);

  return <>{children}</>;
};

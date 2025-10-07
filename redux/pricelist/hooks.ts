import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { setPricelist } from './actions';
import { memoizedPricelist } from './selectors';

export const usePricelist = () => {
  const dispatch = useDispatch();
  const pricelist = useSelector(memoizedPricelist);

  const setPricelistCallback = useCallback(
    (price: number) => dispatch(setPricelist(price)),
    [dispatch]
  );

  return {
    pricelist,
    setPricelist: setPricelistCallback,
  };
};

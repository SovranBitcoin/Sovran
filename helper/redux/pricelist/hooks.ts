import { useDispatch, useSelector } from 'react-redux';
import { setPricelist } from './actions';
import { memoizedPricelist } from './selectors';

export const usePricelist = () => {
  const dispatch = useDispatch();
  const pricelist = useSelector(memoizedPricelist);

  return {
    pricelist,
    setPricelist: (pricelistData) => dispatch(setPricelist(pricelistData)),
  };
};

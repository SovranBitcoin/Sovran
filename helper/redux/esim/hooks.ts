import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { setEsims, updateEsim } from './actions';
import { memoizedEsims } from './selectors';
import { Esim, EsimOrder } from './types';

export const useEsims = () => {
  const dispatch = useDispatch();
  const esims = useSelector(memoizedEsims);

  const updateEsimCallback = useCallback(
    (request: string, esim: EsimOrder) => dispatch(updateEsim(request, esim)),
    [dispatch]
  );

  const setEsimsCallback = useCallback(
    (esim: Esim) => dispatch(setEsims(esim)),
    [dispatch]
  );

  return {
    esims,
    updateEsim: updateEsimCallback,
    setEsims: setEsimsCallback,
  };
};

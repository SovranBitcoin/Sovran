import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { setSelectedMint } from './actions';
import { memoizedGetSelectedMint } from './selectors';
import { usePaginatedHistory } from 'coco-cashu-react';

export const useCashu = () => {
  const dispatch = useDispatch();
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const { history } = usePaginatedHistory();

  const setSelectedMintCallback = useCallback(
    (profileId: number, mintUrl: string) => dispatch(setSelectedMint({ profileId, mintUrl })),
    [dispatch]
  );

  return {
    selectedMint,
    setSelectedMint: setSelectedMintCallback,
    transactions: history || [],
  };
};

import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { setSelectedMint } from './actions';
import { memoizedGetMintInfo, memoizedGetAudit, memoizedGetTransactions } from './selectors';
import { RootState } from '../store/reducer';

export const useCashu = () => {
  const dispatch = useDispatch();
  const profileId = useSelector((state: RootState) => state.nostr.currentProfile?.id);
  const profiles = useSelector((state: RootState) => state.cashu.profiles);

  const selectedMint = profiles[profileId]?.selectedMint;
  const keysets = profiles[profileId]?.keysets;
  const proofs = profiles[profileId]?.proofs;
  const transactions = useSelector(memoizedGetTransactions({ id: profileId }));

  const setSelectedMintCallback = useCallback(
    (profileId: number, mintUrl: string) => dispatch(setSelectedMint({ profileId, mintUrl })),
    [dispatch]
  );

  return {
    selectedMint,
    setSelectedMint: setSelectedMintCallback,
    keysets: keysets || [],
    proofs: proofs || [],
    transactions: transactions || [],
  };
};

export const useGetMintInfo = ({ mintUrl }: { mintUrl: string }) => {
  return useSelector(memoizedGetMintInfo(mintUrl));
};

export const useGetAudit = ({ mintUrl }: { mintUrl: string }) => {
  return useSelector(memoizedGetAudit(mintUrl));
};

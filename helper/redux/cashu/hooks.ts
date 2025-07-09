import { useDispatch, useSelector } from 'react-redux';
import { setSelectedMint } from './actions';
import { memoizedGetMintInfo, memoizedGetAudit, memoizedGetTransactions } from './selectors';

export const useCashu = () => {
  const dispatch = useDispatch();
  const profileId = useSelector((state) => state.nostr.currentProfile?.id);
  const profiles = useSelector((state) => state.cashu.profiles);

  const selectedMint = profiles[profileId]?.selectedMint;
  const keysets = profiles[profileId]?.keysets;
  const proofs = profiles[profileId]?.proofs;
  const transactions = useSelector(memoizedGetTransactions({ id: profileId }));

  return {
    selectedMint,
    setSelectedMint: ({ profileId, mintUrl }) => dispatch(setSelectedMint({ profileId, mintUrl })),
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

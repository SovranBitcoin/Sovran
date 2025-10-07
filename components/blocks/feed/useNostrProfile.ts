import { useSelector } from 'react-redux';
import { memoizedGetNostrProfile } from 'redux/nostr/selectors';

export const useNostrProfile = ({ id }: { id: string }) => {
  return useSelector(memoizedGetNostrProfile({ nostrPubkey: id }));
};

import { useDispatch, useSelector } from 'react-redux';
import { setCurrentProfile, setProfiles, addMessage, setSearch } from './actions';

import { memoizedGetCurrentProfile } from './selectors';
import { RootState } from '../store/reducer';

export const useNostr = () => {
  const dispatch = useDispatch();
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const search = useSelector((state: RootState) => state.nostr.search);
  const profiles = useSelector((state: RootState) => state.nostr.profiles);
  const messages = useSelector((state: RootState) => state.nostr.messages);
  const follows = useSelector((state: RootState) => state.nostr.follows);
  const contacts = useSelector((state: RootState) => state.nostr.contacts);

  return {
    search: [...search, ...Object.values(follows).flat(), ...(contacts || [])],
    currentProfile,
    profiles: profiles || [],
    messages: [...(messages[currentProfile?.pubkey] || []), ...(messages['loaded_messages'] || [])],
    setCurrentProfile: (profile) => dispatch(setCurrentProfile(profile)),
    setProfiles: (profiles) => dispatch(setProfiles(profiles)),
    addMessage: (pubkey, message) => dispatch(addMessage(pubkey, message)),
    follows: [...(follows[currentProfile?.pubkey] || [])],
    contacts: contacts || [],
    setSearch: (search) => dispatch(setSearch(search)),
  };
};

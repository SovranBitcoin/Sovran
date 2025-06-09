import { useDispatch, useSelector } from 'react-redux';
import {
  setCurrentProfile,
  setProfiles,
  addMessage,
  updateMessageStatus,
  setFollows,
  setSearch,
  addContact,
  removeContact,
} from './actions';
import { RootState } from '../store/reducer';

export const useNostr = () => {
  const dispatch = useDispatch();
  const { id } = useSelector((state: RootState) => state.nostr.currentProfile);
  const search = useSelector((state: RootState) => state.nostr.search);
  const profiles = useSelector((state: RootState) => state.nostr.profiles);
  const messages = useSelector((state: RootState) => state.nostr.messages);
  const follows = useSelector((state: RootState) => state.nostr.follows);
  const contacts = useSelector((state: RootState) => state.nostr.contacts);

  const currentProfile = profiles?.[id];

  return {
    search: [...search, ...Object.values(follows).flat(), ...(contacts || [])],
    currentProfile,
    profiles: profiles || [],
    messages: [...(messages[currentProfile?.pubkey] || []), ...(messages['loaded_messages'] || [])],
    setCurrentProfile: (profile) => dispatch(setCurrentProfile(profile)),
    setProfiles: (profiles) => dispatch(setProfiles(profiles)),
    addMessage: (pubkey, message) => dispatch(addMessage(pubkey, message)),
    updateMessageStatus: (pubkey, messageId, status) => {
      dispatch(updateMessageStatus(pubkey, messageId, status));
    },
    setFollows: (follows) => dispatch(setFollows(follows)),
    follows: [...(follows[currentProfile.pubkey] || [])],
    contacts: contacts || [],
    addContact: (contact) => dispatch(addContact(contact)),
    removeContact: (pubkey) => dispatch(removeContact(pubkey)),
    setSearch: (search) => dispatch(setSearch(search)),
  };
};

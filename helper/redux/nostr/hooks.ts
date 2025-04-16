import { useDispatch, useSelector } from "react-redux";
import {
  setCurrentProfile,
  setProfiles,
  addMessage,
  updateMessageStatus,
  setFollows,
  setSearch,
} from "./actions";

export const useNostr = () => {
  const dispatch = useDispatch();
  const currentProfile = useSelector((state) => state.nostr.currentProfile);
  const search = useSelector((state) => state.nostr.search);
  const profiles = useSelector((state) => state.nostr.profiles);
  const messages = useSelector((state) => state.nostr.messages);
  const follows = useSelector((state) => state.nostr.follows);

  return {
    search: [...search, ...Object.values(follows).flat()],
    currentProfile,
    profiles: profiles || [],
    messages: [
      ...(messages[currentProfile.pubkey] || []),
      ...(messages["loaded_messages"] || []),
    ],
    setCurrentProfile: (profile) => dispatch(setCurrentProfile(profile)),
    setProfiles: (profiles) => dispatch(setProfiles(profiles)),
    addMessage: (pubkey, message) => dispatch(addMessage(pubkey, message)),
    updateMessageStatus: (pubkey, messageId, status) => {
      dispatch(updateMessageStatus(pubkey, messageId, status));
    },
    setFollows: (follows) => dispatch(setFollows(follows)),
    follows: [...(follows[currentProfile.pubkey] || [])],
    setSearch: (search) => dispatch(setSearch(search)),
  };
};

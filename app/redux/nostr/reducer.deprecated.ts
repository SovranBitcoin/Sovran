import { Reducer } from 'react';
import { nostrState } from '@/redux/store/migrationTest.deprecated';

type NostrProfile = {
  created_at: number;
  profileEvent: string;
  name: string;
  picture: string;
  image: string;
};

type Message = {
  sender: string;
  receiver: string;
  pubkey: string;
  content: string;
  created_at: number;
  id: string;
  sig: string;
};

type Profile = {
  id: number;
  pubkey: string;
  profile: NostrProfile;
  npub: string;
  nsec: string;
  mints: any[];
  mnemonic: string;
  picture: string;
  root: {
    xpub: string;
    xpriv: string;
  };
  nut13: string;
};

type NostrState = {
  currentProfile: { id: number };
  search?: any[];
  profiles: Profile[];
  messages: {
    loaded_messages: any[];
    [key: string]: Message[];
  };
  follows: Record<string, any>;
  contacts?: any[];
};

const p = nostrState.profiles[0];
const initialState: NostrState = {
  currentProfile: {
    id: nostrState.currentProfile.id,
  },
  ...(nostrState.search ? { search: nostrState.search as any[] } : {}),
  profiles: [
    {
      id: p.id,
      mnemonic: p.mnemonic || '',
      pubkey: p.pubkey || '',
      profile: p.profile || {
        created_at: 0,
        profileEvent: '',
        name: '',
        picture: '',
        image: '',
      },
      npub: p.npub || '',
      nsec: p.nsec || '',
      mints: p.mints || [],
      picture: p.picture || '',
      root: p.root || { xpub: '', xpriv: '' },
      nut13: p.nut13 || '',
    },
  ],
  messages: nostrState.messages || { loaded_messages: [] },
  follows: nostrState.follows || {},
  ...(nostrState.contacts ? { contacts: nostrState.contacts as any[] } : {}),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nostrReducer: Reducer<NostrState, any> = (
  state = initialState,
  _action
): NostrState => {
  return state;
};

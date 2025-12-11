import { Reducer } from 'react';
import { nostrState } from 'redux/store/migrationTest';

type NostrProfile = {
  created_at: number;
  profileEvent: string;
  name: string;
  picture: string;
  image: string;
};

export type Message = {
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
  profiles: Profile[];
  messages: {
    loaded_messages: any[];
    [key: string]: Message[];
  };
  follows: Record<string, any>;
};

const initialState: NostrState = {
  currentProfile: {
    id: nostrState.currentProfile.id,
  },
  profiles: [
    {
      id: nostrState.profiles[0].id,
      mnemonic: nostrState.profiles[0].mnemonic || '',
      pubkey: '',
      profile: {
        created_at: 0,
        profileEvent: '',
        name: '',
        picture: '',
        image: '',
      },
      npub: '',
      nsec: '',
      mints: [],
      picture: '',
      root: {
        xpub: '',
        xpriv: '',
      },
      nut13: '',
    },
  ],
  messages: {
    loaded_messages: [],
  },
  follows: {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nostrReducer: Reducer<NostrState, any> = (
  state = initialState,
  _action
): NostrState => {
  return state;
};

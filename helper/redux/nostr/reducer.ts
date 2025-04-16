import _ from "lodash";
import {
  SET_CURRENT_PROFILE,
  SET_SEARCH,
  SET_PROFILES,
  SET_FOLLOWS,
  UPDATE_MESSAGE_STATUS,
  ADD_MESSAGE,
  APPEND_QUERY,
} from "./actionTypes";

const initialState = {
  currentProfile: {
    id: 0,
  },
  search: [
    {
      pubkey:
        "1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2",
      profile: {
        created_at: 1724764804,
        profileEvent:
          '{"created_at":1738834915,"content":"{\\"displayName\\":\\"Sovran Bitcoin\\",\\"display_name\\":\\"Sovran Bitcoin\\",\\"name\\":\\"Sovran\\",\\"website\\":\\"https://sovranbitcoin.com\\",\\"about\\":\\"Working on a Bitcoin wallet that I like to use.\\",\\"lud16\\":\\"maskedroom40@walletofsatoshi.com\\",\\"picture\\":\\"https://m.primal.net/IEAX.png\\",\\"pubkey\\":\\"1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2\\",\\"npub\\":\\"npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3\\",\\"created_at\\":1724764804,\\"banner\\":\\"https://m.primal.net/Kgxi.png\\"}","tags":[["i","twitter:sovranbitcoin","1887211361979003324"],["r","https://testflight.apple.com/join/u1zv3z7S",""]],"kind":0,"pubkey":"1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2","id":"97b889880504d1b0b70277076e51156b3c8d88d27acfa86882667be654aa228d","sig":"5f809e1604d84c58341664d362eb15f3d32e7faf73c9b675228a1ad4250bb80fd4ff3db7e314a7748412686abe2a7ba0e1fc0384ee72217ad82b0fcea20c4db8"}',
        displayName: "Sovran Bitcoin",
        name: "Sovran",
        website: "https://sovranbitcoin.com",
        about: "Working on a Bitcoin wallet that I like to use.",
        lud16: "maskedroom40@walletofsatoshi.com",
        image: "https://m.primal.net/IEAX.png",
        pubkey:
          "1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2",
        npub: "npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3",
        banner: "https://m.primal.net/Kgxi.png",
      },
    },
  ],
  profiles: [],
  messages: {
    loaded_messages: [],
  },
  follows: {},
};

export const nostrReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_CURRENT_PROFILE: {
      return { ...state, currentProfile: action.payload };
    }

    case APPEND_QUERY: {
      return {
        ...state,
        queries: [
          ...(state?.queries || []),
          action.payload
        ]
      }
    }

    case SET_SEARCH: {
      const uniqueSearch = [];
      const pubkeyMap = new Map();
      for (const item of action.payload) {
        pubkeyMap.set(item.pubkey, item);
      }
      for (const item of state.search) {
        if (!pubkeyMap.has(item.pubkey)) {
          pubkeyMap.set(item.pubkey, item);
        }
      }
      uniqueSearch.push(...pubkeyMap.values());
      return { ...state, search: uniqueSearch };
    }

    case SET_PROFILES: {
      return { ...state, profiles: action.payload };
    }

    case SET_FOLLOWS: {
      const pubkey = state.currentProfile.pubkey;
      return { ...state, follows: { [pubkey]: action.payload } };
    }

    case UPDATE_MESSAGE_STATUS: {
      const { pubkey, status } = action.payload;
      const updatedMessages = state.messages[pubkey]?.map((message) => ({
        ...message,
        status,
      }));
      return {
        ...state,
        messages: {
          ...state.messages,
          [pubkey]: [...updatedMessages],
        },
      };
    }

    case ADD_MESSAGE: {
      const { pubkey: newPubkey, message } = action.payload;
      return {
        ...state,
        messages: {
          ...state.messages,
          [newPubkey]: [...(state.messages?.[newPubkey] ?? []), message],
        },
      };
    }

    default: {
      return state;
    }
  }
};

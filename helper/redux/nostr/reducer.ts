import _ from 'lodash';
import {
  SET_CURRENT_PROFILE,
  SET_SEARCH,
  SET_PROFILES,
  SET_FOLLOWS,
  UPDATE_MESSAGE_STATUS,
  ADD_MESSAGE,
  APPEND_QUERY,
  MUTE_USER,
  REPORT_USER,
} from './actionTypes';

const initialState = {
  currentProfile: {
    id: 0,
  },
  search: [
    {
      pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
      profile: {
        created_at: 1724764804,
        profileEvent:
          '{"created_at":1738834915,"content":"{\\"displayName\\":\\"Sovran Bitcoin\\",\\"display_name\\":\\"Sovran Bitcoin\\",\\"name\\":\\"Sovran\\",\\"website\\":\\"https://sovranbitcoin.com\\",\\"about\\":\\"Working on a Bitcoin wallet that I like to use.\\",\\"lud16\\":\\"maskedroom40@walletofsatoshi.com\\",\\"picture\\":\\"https://m.primal.net/IEAX.png\\",\\"pubkey\\":\\"1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2\\",\\"npub\\":\\"npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3\\",\\"created_at\\":1724764804,\\"banner\\":\\"https://m.primal.net/Kgxi.png\\"}","tags":[["i","twitter:sovranbitcoin","1887211361979003324"],["r","https://testflight.apple.com/join/u1zv3z7S",""]],"kind":0,"pubkey":"1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2","id":"97b889880504d1b0b70277076e51156b3c8d88d27acfa86882667be654aa228d","sig":"5f809e1604d84c58341664d362eb15f3d32e7faf73c9b675228a1ad4250bb80fd4ff3db7e314a7748412686abe2a7ba0e1fc0384ee72217ad82b0fcea20c4db8"}',
        displayName: 'Sovran Bitcoin',
        name: 'Sovran',
        website: 'https://sovranbitcoin.com',
        about: 'Working on a Bitcoin wallet that I like to use.',
        lud16: 'maskedroom40@walletofsatoshi.com',
        image: 'https://m.primal.net/IEAX.png',
        pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
        npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
        banner: 'https://m.primal.net/Kgxi.png',
      },
    },
    {
      pubkey: '06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9',
      profile: {
        profileEvent:
          '{"created_at":1738232109,"content":"{\\"picture\\":\\"https://m.primal.net/KhMz.jpg\\",\\"nip05\\":\\"lnvpn@nostrplebs.com\\",\\"display_name\\":\\"LN⚡️VPN - eSIM & VPN without KYC\\",\\"banner\\":\\"https://m.primal.net/KhNB.jpg\\",\\"website\\":\\"https://lnvpn.net\\",\\"lud06\\":\\"\\",\\"about\\":\\"⚡️Privacy by Design ⚡️VPN and eSIM via Lightning ⚡️ No Account ⚡️ No Email ⚡️ No KYC ⚡️ No Registration ⚡️ No Data Stored ⚡️ No Credit Card ⚡️using @WireguardVPN\\\\n\\\\nEarn Sats and become a partner 💸\\",\\"name\\":\\"lnvpn\\",\\"lud16\\":\\"firstparrot5@primal.net\\",\\"displayName\\":\\"LN⚡️VPN - eSIM & VPN without KYC\\",\\"pubkey\\":\\"06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9\\",\\"npub\\":\\"npub1qmw7jhczdr8yqy5t7u72d6z4v7u9va5gaff0ynwd2u6wwlzs7tvs694er8\\",\\"created_at\\":1726403562}","tags":[],"kind":0,"pubkey":"06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9","id":"5ed379257aecad1f9cb3f3dd0de87dabe1d586a7d7a8de944ea5ada7ba434051","sig":"44d240629df6448538194c69511ab7e7483f5979fca72269de8f08021b9621989e4eb19d48ea46a886829b4daaad2ebc4c1b22a9e3d1f08fc4c7a845f57d9739"}',
        picture: 'https://m.primal.net/KhMz.jpg',
        image: 'https://m.primal.net/KhMz.jpg',
        nip05: 'lnvpn@nostrplebs.com',
        displayName: 'LN⚡️VPN - eSIM & VPN without KYC',
        banner: 'https://m.primal.net/KhNB.jpg',
        website: 'https://lnvpn.net',
        lud06: '',
        about:
          '⚡️Privacy by Design ⚡️VPN and eSIM via Lightning ⚡️ No Account ⚡️ No Email ⚡️ No KYC ⚡️ No Registration ⚡️ No Data Stored ⚡️ No Credit Card ⚡️using @WireguardVPN\n\nEarn Sats and become a partner 💸',
        name: 'lnvpn',
        lud16: 'firstparrot5@primal.net',
        pubkey: '06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9',
        npub: 'npub1qmw7jhczdr8yqy5t7u72d6z4v7u9va5gaff0ynwd2u6wwlzs7tvs694er8',
        created_at: 1738232109,
        nip05Valid: true,
        hasNip05Conflict: false,
      },
    },
    {
      pubkey: '598a2b033911fb717c0745c47dba7c6d80961d42c67698b1b72a20b8fee67fb4',
      profile: {
        profileEvent:
          '{"created_at":1688474619,"content":"{\\"website\\":\\"\\",\\"nip05\\":\\"oi@bitrefill.me\\",\\"picture\\":\\"https://nostr.build/i/5948ad589fed2242428edb876198a7c15241667695402b72d8aef2a0e3166a4c.jpg\\",\\"lud16\\":\\"028c2519859b21ce569e86493acd80b1f6e5bf40780cd294c1fc554809ea0ba9fa@vpzh6vlbq5zsdlvgzmgwwji5fphczr5ivhg5q7ny2p6htj4we2klosyd.onion:9735\\",\\"display_name\\":\\"Oi\\",\\"about\\":\\"\\",\\"name\\":\\"Oi\\"}","tags":[],"kind":0,"pubkey":"598a2b033911fb717c0745c47dba7c6d80961d42c67698b1b72a20b8fee67fb4","id":"53c785136a914872e5d1a1f3a303cfb6bed776b0c34365b771544e7bdf3a739d","sig":"8a995e916e4c255a7a858519e9d761f80082da267eadbca7ae8697494ab9fbb4f823150d48c44cb7225e7f7442d6f806fdf028e2b873688f3b80e60ad265ca73"}',
        website: '',
        nip05: 'oi@bitrefill.me',
        picture:
          'https://nostr.build/i/5948ad589fed2242428edb876198a7c15241667695402b72d8aef2a0e3166a4c.jpg',
        image:
          'https://nostr.build/i/5948ad589fed2242428edb876198a7c15241667695402b72d8aef2a0e3166a4c.jpg',
        lud16:
          '028c2519859b21ce569e86493acd80b1f6e5bf40780cd294c1fc554809ea0ba9fa@vpzh6vlbq5zsdlvgzmgwwji5fphczr5ivhg5q7ny2p6htj4we2klosyd.onion:9735',
        displayName: 'Oi',
        about: '',
        name: 'Oi',
        created_at: 1688474619,
        pubkey: '598a2b033911fb717c0745c47dba7c6d80961d42c67698b1b72a20b8fee67fb4',
        npub: 'npub1tx9zkqeez8ahzlq8ghz8mwnudkqfv82zcemf3vdh9gst3lhx076q9jsg7w',
        nip05Valid: false,
        hasNip05Conflict: false,
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
        queries: [...(state?.queries || []), action.payload],
      };
    }

    case SET_SEARCH: {
      const uniqueSearch = [];
      const pubkeyMap = new Map();
      for (const item of action.payload) {
        if (!item.pubkey) continue;
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

    case MUTE_USER: {
      return {
        ...state,
        search: state.search.map((s) => {
          if (s.pubkey === action.payload) {
            return { ...s, profile: { ...s.profile, muted: true } };
          }
          return s;
        }),
      };
    }

    case REPORT_USER: {
      return {
        ...state,
        search: state.search.map((s) => {
          if (s.pubkey === action.payload) {
            return { ...s, profile: { ...s.profile, report: true } };
          }
          return s;
        }),
      };
    }

    default: {
      return state;
    }
  }
};

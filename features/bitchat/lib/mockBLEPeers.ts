import type { BLEPeer } from 'bitchat-module';
import { nip19 } from 'nostr-tools';

export const MOCK_BLE_PEER_MIN_COUNT = 1;
export const MOCK_BLE_PEER_LOOP_INTERVAL_MS = 600;

export interface MockBLEPeerLoopState {
  count: number;
  direction: 1 | -1;
}

interface MockBLEPeerProfileSeed {
  name: string;
  npub?: string;
  pubkey?: string;
  picture?: string;
}

export interface MockBLEPeerProfile {
  peerID: string;
  nickname: string;
  npub: string;
  picture?: string;
}

const MOCK_BLE_PEER_PROFILE_SEEDS: readonly MockBLEPeerProfileSeed[] = [
  {
    name: 'Calle',
    npub: 'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg',
    picture: 'https://avatars.githubusercontent.com/u/93376500',
  },
  {
    name: 'thesimplekid',
    npub: 'npub1qjgcmlpkeyl8mdkvp4s0xls4ytcux6my606tgfx9xttut907h0zs76lgjw',
    picture: 'https://avatars.githubusercontent.com/u/8606367?v=4',
  },
  {
    name: 'a1denvalu3',
    npub: 'npub1u07xw079lxwv24xslarh2eu4v37jtjmwvev0jyk3zjhxg2wnt56seyez97',
    picture: 'https://m.primal.net/JfYR.jpg',
  },
  {
    name: 'Rob Woodgate',
    npub: 'npub1emq0gngdvntdn4apepxrxr65vln49nytqe0hyr58fg9768z5zmfqcwa3jz',
    picture: 'https://m.primal.net/NgRE.jpg',
  },
  {
    name: 'gandlaf21',
    npub: 'npub1cj6ndx5akfazux7f0vjl4fyx9k0ulf682p437fe03a9ndwqjm0tqj886t6',
    picture: 'https://gandlaf.com/gandlaf.webp',
  },
  {
    name: 'Egge',
    npub: 'npub1mhcr4j594hsrnen594d7700n2t03n8gdx83zhxzculk6sh9nhwlq7uc226',
    picture:
      'https://image.nostr.build/3097c9da617f9da288249ce5b7ef7bfc4f7bab16e05653962c49567c3dddf53e.jpg',
  },
  {
    name: 'erik',
    npub: 'npub1zqsu3ys4fragn2a5e3lgv69r4rwwhts2fserll402uzr3qeddxfsffcqrs',
    picture: 'https://pbs.twimg.com/profile_images/1539149597800599552/-o_8UidC_400x400.jpg',
  },
  {
    name: 'Agron',
    npub: 'npub1pp355axf69z8ndrz8zdnqa54s90e5xy737mwqk9e9cvt606nwszsdx8nu7',
    picture: 'https://github.com/KKA11010.png',
  },
  {
    name: 'gladstein',
    npub: 'npub1trr5r2nrpsk6xkjk5a7p6pfcryyt6yzsflwjmz6r7uj7lfkjxxtq78hdpu',
    picture:
      'https://r2.primal.net/cache/e/24/41/e2441c12e15d1450824f097afc77375d8e5318360e8aa650e97e4ff62eeeb114.jpg',
  },
  {
    name: 'Jack Dorsey',
    npub: 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m',
    picture:
      'https://image.nostr.build/26867ce34e4b11f0a1d083114919a9f4eca699f3b007454c396ef48c43628315.jpg',
  },
  {
    name: 'ODELL',
    npub: 'npub1qny3tkh0acurzla8x3zy4nhrjz5zd8l9sy9jys09umwng00manysew95gx',
    picture: 'https://m.primal.net/NcKe.jpg',
  },
  {
    name: 'Lyn Alden',
    npub: 'npub1a2cww4kn9wqte4ry70vyfwqyqvpswksna27rtxd8vty6c74era8sdcw83a',
    picture: 'https://m.primal.net/LtjB.jpg',
  },
  {
    name: 'Gigi',
    npub: 'npub1dergggklka99wwrs92yz8wdjs952h2ux2ha2ed598ngwu9w7a6fsh9xzpc',
    picture: 'https://dergigi.com/assets/images/avatars/09.png',
  },
  {
    name: 'Martti Malmi',
    npub: 'npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk',
    picture:
      'https://cdn.nostr.build/i/8274ce86cc4477b80c8cad5ff4dfebe55f1223b3e35dfc10a1e19a67f29a8f8f.jpg',
  },
  {
    name: 'Jeff Booth',
    npub: 'npub1s05p3ha7en49dv8429tkk07nnfa9pcwczkf5x5qrdraqshxdje9sq6eyhe',
    picture: 'https://pbs.twimg.com/profile_images/1362957991410954241/spiaMAg2_400x400.jpg',
  },
  {
    name: 'Preston Pysh',
    npub: 'npub1s5yq6wadwrxde4lhfs56gn64hwzuhnfa6r9mj476r5s4hkunzgzqrs6q7z',
    picture: 'https://i.imgur.com/Xf8iV9G.gif',
  },
  {
    name: 'NVK',
    npub: 'npub1az9xj85cmxv8e9j9y80lvqp97crsqdu2fpu3srwthd99qfu9qsgstam8y8',
    picture: 'https://m.primal.net/LwhG.jpg',
  },
  {
    name: 'fiatjaf',
    npub: 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6',
    picture: 'https://fiatjaf.com/static/favicon.jpg',
  },
  {
    name: 'Edward Snowden',
    npub: 'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9',
    picture: 'https://nostr.build/i/p/6838p.jpeg',
  },
  {
    name: 'Adam Back',
    pubkey: '020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e',
    picture:
      'https://primaldata.s3.us-east-005.backblazeb2.com/cache/c/38/92/c38922a228813e5e8d972374d1d830e76c7df3f3b131e675071666037a6aeabd.jpg',
  },
  {
    name: 'Sovran',
    npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
    picture:
      'https://blossom.primal.net/6bf922b8fa44d126270a1f5db09c1182bc8bafe62ed98790bd5ba4b08b728533.png',
  },
  {
    name: 'KELBIE | sovran.money',
    npub: 'npub1ceel7z6ly287kz4mzqqcsgtc6nzc30zw2ru9w9e4gj64gw69f7qscyf0p8',
    picture: 'https://m.primal.net/HoYp.jpg',
  },
  {
    name: 'Minibits',
    npub: 'npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv',
    picture: 'https://minibits.cash/icon-192.png',
  },
  {
    name: 'HODL',
    npub: 'npub1rtlqca8r6auyaw5n5h3l5422dm4sry5dzfee4696fqe8s6qgudks7djtfs',
    picture:
      'https://r2.primal.net/cache/0/c6/24/0c62490569b550c58450c392e2a972413d11320fa5696a7f79a16efa1d8ce83c.gif',
  },
  {
    name: 'Jimmy Song',
    pubkey: '7b3f7803750746f455413a221f80965eecb69ef308f2ead1da89cc2c8912e968',
  },
];

function resolveProfilePubkey(seed: MockBLEPeerProfileSeed): string {
  if (seed.pubkey) return seed.pubkey;
  if (!seed.npub) throw new Error(`Mock BLE profile ${seed.name} is missing a public key`);
  const decoded = nip19.decode(seed.npub);
  if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
    throw new Error(`Mock BLE profile ${seed.name} has an invalid npub`);
  }
  return decoded.data;
}

export const MOCK_BLE_PEER_PROFILES: readonly MockBLEPeerProfile[] =
  MOCK_BLE_PEER_PROFILE_SEEDS.map((seed) => {
    const peerID = resolveProfilePubkey(seed);
    return {
      peerID,
      nickname: seed.name,
      npub: seed.npub ?? nip19.npubEncode(peerID),
      ...(seed.picture ? { picture: seed.picture } : {}),
    };
  });

export const MOCK_BLE_PEER_MAX_COUNT = MOCK_BLE_PEER_PROFILES.length;

const MOCK_BLE_PEER_PROFILE_BY_ID = new Map(
  MOCK_BLE_PEER_PROFILES.map((profile) => [profile.peerID, profile])
);

export function getMockBLEPeerProfile(peerID: string): MockBLEPeerProfile | undefined {
  return MOCK_BLE_PEER_PROFILE_BY_ID.get(peerID);
}

export const INITIAL_MOCK_BLE_PEER_LOOP_STATE: MockBLEPeerLoopState = {
  count: MOCK_BLE_PEER_MIN_COUNT,
  direction: 1,
};

export function getNextMockBLEPeerLoopState(state: MockBLEPeerLoopState): MockBLEPeerLoopState {
  if (state.direction === 1 && state.count >= MOCK_BLE_PEER_MAX_COUNT) {
    return { count: MOCK_BLE_PEER_MAX_COUNT - 1, direction: -1 };
  }
  if (state.direction === -1 && state.count <= MOCK_BLE_PEER_MIN_COUNT) {
    return { count: MOCK_BLE_PEER_MIN_COUNT + 1, direction: 1 };
  }
  return {
    count: state.count + state.direction,
    direction: state.direction,
  };
}

export function buildMockBLEPeers(count: number, now = Date.now()): BLEPeer[] {
  const peerCount = Math.max(
    MOCK_BLE_PEER_MIN_COUNT,
    Math.min(MOCK_BLE_PEER_MAX_COUNT, Math.round(count))
  );

  return Array.from({ length: peerCount }, (_, index) => ({
    peerID: MOCK_BLE_PEER_PROFILES[index].peerID,
    nickname: MOCK_BLE_PEER_PROFILES[index].nickname,
    isConnected: true,
    hasDirectLink: true,
    lastSeen: now - index * 1_000,
  }));
}

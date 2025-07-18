import { applyMiddleware, createStore } from 'redux';
import { createMigrate, persistStore, persistReducer } from 'redux-persist';
import rootReducer, { RootState, AppThunk, RESET_APP } from './reducer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import _ from 'lodash/fp';

const thunkMiddleware = require('redux-thunk').thunk;

// WARNING: never use _.set, it will obviously delete the users storage...
const migrations = {
  120: (state: RootState) => {
    const newState = _.update(
      ['cashu', 'profiles'],
      (profiles = []) => {
        return profiles.map((profile: any) => {
          if (!profile.proofs) {
            return profile;
          }

          // remove dups from each array inside proofs
          const dedupedProofs = Object.fromEntries(
            Object.entries(profile.proofs).map(([mintUrl, proofs]: any) => [
              mintUrl,
              proofs.filter(
                (item: any, index: any, self: any) =>
                  index === self.findIndex((t: any) => JSON.stringify(t) === JSON.stringify(item))
              ),
            ])
          );

          return {
            ...profile,
            proofs: dedupedProofs,
          };
        });
      },
      state
    );
    return newState;
  },
};

const persistConfig = {
  key: 'SOVRAN',
  storage: AsyncStorage,
  timeout: null,
  version: 120,
  migrate: createMigrate(migrations, { debug: true }),
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = createStore(persistedReducer, applyMiddleware(thunkMiddleware));

// The point of this object is to extract the structure of the state object
// This is so we don't send the state object with all its private data
// The reason I'm doing this is so I can help ensure the users state is not corrupted or invalid
// It's not a fullproof solution, but it will allow me to purge parts of the state if unused
// or restructure the state object if needed without being concerned about bugs.
// If any private data is leaked from this that would be considered a bug.
const organizedKeys = {
  // Root level sections
  rootSections: [
    'settings',
    'cashu',
    'bitrefill',
    'pricelist',
    'vpns',
    'esim',
    'nostr',
    '_persist',
  ],

  // Settings section
  settings: [
    'lang',
    'theme',
    'display_btc',
    'passcode',
    'termsAccepted',
    'experimental',
    'backgroundImage',
    'backgroundImageAttrs',
  ],

  // Settings sub-objects
  termsAccepted: ['termsAccepted', 'date'],

  backgroundImageAttrs: ['id', 'shades', 'greys', 'text', 'tint', 'dominantColors'],

  // Color shade values (powers of 100)
  colorShades: ['100', '200', '300', '400', '500'],

  // Grey shade values
  greyShades: ['0', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'],

  // Cashu section
  cashu: ['profiles', 'info', 'keysets', 'keys', 'audits'],

  // Cashu profile fields
  cashuProfile: ['selectedMint', 'mints', 'proofs', 'counters', 'keysets', 'transactions'],

  // Cashu proof fields
  cashuProof: ['amount', 'C', 'id', 'secret', 'dleqValid', 'dleq'],

  // DLEQ fields
  dleq: ['s', 'e', 'r'],

  // Cashu transaction fields
  cashuTransaction: [
    'request',
    'amount',
    'mintQuote',
    'date',
    'type',
    'paid',
    'transactionType',
    'unit',
    'mintUrl',
    'paymentRequest',
    'unifiedRequest',
    'status',
    'completedAt',
    'mintQuotes',
    'proofStates',
    'token',
    'nostr',
    'counter',
    'isCancel',
    'refund',
    'meltQuote',
    'fees',
    'proofs',
    'lud16',
    'p2pk',
    'fromNIP05',
    'memo',
    'meltQuotes',
  ],

  // Mint quote fields
  mintQuote: ['quote', 'request', 'amount', 'unit', 'state', 'expiry', 'pubkey', 'paid', 'addedAt'],

  // Cashu mint info fields
  cashuMintInfo: [
    'name',
    'pubkey',
    'version',
    'description',
    'description_long',
    'contact',
    'motd',
    'icon_url',
    'time',
    'nuts',
  ],

  // NUT (Notation, Usage, and Terminology) specification numbers
  nutNumbers: ['4', '5', '7', '8', '9', '10', '11', '12', '14', '15', '17', '20'],

  // NUT method fields
  nutMethod: ['method', 'unit', 'description', 'commands'],

  // Cashu keyset fields
  cashuKeyset: ['id', 'unit', 'active', 'input_fee_ppk'],

  // Cryptographic key amounts (powers of 2)
  cryptoKeyAmounts: [
    '1',
    '2',
    '4',
    '8',
    '16',
    '32',
    '64',
    '128',
    '256',
    '512',
    '1024',
    '2048',
    '4096',
    '8192',
    '16384',
    '32768',
    '65536',
    '131072',
    '262144',
    '524288',
    '1048576',
    '2097152',
    '4194304',
    '8388608',
    '16777216',
    '33554432',
    '67108864',
    '134217728',
    '268435456',
    '536870912',
    '1073741824',
    '2147483648',
    '4294967296',
    '8589934592',
    '17179869184',
    '34359738368',
    '68719476736',
    '137438953472',
    '274877906944',
    '549755813888',
    '1099511627776',
    '2199023255552',
    '4398046511104',
    '8796093022208',
    '17592186044416',
    '35184372088832',
    '70368744177664',
    '140737488355328',
    '281474976710656',
    '562949953421312',
    '1125899906842624',
    '2251799813685248',
    '4503599627370496',
    '9007199254740992',
    '18014398509481984',
    '36028797018963968',
    '72057594037927936',
    '144115188075855872',
    '288230376151711744',
    '576460752303423488',
    '1152921504606846976',
    '2305843009213693952',
    '4611686018427387904',
    '9223372036854775808',
  ],

  // Cashu audit fields
  cashuAudit: [
    'id',
    'url',
    'info',
    'name',
    'balance',
    'sum_donations',
    'updated_at',
    'next_update',
    'state',
    'n_errors',
    'n_mints',
    'n_melts',
    'swaps',
    'fromCache',
    'lastFetched',
  ],

  // Cashu swap fields
  cashuSwap: [
    'id',
    'from_id',
    'to_id',
    'from_url',
    'to_url',
    'amount',
    'fee',
    'created_at',
    'time_taken',
    'state',
    'error',
  ],

  // Bitrefill section
  bitrefill: ['events'],

  // Bitrefill event fields
  bitrefillEvent: ['type', 'source', 'data', 'date'],

  // Bitrefill data fields
  bitrefillData: ['categories', 'currentCategory'],

  // Price list section
  pricelist: ['usd', 'btc'],

  // VPN section
  vpns: ['vpns'],

  // VPN fields
  vpn: [
    'location',
    'duration',
    'duration_code',
    'cc',
    'created_at',
    'payment_hash',
    'payment_request',
    'order',
  ],

  // eSIM section
  esim: ['esims'],

  // eSIM fields
  esimFields: ['package', 'sats', 'request', 'type', 'order'],

  // eSIM package fields
  esimPackage: [
    'packageCode',
    'slug',
    'name',
    'price',
    'currencyCode',
    'volume',
    'smsStatus',
    'dataType',
    'unusedValidTime',
    'duration',
    'durationUnit',
    'location',
    'description',
    'activeType',
    'retailPrice',
    'speed',
  ],

  // eSIM order fields
  esimOrder: [
    'request',
    'esimTranNo',
    'orderNo',
    'imsi',
    'iccid',
    'smsStatus',
    'msisdn',
    'ac',
    'qrCodeUrl',
    'shortUrl',
    'smdpStatus',
    'eid',
    'activeType',
    'dataType',
    'activateTime',
    'expiredTime',
    'installationTime',
    'totalVolume',
    'totalDuration',
    'durationUnit',
    'orderUsage',
    'esimStatus',
    'pin',
    'puk',
    'apn',
    'ipExport',
    'supportTopUpType',
    'fupPolicy',
    'packageList',
  ],

  // eSIM package list fields
  esimPackageList: [
    'packageName',
    'packageCode',
    'slug',
    'duration',
    'volume',
    'locationCode',
    'createTime',
  ],

  // Nostr section
  nostr: ['currentProfile', 'search', 'profiles', 'messages', 'follows', 'contacts'],

  // Nostr profile fields
  nostrProfile: [
    'id',
    'pubkey',
    'profile',
    'npub',
    'nsec',
    'mints',
    'mnemonic',
    'picture',
    'root',
    'nut13',
  ],

  // Nostr profile metadata
  nostrProfileMetadata: [
    'created_at',
    'profileEvent',
    'name',
    'picture',
    'image',
    'lud16',
    'banner',
    'nip05',
    'website',
    'lud06',
    'displayName',
    'display_name',
    'about',
    'nip05Valid',
    'hasNip05Conflict',
  ],

  // Nostr root keys
  nostrRoot: ['xpub', 'xpriv'],

  // Nostr messages
  nostrMessages: ['loaded_messages'],

  // Nostr message fields
  nostrMessage: ['sender', 'receiver', 'pubkey', 'content', 'created_at', 'id', 'sig'],

  // Persistence section
  persist: ['version', 'rehydrated'],

  // Special identifiers and hashes
  specialIdentifiers: [
    'https://mint.example.com', // example mint URL
  ],

  // Common field patterns
  commonFields: [
    'id',
    'name',
    'type',
    'amount',
    'request',
    'pubkey',
    'created_at',
    'url',
    'state',
    'date',
    'unit',
    'description',
    'picture',
    'version',
  ],
};

// Function to get a flat array of all keys
function getAllKeysFlat() {
  const allKeys = new Set();

  for (const keys of Object.values(organizedKeys)) {
    keys.forEach((key) => allKeys.add(key));
  }

  return Array.from(allKeys).sort();
}

export const getStructure = (obj: any): any => {
  if (typeof obj !== 'object' || obj === null) {
    return typeof obj;
  }
  if (Array.isArray(obj)) {
    const allKeys = obj.reduce((keys, item) => {
      if (typeof item === 'object' && item !== null) {
        Object.keys(item).forEach((key) => keys.add(key));
      }
      return keys;
    }, new Set<string>());

    const exampleItem = obj.find((item) => typeof item === 'object' && item !== null);

    const structure: any = {};
    allKeys.forEach((key: any) => {
      structure[key] =
        exampleItem && key in exampleItem ? getStructure(exampleItem[key]) : 'undefined';
    });

    return [structure];
  }
  const structure: any = {};
  for (const key in obj) {
    if (key.includes('https://') || key.includes('http://')) {
      structure['https://mint.example.com'] = getStructure(obj[key]);
    } else if (getAllKeysFlat().includes(key)) {
      structure[key] = getStructure(obj[key]);
    } else {
      structure['unknown'] = getStructure(obj[key]);
    }
  }
  return structure;
};

store.subscribe(() => {
  console.log(JSON.stringify(getStructure(store.getState()), null, 2));
});

export const persistor = persistStore(store);

// Typed reset app action creator moved here to avoid a require cycle
export const resetApp = (): AppThunk => {
  return async (dispatch): Promise<void> => {
    try {
      // Clear persisted redux data
      await persistor.purge();

      // Dispatch the reset action to clear the in-memory state
      dispatch({ type: RESET_APP });

      // Restart persistence after reset
      persistor.persist();

      return Promise.resolve();
    } catch (error) {
      console.error('Failed to reset app:', error);
      return Promise.reject(error);
    }
  };
};

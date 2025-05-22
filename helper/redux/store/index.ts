import { applyMiddleware, createStore } from 'redux';
import { createMigrate, persistStore, persistReducer, MigrationManifest } from 'redux-persist';
import rootReducer, { RootState } from './reducer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import _ from 'lodash/fp';

import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const thunkMiddleware = require('redux-thunk').thunk;

// WARNING: never use _.set, it will obviously delete the users storage...
const migrations = {
  0: (state: RootState) => {
    return _.update(
      ['cashu', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          // Get mint URLs from proofs object keys
          const proofsKeys = Object.keys(profile.proofs || {});

          // Get selectedMint if it exists
          const selectedMint = profile.selectedMint;

          // Combine all mints and remove duplicates
          const allMints = selectedMint
            ? [...new Set([selectedMint, ...proofsKeys])]
            : [...new Set(proofsKeys)];

          return {
            ...profile,
            mints: profile.mints || allMints,
          };
        }),
      state
    );
  },
  5: (state: RootState) => {
    return _.update(
      ['cashu', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          return {
            ...profile,
            counters: {},
          };
        }),
      state
    );
  },
  23: (state: RootState) => {
    return _.update(
      ['settings', 'settings', 'theme'],
      (theme = 'dark') => {
        return 'dark';
      },
      state
    );
  },
  25: (state: RootState) => {
    return _.update(
      ['nostr', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          // Skip if no mnemonic or root already exists
          if (profile.root) return profile;

          try {
            // Convert mnemonic to seed
            const seed = bip39.mnemonicToSeedSync(profile.mnemonic);

            // Create HDKey from seed
            const hdKey = HDKey.fromMasterSeed(seed);

            // Derive xpriv and xpub
            const root = {
              xpriv: hdKey.privateExtendedKey,
              xpub: hdKey.publicExtendedKey,
            };

            return {
              ...profile,
              root,
            };
          } catch (error) {
            return profile;
          }
        }),
      state
    );
  },
  37: (state: RootState) => {
    const newState = _.update(
      ['nostr', 'search'],
      (search = []) => {
        return [
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
        ];
      },
      state
    );

    console.log(293892873, newState);
    return newState;
  },
  40: (state: RootState) => {
    return _.update(
      ['cashu', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          return {
            ...profile,
            transactions: profile.transactions.map((oldTx) => {
              // Convert amount to number for consistency
              const amount =
                typeof oldTx.amount === 'string' ? parseFloat(oldTx.amount) : oldTx.amount;

              // Define base transaction properties common to all transaction types
              const baseTx = {
                amount,
                date: oldTx.date,
                type: oldTx.type,
                transactionType: oldTx.transactionType,
                unit: oldTx.unit,
                mintUrl: oldTx.mintUrl,
                paid: oldTx.paid,

                counter: oldTx.counter,
                ...(oldTx?.nostr?.pubkey !== 'Unknown' && oldTx?.nostr?.pubkey
                  ? { nostr: oldTx.nostr }
                  : null),
              };

              // Add memo if note exists
              if (oldTx.note) {
                baseTx.memo = oldTx.note;
              }

              // Ecash Receive transaction
              if (oldTx.type === 'ecash' && oldTx.transactionType === 'receive') {
                const ecashReceiveTx = {
                  ...baseTx,
                  ...(oldTx.lnurl ? { fromNIP05: oldTx.lnurl } : null),
                  type: 'ecash',
                  transactionType: 'receive',
                  token: oldTx.token,
                  proofs: {
                    keep: oldTx.proofs?.keep || [],
                  },
                  ...(oldTx.privkey
                    ? {
                        p2pk: {
                          privkey: oldTx.privkey,
                        },
                      }
                    : null),
                };
                return ecashReceiveTx;
              }

              // Ecash Send transaction
              else if (oldTx.type === 'ecash' && oldTx.transactionType === 'send') {
                const ecashSendTx = {
                  ...baseTx,
                  type: 'ecash',
                  transactionType: 'send',
                  token: oldTx.token,
                  proofs: {
                    keep: oldTx.proofs?.keep || [],
                    send: oldTx.proofs?.send || [],
                  },
                };
                return ecashSendTx;
              }

              // Lightning Send transaction
              else if (oldTx.type === 'lightning' && oldTx.transactionType === 'send') {
                const lightningSendTx = {
                  ...baseTx,
                  type: 'lightning',
                  transactionType: 'send',
                  request: oldTx.request,
                  meltQuote: oldTx?.meltQuote,
                  proofs: {
                    keep: oldTx.proofs?.keep || [],
                    send: oldTx.proofs?.send || [],
                    change: oldTx.proofs?.change || [],
                  },
                };
                return lightningSendTx;
              }

              // Lightning Receive transaction
              else if (oldTx.type === 'lightning' && oldTx.transactionType === 'receive') {
                const lightningReceiveTx = {
                  ...baseTx,
                  type: 'lightning',
                  transactionType: 'receive',
                  request: oldTx.request,
                  // Handle the different property names that appear in your data
                  mintQuote: oldTx?.mintQuote || {
                    quote: oldTx?.quote,
                    request: oldTx?.request,
                  },
                  paymentRequest: oldTx.paymentRequest || oldTx.payment_request || '',
                  unifiedRequest: oldTx.unifiedRequest || oldTx.unified_request || '',
                };
                return lightningReceiveTx;
              }

              // Fallback, just in case there's an unknown transaction type
              else {
                console.warn(`Unknown transaction type: ${oldTx.type}-${oldTx.transactionType}`);
                return baseTx;
              }
            }),
          };
        }),
      state
    );
  },
  72: (state: RootState) => {
    return _.update(
      ['nostr', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any, index: number) => {
          if (profile?.nut13) {
            return profile;
          }

          try {
            const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(profile.mnemonic));
            const DERIVATION_PATH = `m/44'/129372'`;
            const path = `${DERIVATION_PATH}/0'/${index}'/0/0`;
            const seed = root.derive(path);
            const derivedCashuMnemonic = bip39.entropyToMnemonic(
              seed.privateKey as Uint8Array,
              wordlist
            );

            return {
              ...profile,
              nut13: derivedCashuMnemonic,
            };
          } catch (error) {
            return profile;
          }
        }),
      state
    );
  },
  74: (state: RootState) => {
    return _.update(['nostr', 'contacts'], (contacts = []) => contacts, state);
  },
};

const persistConfig = {
  key: 'SOVRAN',
  storage: AsyncStorage,
  timeout: null,
  version: 74,
  migrate: createMigrate(migrations, { debug: true }),
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = createStore(persistedReducer, applyMiddleware(thunkMiddleware));

// log state
store.subscribe(() => {
  const getStructure = (obj: any): any => {
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
      allKeys.forEach((key) => {
        structure[key] =
          exampleItem && key in exampleItem ? getStructure(exampleItem[key]) : 'undefined';
      });

      return [structure];
    }
    const structure: any = {};
    for (const key in obj) {
      if (key.includes('https://')) {
        structure['https://mint.example.com'] = getStructure(obj[key]);
      } else {
        structure[key] = getStructure(obj[key]);
      }
    }
    return structure;
  };

  // console.log(JSON.stringify(store.getState(), null, 2));
});

export const persistor = persistStore(store);

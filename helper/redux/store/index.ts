import { applyMiddleware, createStore } from 'redux';
import { createMigrate, persistStore, persistReducer } from 'redux-persist';
import rootReducer from './reducer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import _ from 'lodash/fp';

import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';

const thunkMiddleware = require('redux-thunk').thunk;

const migrations = {
  0: (state: any) => {
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
  5: (state: any) => {
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
  23: (state: any) => {
    return _.update(
      ['settings', 'settings', 'theme'],
      (theme = 'dark') => {
        return 'dark';
      },
      state
    );
  },
  25: (state: any) => {
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
};

const persistConfig = {
  key: 'SOVRAN',
  storage: AsyncStorage,
  timeout: null,
  version: 30,
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

  console.log(JSON.stringify(store.getState(), null, 2));

  // State structure is now accessible via Redux DevTools
});

export const persistor = persistStore(store);

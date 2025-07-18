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
    if (key.includes('https://')) {
      structure['https://mint.example.com'] = getStructure(obj[key]);
    } else {
      structure[key] = getStructure(obj[key]);
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

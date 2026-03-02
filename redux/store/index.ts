import { applyMiddleware, createStore, Dispatch } from 'redux';
import { createMigrate, persistStore, persistReducer, type PersistedState } from 'redux-persist';
import rootReducer, { RootState, AppThunk, RESET_APP } from './reducer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PUBLIC_KEYS } from 'helper/constants';
import _ from 'lodash/fp';
import { Alert } from 'react-native';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { storeMnemonic } from 'helper/secureStorage';

const thunkMiddleware = require('redux-thunk').thunk;

// WARNING: never use _.set, it will obviously delete the users storage...
// Also, don't delete them, obviously...
const migrations = {
  0: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
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
      state as unknown as RootState
    ) as PersistedState;
  },
  5: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['cashu', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          return {
            ...profile,
            counters: {},
          };
        }),
      state as unknown as RootState
    ) as PersistedState;
  },
  23: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['settings', 'settings', 'theme'],
      (theme = 'dark') => {
        return 'dark';
      },
      state as unknown as RootState
    ) as PersistedState;
  },
  25: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['nostr', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          // Skip if no mnemonic or root already exists
          if (profile.root) return profile;
          try {
            // Convert mnemonic to seed
            const seed = bip39.mnemonicToSeedSync(profile.mnemonic, '');
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
      state as unknown as RootState
    ) as PersistedState;
  },
  37: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    const newState = _.update(
      ['nostr', 'search'],
      (search = []) => {
        return [
          {
            pubkey: PUBLIC_KEYS.SUPPORT,
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
              pubkey: PUBLIC_KEYS.SUPPORT,
              npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
              banner: 'https://m.primal.net/Kgxi.png',
            },
          },
        ];
      },
      state as unknown as RootState
    );
    return newState as PersistedState;
  },
  40: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['cashu', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any) => {
          return {
            ...profile,
            transactions: profile.transactions.map((oldTx: any) => {
              // Convert amount to number for consistency
              const amount =
                typeof oldTx.amount === 'string' ? parseFloat(oldTx.amount) : oldTx.amount;
              // Define base transaction properties common to all transaction types
              const baseTx: {
                amount: any;
                date: any;
                type: any;
                transactionType: any;
                unit: any;
                mintUrl: any;
                paid: any;
                counter: any;
                nostr?: any;
                memo?: string;
              } = {
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
      state as unknown as RootState
    ) as PersistedState;
  },
  72: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['nostr', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any, index: number) => {
          if (profile?.nut13) {
            return profile;
          }
          try {
            const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(profile.mnemonic, ''));
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
      state as unknown as RootState
    ) as PersistedState;
  },
  74: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['nostr', 'contacts'],
      (contacts = []) => contacts,
      state as unknown as RootState
    ) as PersistedState;
  },
  101: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    return _.update(
      ['nostr', 'profiles'],
      (profiles = []) =>
        profiles.map((profile: any, index: number) => {
          try {
            if (!profile.mnemonic) {
              Alert.alert(
                'Share this error with the dev team',
                'No mnemonic found for Cashu profile at index ' + index
              );
              return profile;
            }
            // Create root HDKey from the profile's mnemonic
            const seed = bip39.mnemonicToSeedSync(profile.mnemonic, '');
            const root = HDKey.fromMasterSeed(seed);
            // NUT-13 derivation path for Cashu
            const DERIVATION_PATH = `m/44'/129372'`;
            const path = `${DERIVATION_PATH}/0'/${index}'/0/0`;
            // Derive the specific path
            const derivedKey = root.derive(path);
            // Convert the derived private key back to a mnemonic
            const derivedCashuMnemonic = bip39.entropyToMnemonic(
              derivedKey.privateKey as Uint8Array,
              wordlist
            );
            return {
              ...profile,
              nut13: derivedCashuMnemonic,
            };
          } catch (error) {
            Alert.alert('Share this error with the dev team', JSON.stringify(error));
            return profile;
          }
        }),
      state as unknown as RootState
    ) as PersistedState;
  },
  120: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
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
      state as unknown as RootState
    );
    return newState as PersistedState;
  },
  150: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    console.log('=== MIGRATION 123 DEBUG START ===');
    const rootState = state as unknown as RootState;

    // Generate allocation config based on highest balance mints
    // Use EXACT same logic as memoizedGetAllBalancesMultipleCurrencies
    const currentProfileId = rootState.nostr?.currentProfile?.id;
    console.log('Current Profile ID:', currentProfileId);

    // Get data using same selectors logic
    const mints = rootState.cashu.profiles[currentProfileId]?.mints || [];
    const proofsByMint = rootState.cashu.profiles[currentProfileId]?.proofs || {};
    const keysets = rootState.cashu?.keysets || {};
    const info = rootState.cashu?.info || {};

    console.log('Raw data extracted:');
    console.log('- Mints array:', mints);
    console.log('- ProofsByMint keys:', Object.keys(proofsByMint));
    console.log('- Keysets keys:', Object.keys(keysets));
    console.log('- Info keys:', Object.keys(info));

    // Exact same logic as memoizedGetAllBalancesMultipleCurrencies
    const allMints = mints || [];

    // Create a set of all mints (both from mints list and proofs)
    const mintSet = new Set([...allMints, ...Object.keys(proofsByMint)]);
    console.log('Mint set created:', Array.from(mintSet));

    // Convert Set back to array
    const uniqueMints = Array.from(mintSet);
    console.log('Unique mints to process:', uniqueMints);

    // Process each mint exactly like the selector
    const allBalances = uniqueMints
      .map((mint) => {
        console.log(`\n--- Processing mint: ${mint} ---`);

        // Get all unique units from keysets for this mint
        const mintKeysets = keysets[mint] || [];
        const mintInfo = info[mint] || {};
        console.log(`Mint keysets count: ${mintKeysets.length}`);
        console.log(`Mint info:`, mintInfo);

        const uniqueUnits = [...new Set(mintKeysets.map((ks: any) => ks.unit))];
        console.log(`Unique units from keysets:`, uniqueUnits);

        // If no units found, default to common currencies (like selector)
        const units = uniqueUnits.length > 0 ? uniqueUnits : ['sat', 'usd', 'eur', 'gbp'];
        console.log(`Final units to process:`, units);

        // Get proofs for this mint (or empty array if none)
        const proofs = proofsByMint[mint] || [];
        console.log(`Proofs count for mint: ${proofs.length}`);

        // Calculate balance for each unit exactly like selector
        return units.map((unit) => {
          console.log(`  Processing unit: ${unit}`);

          const matchingKeysets = mintKeysets.filter((ks: any) => ks.unit === unit);
          console.log(`  Matching keysets for ${unit}:`, matchingKeysets.length);

          // If there are no matching keysets for this unit, balance is 0
          if (matchingKeysets.length === 0) {
            console.log(`  ❌ No matching keysets for ${unit}, balance = 0`);
            return {
              mintUrl: mint,
              amount: 0,
              unit: unit,
              iconUrl: mintInfo?.icon_url || null,
            };
          }

          // Get all keyset IDs for this unit
          const keysetIds = matchingKeysets.map((ks: any) => ks.id);
          console.log(`  Keyset IDs for ${unit}:`, keysetIds);

          // Filter proofs that match these keysets
          const filteredProofs = proofs.filter((proof: any) => keysetIds.includes(proof.id));
          console.log(`  Filtered proofs count: ${filteredProofs.length}`);
          console.log(
            `  Filtered proofs:`,
            filteredProofs.map((p) => ({ id: p.id, amount: p.amount }))
          );

          // Sum amounts (or 0 if no proofs) - exact same logic
          const amount =
            filteredProofs.reduce((sum: number, proof: any) => sum + (proof.amount || 0), 0) || 0;
          console.log(`  ✅ Final amount for ${unit}: ${amount}`);

          return {
            mintUrl: mint,
            amount,
            unit: unit,
            iconUrl: mintInfo?.icon_url || null,
          };
        });
      })
      .flat(); // Flatten array of arrays into single array

    console.log('\n=== ALL BALANCES CALCULATED ===');
    console.log('All balances:', allBalances);

    // Group balances by currency
    const balancesByCurrency: Record<string, { mintUrl: string; amount: number }[]> = {};
    allBalances.forEach((balance) => {
      const unit = balance.unit.toLowerCase();
      if (!balancesByCurrency[unit]) {
        balancesByCurrency[unit] = [];
      }
      balancesByCurrency[unit].push({
        mintUrl: balance.mintUrl,
        amount: balance.amount,
      });
    });

    console.log('\n=== BALANCES GROUPED BY CURRENCY ===');
    Object.entries(balancesByCurrency).forEach(([currency, balances]) => {
      console.log(`${currency}:`, balances);
    });

    // Create allocation config
    const allocation: Record<string, Record<string, number>> = {};

    Object.entries(balancesByCurrency).forEach(([currency, balances]) => {
      console.log(`\n--- Creating allocation for ${currency} ---`);

      // Sort by balance descending (highest first, even if 0)
      balances.sort((a, b) => b.amount - a.amount);
      console.log(`Sorted balances:`, balances);

      const currencyAllocation: Record<string, number> = {};

      // Always assign 100% to first mint (highest balance, even if 0)
      if (balances.length > 0) {
        const topMint = balances[0].mintUrl;
        currencyAllocation[topMint] = 10000;
        console.log(`✅ Assigned 100% (10000) to top mint: ${topMint}`);

        // Set all others to 0
        balances.slice(1).forEach(({ mintUrl }) => {
          currencyAllocation[mintUrl] = 0;
          console.log(`  Set ${mintUrl} to 0%`);
        });
      }

      allocation[currency] = currencyAllocation;
      console.log(`Final allocation for ${currency}:`, currencyAllocation);
    });

    console.log('\n=== FINAL ALLOCATION CONFIG ===');
    console.log('Complete allocation:', JSON.stringify(allocation, null, 2));

    console.log('\n=== MIGRATION 123 DEBUG END ===');

    return _.update('cashu.allocation', () => allocation, rootState) as PersistedState;
  },
  151: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    console.log('=== MIGRATION 151: Moving mnemonic to secure storage ===');
    const rootState = state as unknown as RootState;

    try {
      // Get profile 0 from nostr profiles
      const profiles = rootState.nostr?.profiles || [];
      const profile0 = profiles[0];

      if (!profile0) {
        console.log('No profile 0 found, skipping migration');
        return state;
      }

      if (!profile0.mnemonic) {
        console.log('No mnemonic found in profile 0, skipping migration');
        return state;
      }

      console.log('Found mnemonic in profile 0, storing in secure storage...');

      // Store the mnemonic in secure storage (async operation)
      // We'll handle the completion in MigrationGate
      storeMnemonic(profile0.mnemonic)
        .then((success) => {
          if (success) {
            console.log('✅ Successfully stored mnemonic in secure storage');
          } else {
            console.log('❌ Failed to store mnemonic in secure storage');
            Alert.alert(
              'Migration Warning',
              'Failed to store mnemonic in secure storage. Please contact support if this persists.'
            );
          }
        })
        .catch((error) => {
          console.error('Migration 151 error:', error);
          Alert.alert(
            'Migration Error',
            'An error occurred during migration. Please contact support if this persists.'
          );
        });
    } catch (error) {
      console.error('Migration 151 error:', error);
      Alert.alert(
        'Migration Error',
        'An error occurred during migration. Please contact support if this persists.'
      );
    }

    console.log('=== MIGRATION 151 COMPLETE ===');
    return state;
  },
  152: (state: PersistedState): PersistedState => {
    if (!state || typeof state !== 'object') return state;
    console.log('=== MIGRATION 152: Migrating settings from Redux to Zustand ===');
    const rootState = state as unknown as RootState;

    try {
      // Import the migration function dynamically to avoid circular dependencies
      import('stores/migrateSettings')
        .then(({ migrateSettingsFromRedux }) => {
          migrateSettingsFromRedux(rootState)
            .then(() => {
              console.log('✅ Settings migration to Zustand completed');
            })
            .catch((error) => {
              console.error('❌ Settings migration failed:', error);
            });
        })
        .catch((error) => {
          console.error('❌ Failed to import migration function:', error);
        });
    } catch (error) {
      console.error('Migration 152 error:', error);
    }

    console.log('=== MIGRATION 152 COMPLETE ===');
    return state;
  },
};

const persistConfig = {
  key: 'SOVRAN',
  storage: AsyncStorage,
  timeout: undefined,
  version: 251,
  migrate: createMigrate(migrations as any, { debug: true }),
  // Ensure migrations complete before rehydration finishes
  transforms: [],
};

const persistedReducer = persistReducer(persistConfig, rootReducer as any);

export const store = createStore(persistedReducer, applyMiddleware(thunkMiddleware));

store.subscribe(() => {});

export const persistor = persistStore(store);

// Typed reset app action creator moved here to avoid a require cycle
export const resetApp = (): AppThunk => {
  return async (dispatch: Dispatch): Promise<void> => {
    try {
      console.log('Starting complete app reset...');

      // Get profile data first (before any clearing)
      const { useProfileStore } = await import('stores/profileStore');
      const profiles = useProfileStore.getState().profiles;
      const accountIndexes = profiles.map((p) => p.accountIndex);
      const importedPubkeys = profiles.filter((p) => p.source === 'imported').map((p) => p.pubkey);

      // 1. Clear ALL Coco SQLite databases (coco.db, coco-N.db for every profile)
      try {
        const { CocoManager } = await import('helper/coco/manager');
        await CocoManager.completeReset(accountIndexes);
        console.log('✅ Coco databases and manager reset successfully');
      } catch (error) {
        console.warn('⚠️ Failed to reset Coco databases:', error);
        // Continue with other cleanup even if this fails
      }

      // 2. Clear secure storage (mnemonic, derived keys, cashu mnemonics, imported nsecs)
      try {
        const { clearAllSecureData } = await import('helper/secureStorage');
        const cleared = await clearAllSecureData(accountIndexes, importedPubkeys);
        if (cleared) {
          console.log('✅ Secure storage cleared successfully');
        } else {
          console.warn('⚠️ Secure storage clear returned false');
        }
      } catch (error) {
        console.warn('⚠️ Failed to clear secure storage:', error);
        // Continue with other cleanup even if this fails
      }

      // 3. Clear ALL Zustand stores (in-memory + current profile AsyncStorage)
      try {
        const { useMintStore } = await import('stores/mintStore');
        const { useSettingsStore } = await import('stores/settingsStore');
        const { usePricelistStore } = await import('stores/pricelistStore');
        const { useSwapTransactionsStore } = await import('stores/swapTransactionsStore');
        const { useSearchHistoryStore } = await import('stores/searchHistoryStore');
        const { useBTCMapStore } = await import('stores/btcMapStore');
        const { useScanHistoryStore } = await import('stores/scanHistoryStore');
        const { useMintDistributionStore } = await import('stores/mintDistributionStore');
        const { useRoutstrStore } = await import('stores/routstrStore');
        const { useAuditMintStore } = await import('stores/auditMintStore');
        const { useTransactionLocationStore } = await import('stores/transactionLocationStore');
        const { useKYMMintStore } = await import('stores/kymMintStore');

        // Clear each store (both in-memory state and AsyncStorage)
        const storesToClear = [
          { name: 'Mint', clear: () => useMintStore.getState().clearAllData() },
          { name: 'Settings', clear: () => useSettingsStore.getState().clearAllData() },
          { name: 'Pricelist', clear: () => usePricelistStore.getState().clearAllData() },
          {
            name: 'SwapTransactions',
            clear: () => useSwapTransactionsStore.getState().clearAllData(),
          },
          { name: 'SearchHistory', clear: () => useSearchHistoryStore.getState().clearAllData() },
          { name: 'BTCMap', clear: () => useBTCMapStore.getState().clearAllData() },
          { name: 'ScanHistory', clear: () => useScanHistoryStore.getState().clearAllData() },
          {
            name: 'MintDistribution',
            clear: () => useMintDistributionStore.getState().clearAllData(),
          },
          { name: 'Routstr', clear: () => useRoutstrStore.getState().clearAllData() },
          { name: 'AuditMint', clear: () => useAuditMintStore.getState().clearAllData() },
          {
            name: 'TransactionLocation',
            clear: () => useTransactionLocationStore.getState().clearAllData(),
          },
          { name: 'KYMMint', clear: () => useKYMMintStore.getState().clearAllData() },
        ];

        for (const store of storesToClear) {
          try {
            await store.clear();
            console.log(`✅ ${store.name} store cleared successfully`);
          } catch (error) {
            console.warn(`⚠️ Failed to clear ${store.name} store:`, error);
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to clear Zustand stores:', error);
        // Continue with other cleanup even if this fails
      }

      // 3b. Clear profile-scoped store data for ALL profiles (not just active)
      try {
        const { clearAllProfileScopedData } = await import('helper/profileScopedStorage');
        await clearAllProfileScopedData(accountIndexes);
        console.log('✅ All profile-scoped store data cleared across all profiles');
      } catch (error) {
        console.warn('⚠️ Failed to clear profile-scoped data:', error);
        // Continue with other cleanup even if this fails
      }

      // 4. Clear profile store (Zustand + AsyncStorage)
      try {
        useProfileStore.setState({
          activeAccountIndex: 0,
          profiles: [],
          cocoMigrationComplete: {},
        });
        await AsyncStorage.removeItem('profile-store');
        console.log('✅ Profile store cleared successfully');
      } catch (error) {
        console.warn('⚠️ Failed to clear profile store:', error);
      }

      // 5. Clear persisted redux data
      await persistor.purge();
      console.log('✅ Redux data cleared successfully');

      // 6. Dispatch the reset action to clear the in-memory state
      dispatch({ type: RESET_APP });

      // 7. Restart persistence after reset
      persistor.persist();

      console.log('Complete app reset finished successfully');

      return Promise.resolve();
    } catch (error) {
      console.error('Failed to reset app:', error);
      return Promise.reject(error);
    }
  };
};

import { applyMiddleware, createStore } from 'redux';
import { createMigrate, persistStore, persistReducer } from 'redux-persist';
import rootReducer, { RootState, AppThunk, RESET_APP } from './reducer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import _ from 'lodash/fp';
import { Alert } from 'react-native';
import bip39 from 'bip39';
import { HDKey } from '@scure/bip32';
import { wordlist } from '@scure/bip39/wordlists/english';

const thunkMiddleware = require('redux-thunk').thunk;

// WARNING: never use _.set, it will obviously delete the users storage...
// Also, don't delete them, obviously...
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
              seed.privateKey as Buffer,
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
  101: (state: RootState) => {
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
            const seed = bip39.mnemonicToSeedSync(profile.mnemonic);
            const root = HDKey.fromMasterSeed(seed);
            // NUT-13 derivation path for Cashu
            const DERIVATION_PATH = `m/44'/129372'`;
            const path = `${DERIVATION_PATH}/0'/${index}'/0/0`;
            // Derive the specific path
            const derivedKey = root.derive(path);
            // Convert the derived private key back to a mnemonic
            const derivedCashuMnemonic = bip39.entropyToMnemonic(
              derivedKey.privateKey as Buffer,
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
      state
    );
  },
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
  150: (state: RootState) => {
    console.log('=== MIGRATION 123 DEBUG START ===');

    // Generate allocation config based on highest balance mints
    // Use EXACT same logic as memoizedGetAllBalancesMultipleCurrencies
    console.log(123123, state.nostr);
    const currentProfileId = state.nostr?.currentProfile?.id;
    console.log('Current Profile ID:', currentProfileId);

    // Get data using same selectors logic
    const mints = state.cashu.profiles[currentProfileId]?.mints || [];
    const proofsByMint = state.cashu.profiles[currentProfileId]?.proofs || {};
    const keysets = state.cashu?.keysets || {};
    const info = state.cashu?.info || {};

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

    return _.update('cashu.allocation', () => allocation, state);
  },
};

const persistConfig = {
  key: 'SOVRAN-1',
  storage: AsyncStorage,
  timeout: null,
  version: 150,
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
  rootSections: ['settings', 'cashu', 'pricelist', 'nostr', '_persist'],

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
    'allocation',
  ],

  // Settings sub-objects
  termsAccepted: ['termsAccepted', 'date'],

  backgroundImageAttrs: ['id', 'shades', 'greys', 'text', 'tint', 'dominantColors'],

  // Allocation structure (currency -> mint URL -> ratio)
  allocation: ['sat', 'usd', 'eur', 'gbp'],

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
    if (obj.length === 0) {
      return [];
    }

    const firstItem = obj[0];

    // If array contains primitives (strings, numbers, etc.)
    if (typeof firstItem !== 'object' || firstItem === null) {
      return [typeof firstItem];
    }

    // If array contains objects, use your existing logic
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
  console.log('STATE', JSON.stringify(store.getState(), null, 2));
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

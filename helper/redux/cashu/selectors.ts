import { createSelector } from "reselect";
import _ from "lodash";
import { RootState } from "helper/redux/store/reducer";

export const memoizedGetMints = createSelector(
  [
    (state: RootState) =>
      state.cashu.profiles[state.nostr.currentProfile.id]?.mints,
  ],
  (mints) => {
    return mints || [];
  },
);

export const memoizedGetSupportedUnits = createSelector(
  [
    (state: RootState) =>
      state.cashu?.keysets?.[
        state.cashu.profiles?.[state.nostr.currentProfile.id]?.selectedMint
      ],
  ],
  (keysets) => {
    return [...new Set(keysets?.map((keyset) => keyset.unit) || ["sat"])];
  },
);

export const memoizedGetTransactionByMatcher = ({ profileId, matcher }) =>
  createSelector(
    [(state: RootState) => state.cashu.profiles[profileId]?.transactions],
    (transactions) => {
      if (!transactions || transactions.length === 0) return null;
      return matcher(transactions);
    },
  );

export const memoizedGetMintNostrContact = (mintUrl: string) =>
  createSelector(
    [(state: RootState) => state.cashu?.info?.[mintUrl]?.contact],
    (contactList) => {
      if (!Array.isArray(contactList)) return null;
      const entry = contactList.find(
        (c) => c.method && c.method.toLowerCase() === 'nostr',
      );
      return entry ? entry.info : null;
    },
  );
export const memoizedGetSelectedMint = createSelector(
  [
    (state: RootState) =>
      state.cashu.profiles?.[state.nostr.currentProfile.id]?.selectedMint,
  ],
  (selectedMint) => {
    return selectedMint;
  },
);

export const memoizedGetKeysets = (mintUrl) =>
  createSelector(
    [(state: RootState) => state.cashu?.keysets?.[mintUrl]],
    (keysets) => {
      return keysets;
    },
  );

export const memoizedGetMintInfo = (mintUrl) =>
  createSelector(
    [(state: RootState) => state.cashu?.info?.[mintUrl]],
    (info) => {
      return info;
    },
  );

export const memoizedGetAudit = (mintUrl) =>
  createSelector(
    [(state: RootState) => state.cashu?.audits?.[mintUrl]],
    (audit) => {
      return audit;
    },
  );

export const memoizedGetCounter = ({ profileId, mintUrl }) =>
  createSelector(
    [
      (state: RootState) =>
        state.cashu.profiles[profileId]?.counters?.[mintUrl],
    ],
    (counter) => 200 + (counter || 0),
  );

export const memoizedGetCounterV2 = ({ profileId, mintUrl, keysetId }) =>
  createSelector(
    [
      (state: RootState) =>
        _.get(
          state.cashu,
          ["profiles", profileId, "counters", mintUrl, keysetId],
          1,
        ),
    ],
    (counter) => counter,
  );

export const memoizedGetTransactions = ({ id }: { id: number }) =>
  createSelector(
    [(state: RootState) => state.cashu?.profiles[id]?.transactions],
    (transactions) => {
      return transactions;
    },
  );

export const memoizedGetProofs = (unit) =>
  createSelector(
    [
      (state: RootState) =>
        state.cashu.profiles[state.nostr.currentProfile.id]?.proofs?.[
          state.cashu.profiles?.[state.nostr.currentProfile.id]?.selectedMint
        ],
      (state: RootState) =>
        state.cashu?.keysets?.[
          state.cashu.profiles?.[state.nostr.currentProfile.id]?.selectedMint
        ],
    ],
    (proofs, keysets) => {
      const matchingKeysets = _.filter(keysets, (ks) => ks.unit === unit);
      if (_.isEmpty(matchingKeysets)) {
        return [];
      }
      const keysetIds = _.map(matchingKeysets, "id");
      return _.filter(proofs, (proof) => _.includes(keysetIds, proof.id));
    },
  );
export const memoizedGetAllBalances = createSelector(
  [
    (state: RootState) =>
      state.cashu.profiles[state.nostr.currentProfile.id]?.proofs,
  ],
  (proofsByMint) => {
    return Object.keys(proofsByMint).map((mint) => {
      return {
        mintUrl: mint,
        amount: _.sumBy(proofsByMint[mint], "amount"),
        unit: "sat",
      };
    });
  },
);

export const memoizedGetAllBalancesMultipleCurrencies = createSelector(
  [
    (state: RootState) => memoizedGetMints(state),
    (state: RootState) =>
      state.cashu.profiles[state.nostr.currentProfile.id]?.proofs || {},
    (state: RootState) => state.cashu?.keysets || {},
    (state: RootState) => state.cashu?.info || {},
  ],
  (mints, proofsByMint, keysets, info) => {
    // Start with all mints the user has
    const allMints = mints || [];

    // Create a set of all mints (both from mints list and proofs)
    const mintSet = new Set([...allMints, ...Object.keys(proofsByMint)]);

    // Convert Set back to array
    const uniqueMints = Array.from(mintSet);

    // Process each mint
    const response = uniqueMints
      .map((mint) => {
        // Get all unique units from keysets for this mint
        const mintKeysets = keysets[mint] || [];
        const mintInfo = info[mint] || {};
        const uniqueUnits = [...new Set(mintKeysets.map((ks) => ks.unit))];

        // If no units found, default to "sat"
        const units = uniqueUnits.length > 0 ? uniqueUnits : ["sat"];

        // Get proofs for this mint (or empty array if none)
        const proofs = proofsByMint[mint] || [];

        // Calculate balance for each unit
        return units.map((unit) => {
          const matchingKeysets = _.filter(
            mintKeysets,
            (ks) => ks.unit === unit,
          );

          // If there are no matching keysets for this unit, balance is 0
          if (_.isEmpty(matchingKeysets)) {
            return {
              mintUrl: mint,
              amount: 0,
              unit: unit,
              iconUrl: mintInfo?.icon_url || null,
            };
          }

          // Get all keyset IDs for this unit
          const keysetIds = _.map(matchingKeysets, "id");

          // Filter proofs that match these keysets
          const filteredProofs = _.filter(proofs, (proof) =>
            _.includes(keysetIds, proof.id),
          );

          // Sum amounts (or 0 if no proofs)
          return {
            mintUrl: mint,
            amount: _.sumBy(filteredProofs, "amount") || 0,
            unit: unit,
            iconUrl: mintInfo?.icon_url || null,
          };
        });
      })
      .flat(); // Flatten array of arrays into single array

    return response;
  },
);

export const memoizedGetBalance = (unit, mintUrl = null) =>
  createSelector(
    [
      (state: RootState) =>
        state.cashu.profiles[state.nostr.currentProfile.id]?.proofs?.[
          mintUrl ||
            state.cashu.profiles?.[state.nostr.currentProfile.id]?.selectedMint
        ],
      (state: RootState) =>
        state.cashu?.keysets?.[
          mintUrl ||
            state.cashu.profiles?.[state.nostr.currentProfile.id]?.selectedMint
        ],
    ],
    (proofs, keysets) => {
      const matchingKeysets = _.filter(keysets, (ks) => ks.unit === unit);
      if (_.isEmpty(matchingKeysets)) {
        return 0;
      }
      const keysetIds = _.map(matchingKeysets, "id");
      const filteredProofs = _.filter(proofs, (proof) =>
        _.includes(keysetIds, proof.id),
      );
      return _.sumBy(filteredProofs, "amount");
    },
  );

export const memoizedGetTotalBalance = (unit) =>
  createSelector(
    [
      (state: RootState) =>
        state.cashu.profiles[state.nostr.currentProfile.id]?.proofs,
      (state: RootState) => state.cashu?.keysets,
    ],
    (proofsByMint, keysets) => {
      if (!proofsByMint || !keysets) return 0;

      return Object.keys(proofsByMint).reduce((total, mint) => {
        const matchingKeysets = _.filter(
          keysets[mint],
          (ks) => ks.unit === unit,
        );
        if (_.isEmpty(matchingKeysets)) {
          return total;
        }
        const keysetIds = _.map(matchingKeysets, "id");
        const filteredProofs = _.filter(proofsByMint[mint], (proof) =>
          _.includes(keysetIds, proof.id),
        );
        return total + _.sumBy(filteredProofs, "amount");
      }, 0);
    },
  );

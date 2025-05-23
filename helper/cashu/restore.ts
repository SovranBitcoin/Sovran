import { getWallet } from './wallet';
import { getMint } from './mint';
import { Proof, ProofState } from '@cashu/cashu-ts';

// https://github.com/cashubtc/cashu.me/blob/8cdb2b45d7353fac5b5d2af3388a5783ee9fae9b/src/stores/restore.ts
export async function* restoreMint({
  mintUrl,
  profile,
  BATCH_SIZE = 100,
  MAX_GAP = 2,
  allowedUnits = ['sat'],
}: {
  mintUrl: string;
  profile: string;
  BATCH_SIZE?: number;
  MAX_GAP?: number;
  allowedUnits?: string[];
}) {
  try {
    let response = {};
    const mint = await getMint({ mintUrl });

    const keysets = (await mint.getKeySets()).keysets;

    const uniqueUnits = keysets
      .filter((keyset, index, self) => index === self.findIndex((k) => k.unit === keyset.unit))
      .filter((keyset) => allowedUnits.includes(keyset.unit));

    yield {
      label: 'INIT',
      progress: 0,
      totalUnits: uniqueUnits.length,
      currentUnit: 0,
      message: 'Starting restoration process',
      mintUrl,
      response,
    };

    for (let i = 0; i < uniqueUnits.length; i++) {
      const keyset = uniqueUnits[i];

      yield {
        label: 'RESTORING KEYSET',
        unit: keyset.unit,
        progress: i / uniqueUnits.length,
        currentUnit: i + 1,
        totalUnits: uniqueUnits.length,
        message: `Restoring keyset for ${keyset.unit}`,
        mintUrl,
        response,
      };

      const wallet = await getWallet({ unit: keyset.unit, mintUrl, profile });
      let start: number = 0;
      let emptyBatchCount: number = 0;
      let restoredProofs: Proof[] = [];
      let totalProofsProcessed = 0;
      let firstEmptyStart = 0; // Track the first position where proofs begin to be empty

      while (emptyBatchCount < MAX_GAP) {
        yield {
          label: 'RESTORING BATCH',
          unit: keyset.unit,
          batchStart: start,
          batchEnd: start + BATCH_SIZE,
          currentUnit: i + 1,
          totalUnits: uniqueUnits.length,
          message: `Fetching proofs ${start} to ${start + BATCH_SIZE}`,
          mintUrl,
          response,
        };

        // Fetch a batch of proofs
        const uncheckedProofs: Proof[] = (
          await wallet.restore(start, BATCH_SIZE, { keysetId: keyset.id })
        ).proofs;

        if (uncheckedProofs.length === 0) {
          if (emptyBatchCount === 0) {
            firstEmptyStart = start;
          }
          emptyBatchCount++;
        } else {
          emptyBatchCount = 0;
          firstEmptyStart = 0; // Reset if we find proofs again
          totalProofsProcessed += uncheckedProofs.length;

          // Process this batch immediately instead of waiting
          if (uncheckedProofs.length > 0) {
            yield {
              label: 'CHECKING BATCH',
              unit: keyset.unit,
              batchStart: start,
              batchSize: uncheckedProofs.length,
              currentUnit: i + 1,
              totalUnits: uniqueUnits.length,
              message: `Checking states for ${uncheckedProofs.length} proofs`,
              mintUrl,
              response,
            };

            // Check states of this batch
            const proofStates: ProofState[] = await wallet.checkProofsStates(uncheckedProofs);

            // Filter and keep only the unspent proofs
            const unspentProofs = uncheckedProofs.filter(
              (p, index) => proofStates[index].state === 'UNSPENT'
            );

            // Add unspent proofs to our collection
            restoredProofs = restoredProofs.concat(unspentProofs);

            yield {
              label: 'BATCH_PROCESSED',
              unit: keyset.unit,
              batchStart: start,
              unspentCount: unspentProofs.length,
              totalUnspent: restoredProofs.length,
              totalProcessed: totalProofsProcessed,
              currentUnit: i + 1,
              totalUnits: uniqueUnits.length,
              message: `Found ${unspentProofs.length} unspent proofs in batch`,
              mintUrl,
              response,
            };
          }
        }

        start += BATCH_SIZE;
      }

      // Calculate the final index after searching
      const keysetIndex = firstEmptyStart !== 0 ? firstEmptyStart : start - MAX_GAP * BATCH_SIZE;

      // Build the full response
      response = {
        ...response,
        [keyset.unit]: {
          proofs: restoredProofs,
          keysets: {
            ...response?.[keyset?.unit]?.keysets,
            [keyset.id]: keysetIndex,
          },
        },
      };

      yield {
        label: 'KEYSET_COMPLETE',
        unit: keyset.unit,
        progress: (i + 1) / uniqueUnits.length,
        currentUnit: i + 1,
        totalUnits: uniqueUnits.length,
        proofCount: restoredProofs.length,
        index: keysetIndex, // Add index to the yield data
        message: `Completed keyset for ${keyset.unit} with ${restoredProofs.length} proofs, index: ${keysetIndex}`,
        mintUrl,
        response,
      };
    }

    yield {
      label: 'COMPLETE',
      progress: 1,
      message: 'Restoration complete',
      mintUrl,
      response,
    };

    return response;
  } catch (err) {
    console.log(err);
    return null;
  }
}

export async function restoreCounter({
  keyset,
  mintUrl,
  BATCH_SIZE = 25,
  MAX_GAP = 2,
}: {
  keyset: any;
  mintUrl: string;
  BATCH_SIZE?: number;
  MAX_GAP?: number;
}): Promise<number> {
  const wallet = await getWallet({ unit: keyset.unit, mintUrl, profile: null });

  let start = 0;
  let emptyBatchCount = 0;
  let firstEmptyStart = 0;

  while (emptyBatchCount < MAX_GAP) {
    const { proofs } = await wallet.restore(start, BATCH_SIZE, {
      keysetId: keyset.id,
    });

    if (proofs.length === 0) {
      if (emptyBatchCount === 0) {
        firstEmptyStart = start;
      }
      emptyBatchCount++;
    } else {
      emptyBatchCount = 0;
      firstEmptyStart = 0;
    }

    if (emptyBatchCount >= MAX_GAP) {
      break;
    }

    start += BATCH_SIZE;
  }

  return firstEmptyStart;
}

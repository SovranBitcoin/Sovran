/**
 * ═══════════════════════════════════════════════════════════════════════════
 * mockOperations.ts — Recording Mock Operations
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The PaymentMachine calls "operations" to perform side effects: send ecash,
 * create mint quotes, build mint lists, etc. In production, these are backed
 * by the coco-cashu-core Manager. In tests, they're mock functions that:
 *
 *   1. Record every call (name, args, result/error)
 *   2. Return deterministic stub data
 *   3. Can be overridden per-test for specific behaviors
 *
 * The recording wrapper is transparent — it wraps the real operation
 * (default or overridden) and captures calls without changing behavior.
 *
 * DEFAULT STUB BEHAVIOR:
 *   executeSend       → returns a fake history entry (JSON string)
 *   executeMintQuote  → returns a fake history entry (type: 'mint')
 *   buildMintListItems → mirrors the candidates back as MintListItems
 *   trustMint         → no-op (resolves immediately)
 *   executeMelt       → returns a fake PAID history entry
 *   executePaymentRequest → returns a fake pending history entry
 *   linkTransaction   → no-op
 *   executeNfcSend    → returns a mock token + history entry
 *   rollbackSend      → no-op
 *   checkSendStatus   → returns { state: 'pending' }
 *   executeReceive    → returns a fake history entry (type: 'receive')
 *   isMintTrusted     → returns true
 *   rollbackMelt      → no-op
 *
 * OVERRIDING IN TESTS:
 *   createTestMachine({
 *     operations: {
 *       executeSend: async () => { throw new Error('Network error'); },
 *     },
 *   });
 *   This replaces only executeSend — all other operations keep defaults.
 *
 * DETERMINISTIC TRANSACTION IDs:
 *   Each test starts with resetTxCounter() so IDs are reproducible:
 *   test-tx-1, test-tx-2, etc. This makes snapshot testing reliable.
 */

import type { MachineOperations, StepDataMap } from '../../src/machine/types';
import type { MintListItem } from '../../src/types';
import type { OperationCall } from './types';
import { MINT_METADATA } from './fixtures';

// ---------------------------------------------------------------------------
// Default stub responses
// ---------------------------------------------------------------------------

/**
 * Sequential transaction counter for deterministic IDs.
 * Reset at the start of each test via resetTxCounter().
 */
let txCounter = 0;

function nextTxId(): string {
  txCounter += 1;
  return `test-tx-${txCounter}`;
}

export function resetTxCounter(): void {
  txCounter = 0;
}

/**
 * Creates a fake history entry JSON string. These entries mimic the
 * shape of real history entries from coco-cashu-core. Tests that need
 * to inspect history entries can JSON.parse() the returned string.
 */
function stubHistoryEntry(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    id: nextTxId(),
    type: 'send',
    createdAt: 1700000000000,
    mintUrl: 'https://mint1.example.com',
    amount: 100,
    unit: 'sat',
    state: 'pending',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Recording operations — wraps each operation to record calls
// ---------------------------------------------------------------------------

/**
 * Creates the full MachineOperations object with recording wrappers.
 *
 * The `wrap` helper:
 *   1. Checks if an override was provided for this operation
 *   2. If not, uses the default stub implementation
 *   3. Wraps the chosen implementation to record calls
 *   4. Returns the wrapped version
 *
 * @param overrides - Per-test operation overrides (e.g. to simulate failures)
 * @param calls - Array where operation calls are recorded
 */
export function createMockOperations(
  overrides?: Partial<MachineOperations>,
  calls?: OperationCall[]
): MachineOperations {
  const record = calls ?? [];

  /**
   * Wraps a single operation with recording. The wrapper:
   *   1. Pushes { name, args } to the record array
   *   2. Calls the real implementation
   *   3. Records the result (or error if it throws)
   *   4. Returns/throws as the real implementation did
   */
  function wrap<K extends keyof MachineOperations>(
    name: K,
    defaultImpl: MachineOperations[K]
  ): MachineOperations[K] {
    const impl = overrides?.[name] ?? defaultImpl;
    if (!impl) return undefined as MachineOperations[K];

    return (async (...args: unknown[]) => {
      const call: OperationCall = { name, args };
      record.push(call);
      try {
        const result = await (impl as Function)(...args);
        call.result = result;
        return result;
      } catch (err) {
        call.error = err;
        throw err;
      }
    }) as MachineOperations[K];
  }

  return {
    // executeSend: creates an ecash token and returns a history entry
    executeSend: wrap('executeSend', async (_mintUrl, _amount) => ({
      historyEntry: stubHistoryEntry({ type: 'send' }),
    })),

    // executeMintQuote: creates a Lightning invoice via the mint
    executeMintQuote: wrap('executeMintQuote', async (_mintUrl, _amount, _unit) => ({
      historyEntry: stubHistoryEntry({ type: 'mint' }),
    })),

    // buildMintListItems: builds the UI data for the mint picker.
    // Default: mirrors candidates back as available MintListItems with
    // realistic displayName/iconUrl from MINT_METADATA (simulates what
    // getAllTrustedMints() returns from the Manager in production).
    buildMintListItems: wrap(
      'buildMintListItems',
      async (data: StepDataMap['selectMint']): Promise<MintListItem[]> => {
        const items = data.candidates.map((c) => ({
          mintUrl: c.mintUrl,
          displayName: MINT_METADATA[c.mintUrl]?.displayName ?? c.mintUrl,
          iconUrl: MINT_METADATA[c.mintUrl]?.iconUrl,
          balance: c.balance,
          unit: data.unit,
          status: 'available' as const,
          reason: null as MintListItem['reason'],
          isPreferred: false,
        }));
        items.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'available' ? -1 : 1;
          return b.balance - a.balance;
        });
        return items;
      }
    ),

    // trustMint: adds a mint to the trusted list (no-op in tests)
    trustMint: wrap('trustMint', async () => {}),

    // buildMintReviewInfo: fetches KYM/audit data (not available in tests)
    buildMintReviewInfo: wrap('buildMintReviewInfo', undefined),

    // executeMelt: converts ecash to Lightning payment
    executeMelt: wrap('executeMelt', async (_mintUrl, _meltTarget, _amount, _unit) => ({
      historyEntry: stubHistoryEntry({ type: 'melt', state: 'PAID' }),
    })),

    // executePaymentRequest: sends ecash via HTTP transport
    executePaymentRequest: wrap(
      'executePaymentRequest',
      async (_mintUrl, _paymentRequest, _amount, _unit) => ({
        historyEntry: stubHistoryEntry({ type: 'send', state: 'pending' }),
      })
    ),

    // linkTransaction: links a transaction to scan history (no-op in tests)
    linkTransaction: wrap('linkTransaction', () => {}),

    // executeNfcSend: creates an NFC-compatible token
    executeNfcSend: wrap('executeNfcSend', async (_mintUrl, _amount) => ({
      token: 'cashuBmock_nfc_token',
      historyEntry: stubHistoryEntry({ type: 'send' }),
      operationId: nextTxId(),
    })),

    // rollbackSend: cancels a prepared send (no-op in tests)
    rollbackSend: wrap('rollbackSend', async () => {}),

    // checkSendStatus: checks if a send token has been redeemed
    checkSendStatus: wrap('checkSendStatus', async (_operationId) => ({
      state: 'pending',
    })),

    // executeReceive: receives an ecash token
    executeReceive: wrap('executeReceive', async (_tokenString, _mintUrl, _amount) => ({
      historyEntry: stubHistoryEntry({ type: 'receive' }),
    })),

    // isMintTrusted: checks if a mint is in the trusted list
    isMintTrusted: wrap('isMintTrusted', async (_mintUrl) => true),

    // rollbackMelt: cancels a melt operation (no-op in tests)
    rollbackMelt: wrap('rollbackMelt', async () => {}),

    // resolveRecipientPubkey / resolveRecipientProfile: optional recipient
    // identity enrichers. No defaults in tests; individual suites opt in.
    resolveRecipientPubkey: wrap('resolveRecipientPubkey', undefined),
    resolveRecipientProfile: wrap('resolveRecipientProfile', undefined),
  };
}

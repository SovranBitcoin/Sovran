/**
 * @jest-environment node
 */

/**
 * A sealed row must quote the reservation the node will actually take.
 *
 * Routstr discounts its admission gate when a request carries a `max_tokens`
 * bound: instead of holding the row's `max_cost` ceiling it holds prompt +
 * max_tokens×completion. A node cannot read an end-to-end-encrypted body, so
 * it cannot verify that bound and the SDK skips the discount entirely — a
 * sealed model reserves the flat ceiling, and every sealed catalogue row
 * prices `max_completion_cost === max_cost`, so no `max_tokens` moves it.
 *
 * The picker priced every row through the discounted path. On the model
 * behind the 2026-09-25 device log that is ~2 sats against a node that took
 * 307: a 50-sat wallet was told the tier was affordable, with a messages-left
 * count beside it, and was refused at send — while the SAME row's "needs 307
 * sats reserved" line, which reads `max_cost` directly, was right. One row,
 * two numbers, contradicting each other.
 *
 * The control matters as much as the case: an identically-priced PLAINTEXT
 * twin at the same balance must stay affordable, or this test would pass for
 * a picker that had simply become pessimistic about everything.
 */

import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { AiLineup, LineupEntry } from '@/shared/lib/routstr/lineup';

import { openModelPicker } from './helpers/modelPicker';

jest.mock('@/shared/lib/apiClient', () => ({ getAiLineup: jest.fn() }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: 0, profiles: [{ accountIndex: 0 }] }),
  },
}));
jest.mock('@/shared/lib/routstr/api', () => ({
  setRoutstrNodeBaseUrl: jest.fn(),
  ROUTSTR_MAX_COMPLETION_TOKENS: 2000,
  // The reserve mirror walks the request body character by character, exactly
  // as the node's gate does, so a stub that merely returns *an* object would
  // price a different request than the one this row leads to. This is the
  // real builder's shape, kept in step with `api.ts`.
  routstrChatRequestBody: ({
    model,
    messages,
    temperature,
    max_tokens,
  }: {
    model: string;
    messages: readonly unknown[];
    temperature?: number;
    max_tokens?: number;
  }) => ({
    model,
    messages,
    ...(temperature != null && { temperature }),
    ...(max_tokens != null && { max_tokens }),
    stream: true,
  }),
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/persist/secureVault', () => ({
  createSecureVault: () => ({ read: async () => null, write: async () => {} }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/http/requestSignal', () => ({ buildAbortSignal: () => undefined }));
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: entry,
    aiLog: entry,
    storeLog: entry,
    log: { ...entry, child: () => entry },
    useMountLog: () => {},
    applyFileLogging: jest.fn(),
    redactError: (error: unknown) => error,
  };
});

jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

/**
 * The row from the device log, to the sat.
 *
 * `completion × maxCompletionTokens` is how the node derives its answer
 * ceiling — 0.00119596 × 256000 = 306.17, which is `max_cost`, which the SDK
 * mints as 307. The discounted path prices 2000 answer tokens instead, ~2.4
 * sats: the ~130× understatement this test exists to prevent.
 */
const PRICING = {
  prompt: 0.0000006,
  completion: 0.00119596,
  request: 0,
  image: 0,
  max_cost: 306.17,
} as const;

const entry = (modelId: string, displayName: string): LineupEntry => ({
  modelId,
  displayName,
  contextLength: 128_000,
  created: 1_780_000_000,
  visionInput: false,
  satsPricing: { ...PRICING },
  maxCompletionTokens: 256_000,
});

/** A sealed model and its plaintext twin, priced identically. */
const LINEUP: AiLineup = {
  tinfoil: { auto: entry('tinfoil-gemma-3-27b', 'Gemma 3 27B'), pro: null, max: null },
  openai: { auto: entry('gemma-3-27b', 'Gemma 3 27B'), pro: null, max: null },
};

/** Less than the sealed reservation, comfortably more than the discounted one. */
const BALANCE_SATS = 50;

describe('the model picker prices a sealed row the way the node does', () => {
  beforeEach(() => {
    useRoutstrStore.setState({
      lineup: LINEUP,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      selectedTier: 'max',
    });
  });

  it('refuses a sealed tier the balance cannot reserve, and says the real figure', () => {
    useRoutstrStore.setState({ selectedProvider: 'tinfoil' });
    const row = openModelPicker(BALANCE_SATS).row('ai-model-tinfoil-auto');

    expect(row.disabled).toBe(true);
    // 307 × the 1.1 headroom buffer, less the 50 sats already held.
    expect(row.reason).toBe('Top up 288 more sats to use this tier');
    // And a bare tier label — never "Auto · ~N left" beside a tier the very
    // next send would be refused for.
    expect(row.title).toBe('Auto');
  });

  it('still offers the identically-priced plaintext twin at the same balance', () => {
    useRoutstrStore.setState({ selectedProvider: 'openai' });
    const picker = openModelPicker(BALANCE_SATS);

    expect(picker.row('ai-model-openai-auto').disabled).toBe(false);
    expect(picker.copy()).not.toContain('Top up');
  });
});

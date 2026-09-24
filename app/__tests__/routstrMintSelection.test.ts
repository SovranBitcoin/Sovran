/**
 * Which mint pays a Routstr request.
 *
 * A node redeems tokens from a published list of mints and refuses everything
 * else, so this is not the wallet's choice alone. Observed on device
 * (2026-09-24): the wallet's selected mint was Minibits, which the node
 * accepts, but the payment went out from `mint.sovran.money`, which it does
 * not — the SDK's own candidate order puts the largest balance first and the
 * caller's preference second. Every send failed, and the failure surfaced as
 * a bare "Failed to send message".
 */

const MINIBITS = 'https://mint.minibits.cash/Bitcoin';
const SOVRAN = 'https://mint.sovran.money';
const CUBA = 'https://mint.cubabitcoin.org';

// Jest hoists `jest.mock` above these, so the factories may only reach names
// beginning with `mock` — the one out-of-scope reference it allows.
let mockSelectedMint: string | undefined = MINIBITS;
let mockBalances: Record<string, number> = { [SOVRAN]: 9000, [MINIBITS]: 1200 };
let mockNodeMints: string[] | undefined;

// A profile that has already chosen a provider. Nothing is sent until one is
// chosen, and the store applies the choice on hydrate — so a test about paying
// has to start from a hydrated choice rather than poking module state, which
// hydration would then clear.
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (key: string) =>
      key.includes('routstr-store')
        ? JSON.stringify({ state: { userNodeBaseUrl: 'https://node.example' }, version: 1 })
        : null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: noop,
    aiLog: noop,
    storeLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

jest.mock('@/shared/lib/http/requestSignal', () => ({
  DEFAULT_TIMEOUT_MS: 10_000,
  buildAbortSignal: () => undefined,
}));

jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: 0 }) },
}));

jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ selectedMint: mockSelectedMint }) },
}));

jest.mock('@/shared/lib/routstr/sdk/walletAdapter', () => ({
  cocoWalletAdapter: {
    getBalances: async () => mockBalances,
    getMintUnits: () => ({}),
    getActiveMintUrl: () => null,
    sendToken: jest.fn(async () => 'cashuB-request-payment'),
    receiveToken: jest.fn(async () => ({ success: true, amount: 0, unit: 'sat' })),
  },
}));

jest.mock('@/shared/lib/routstr/providers', () => ({
  normalizeNodeUrl: (u: string) => u.replace(/\/+$/, '').replace(/\/v1$/, ''),
  fetchNodeInfo: async () => (mockNodeMints ? { mints: mockNodeMints } : null),
}));

import { getModels, sendMessage, setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';
import { resetRoutstrClient } from '@/shared/lib/routstr/sdk/client';

const wallet = (
  jest.requireMock('@/shared/lib/routstr/sdk/walletAdapter') as {
    cocoWalletAdapter: { sendToken: jest.Mock };
  }
).cocoWalletAdapter;

/** Fetch the catalog once so the SDK is seeded, then answer the completion. */
async function seedThenSend() {
  // Re-applied per call: each case resets the SDK client, and the store's
  // hydration is what normally installs this.
  setRoutstrNodeBaseUrl('https://node.example');
  // eslint-disable-next-line no-restricted-properties -- test stub
  global.fetch = jest.fn(async (url: string) =>
    String(url).includes('/models')
      ? new Response(JSON.stringify({ data: [{ id: 'm', enabled: true }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response('data: [DONE]\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
  ) as unknown as typeof fetch;
  await getModels();
  // `getModels` seeds in the background so the picker is not held up.
  await new Promise((resolve) => setImmediate(resolve));
  return sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' });
}

describe('paying mint selection', () => {
  beforeEach(() => {
    resetRoutstrClient();
    wallet.sendToken.mockClear();
    mockSelectedMint = MINIBITS;
    mockBalances = { [SOVRAN]: 9000, [MINIBITS]: 1200 };
    mockNodeMints = undefined;
  });

  it('pays from the selected mint when the node accepts it', async () => {
    mockNodeMints = [MINIBITS, CUBA];
    await seedThenSend();
    expect(wallet.sendToken).toHaveBeenCalledWith(MINIBITS, expect.any(Number));
  });

  it('pays from the largest accepted mint when the selected one is refused', async () => {
    // The wallet is pointed at a mint this node will not redeem. Paying from
    // it anyway is the bug; a refusal the user cannot act on is the symptom.
    mockSelectedMint = SOVRAN;
    mockBalances = { [SOVRAN]: 9000, [MINIBITS]: 1200, [CUBA]: 30 };
    mockNodeMints = [MINIBITS, CUBA];
    await seedThenSend();
    expect(wallet.sendToken).toHaveBeenCalledWith(MINIBITS, expect.any(Number));
  });

  it('matches an accepted mint across a trailing-slash difference', async () => {
    mockSelectedMint = SOVRAN;
    mockNodeMints = [`${MINIBITS}/`];
    await seedThenSend();
    // The node's spelling and the wallet's differ by one character; an exact
    // match would read as "you hold nothing this provider accepts".
    expect(wallet.sendToken).toHaveBeenCalledWith(MINIBITS, expect.any(Number));
  });

  it('refuses in words the user can act on when no mint is accepted', async () => {
    mockSelectedMint = SOVRAN;
    mockBalances = { [SOVRAN]: 9000 };
    mockNodeMints = [MINIBITS, CUBA];
    await expect(seedThenSend()).rejects.toMatchObject({
      error: { code: 'mint_not_accepted' },
    });
    expect(wallet.sendToken).not.toHaveBeenCalled();
  });

  it('uses the selected mint when the node publishes no list', async () => {
    mockNodeMints = undefined;
    await seedThenSend();
    expect(wallet.sendToken).toHaveBeenCalledWith(MINIBITS, expect.any(Number));
  });
});

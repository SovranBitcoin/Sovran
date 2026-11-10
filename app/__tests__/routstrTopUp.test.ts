/**
 * @jest-environment node
 *
 * Characterization of `executeRoutstrTopUp`, which pays a Cashu token into the
 * AI provider (Routstr) and records the credential and balance: what it asks
 * the node, which credential it keeps, what balance it saves, and what it
 * reports. The real orchestrator and Routstr store run; only the node API
 * (`checkBalance`, `topUpBalance`) and the store's storage are replaced.
 */

import { checkBalance, topUpBalance } from '@/shared/lib/routstr/api';
import { executeRoutstrTopUp } from '@/shared/lib/routstr/topUp';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/routstr/api', () => ({
  checkBalance: jest.fn(),
  topUpBalance: jest.fn(),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, pubkey: 'a'.repeat(64) }],
    }),
  },
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
jest.mock('@/shared/lib/persist/secureVault', () => ({
  createSecureVault: () => ({ read: async () => null, write: async () => {} }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  }),
}));
jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: noop,
    storeLog: noop,
    aiLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

const mockedCheck = jest.mocked(checkBalance);
const mockedTopUp = jest.mocked(topUpBalance);

const TOKEN = 'cashuBdummy-top-up-token';
const OLD_KEY = 'sk-existing';
const UPGRADED = 'sk-upgraded';

const state = () => useRoutstrStore.getState();

type Balance = Awaited<ReturnType<typeof checkBalance>>;
type TopUp = Awaited<ReturnType<typeof topUpBalance>>;

function balance(msats: number, api_key?: string): Balance {
  const response: Balance = { balance: msats, ...(api_key ? { api_key } : {}) };
  return response;
}

function credited(added_amount: number): TopUp {
  const response: TopUp = { added_amount };
  return response;
}

function saved(apiKey: string | null, msats: number | null) {
  useRoutstrStore.setState({ apiKey, balance: msats });
}

beforeEach(() => {
  mockedCheck.mockReset();
  mockedTopUp.mockReset();
  saved(null, null);
});

describe('with a credential already saved', () => {
  beforeEach(() => {
    saved(OLD_KEY, 1_000);
  });

  it('tops up that credential, re-reads the balance and saves it', async () => {
    mockedTopUp.mockResolvedValue(credited(5_000));
    mockedCheck.mockResolvedValue(balance(6_000));

    const result = await executeRoutstrTopUp(TOKEN);

    expect(mockedTopUp).toHaveBeenCalledWith({ apiKey: OLD_KEY, cashuToken: TOKEN });
    expect(mockedCheck).toHaveBeenCalledWith(OLD_KEY);
    expect(result).toEqual({ success: true, balance: 6_000, isNewWallet: false });
    expect(state()).toMatchObject({ apiKey: OLD_KEY, balance: 6_000 });
  });

  it.each([0, -1, Number.NaN])(
    'reports a top-up that credits %s as a failure and leaves the saved balance',
    async (added_amount) => {
      mockedTopUp.mockResolvedValue(credited(added_amount));

      const result = await executeRoutstrTopUp(TOKEN);

      expect(result.success).toBe(false);
      expect((result as { error: Error }).error.message).toBe(
        'Routstr accepted the token but credited nothing'
      );
      expect(mockedCheck).not.toHaveBeenCalled();
      expect(state()).toMatchObject({ apiKey: OLD_KEY, balance: 1_000 });
    }
  );

  it('reports a refused top-up as a failure and keeps the old credential', async () => {
    mockedTopUp.mockRejectedValue(new Error('token already spent'));

    const result = await executeRoutstrTopUp(TOKEN);

    expect(result).toEqual({ success: false, error: expect.any(Error) });
    expect(state()).toMatchObject({ apiKey: OLD_KEY, balance: 1_000 });
  });
});

describe('without a credential', () => {
  it('saves the token itself as the credential before asking for the balance', async () => {
    let keyWhenChecked: string | null = null;
    mockedCheck.mockImplementation(async () => {
      keyWhenChecked = state().apiKey;
      return balance(2_000);
    });

    const result = await executeRoutstrTopUp(TOKEN);

    // QUIRK: no wallet is created on the node; the token becomes the
    // credential directly, although the function's comment still describes
    // a create call with a 404 fallback.
    expect(mockedTopUp).not.toHaveBeenCalled();
    expect(keyWhenChecked).toBe(TOKEN);
    expect(mockedCheck).toHaveBeenCalledWith(TOKEN);
    expect(result).toEqual({ success: true, balance: 2_000, isNewWallet: true });
    expect(state()).toMatchObject({ apiKey: TOKEN, balance: 2_000 });
  });

  it('switches to a persistent key the node returns, with that key’s own balance', async () => {
    mockedCheck
      .mockResolvedValueOnce(balance(2_000, UPGRADED))
      .mockResolvedValueOnce(balance(1_999));

    const result = await executeRoutstrTopUp(TOKEN);

    expect(mockedCheck.mock.calls).toEqual([[TOKEN], [UPGRADED]]);
    expect(result).toEqual({ success: true, balance: 1_999, isNewWallet: true });
    expect(state()).toMatchObject({ apiKey: UPGRADED, balance: 1_999 });
  });

  it('keeps the working credential when the returned key cannot be verified', async () => {
    mockedCheck
      .mockResolvedValueOnce(balance(2_000, UPGRADED))
      .mockRejectedValueOnce(new Error('401'));

    const result = await executeRoutstrTopUp(TOKEN);

    expect(result).toEqual({ success: true, balance: 2_000, isNewWallet: true });
    expect(state()).toMatchObject({ apiKey: TOKEN, balance: 2_000 });
  });

  it('does not re-read when the node returns the same key', async () => {
    mockedCheck.mockResolvedValueOnce(balance(2_000, TOKEN));

    await executeRoutstrTopUp(TOKEN);

    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });

  it('keeps the token as the credential when the balance read fails, and reports failure', async () => {
    mockedCheck.mockRejectedValue(new Error('node down'));

    const result = await executeRoutstrTopUp(TOKEN);

    expect(result).toEqual({ success: false, error: expect.any(Error) });
    // Partial success: the token stays saved so the credit can be recovered.
    expect(state()).toMatchObject({ apiKey: TOKEN, balance: null });
  });
});

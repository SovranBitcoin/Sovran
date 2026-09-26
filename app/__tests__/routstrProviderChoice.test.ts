/**
 * Nothing is paid to a provider the user did not choose.
 *
 * Sovran used to ship a default node and let nagg move it, which made this app
 * the arbiter of who gets paid for AI — and sent the user's ecash there
 * without them ever naming a recipient. There is no default now, and no
 * recommendation: every path that would reach a node refuses until a provider
 * is picked, and says so in words the user can act on.
 */

import { describeError } from '@/shared/lib/errors';
import { getModels, sendMessage, setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';

jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
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
  useMintStore: { getState: () => ({ selectedMint: 'https://mint.example' }) },
}));

describe('no provider is chosen by default', () => {
  let attempted: jest.Mock;

  beforeEach(() => {
    setRoutstrNodeBaseUrl(null);
    attempted = jest.fn(async () => {
      throw new Error('a request left the app with no provider chosen');
    });
    // eslint-disable-next-line no-restricted-properties -- test stub; nothing should reach it
    global.fetch = attempted as unknown as typeof fetch;
  });

  it('refuses to send, without reaching the network', async () => {
    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' })
    ).rejects.toMatchObject({ error: { code: 'no_provider' } });
    expect(attempted).not.toHaveBeenCalled();
  });

  it('refuses to fetch a catalog — a menu of things you cannot buy', async () => {
    await expect(getModels()).rejects.toMatchObject({ error: { code: 'no_provider' } });
    expect(attempted).not.toHaveBeenCalled();
  });

  it('tells the user what to do about it', async () => {
    const refusal = await getModels().catch((error: unknown) => error);
    expect(describeError(refusal, 'routstr').id).toBe('routstr.no_provider');
  });

  it('sends once a provider is chosen', async () => {
    setRoutstrNodeBaseUrl('https://node.example');
    // Reaching the stub is the proof: the guard is gone and the request left.
    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' })
    ).rejects.not.toMatchObject({ error: { code: 'no_provider' } });
  });
});

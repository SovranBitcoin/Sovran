import NDK from '@nostr-dev-kit/ndk-mobile';
import { verifyNip05 } from 'wallet';
import { safeFetch } from 'wallet/safeFetch';
import { loadNpcIdentity } from '@/shared/lib/cashu/npcIdentity';

jest.mock('wallet', () => ({ verifyNip05: jest.fn() }));
jest.mock('wallet/safeFetch', () => ({
  ...jest.requireActual('wallet/safeFetch'),
  safeFetch: jest.fn(),
}));
jest.mock('@/shared/lib/cashu/npc', () => ({
  NPC_BASE_URL: 'https://npub.cash',
  NPC_DOMAIN: 'npub.cash',
}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  __esModule: true,
  default: class {},
  NDKEvent: class {
    pubkey: string;
    raw: Record<string, unknown>;
    constructor(_ndk: unknown, template: { pubkey: string }) {
      this.pubkey = template.pubkey;
      this.raw = template;
    }
    async sign() {}
    rawEvent() {
      return { ...this.raw, id: 'b'.repeat(64), sig: 'c'.repeat(128) };
    }
  },
}));
const pubkey = 'a'.repeat(64);
const makeNdk = () => Object.assign(new NDK(), { signer: { user: async () => ({ pubkey }) } });
const response = (user: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({ error: false, data: { user } }),
});
beforeEach(() => {
  jest.clearAllMocks();
});

it('does not invent a NIP-05 identity from an account with no custom username', async () => {
  jest.mocked(safeFetch).mockResolvedValue(response({ pubkey }) as Response);
  expect(await loadNpcIdentity(makeNdk(), pubkey, new AbortController().signal)).toEqual({
    status: 'no-username',
  });
  expect(verifyNip05).not.toHaveBeenCalled();
});

it('requires the purchased name to independently map to the selected key', async () => {
  jest.mocked(safeFetch).mockResolvedValue(response({ pubkey, name: 'alice' }) as Response);
  jest
    .mocked(verifyNip05)
    .mockResolvedValueOnce({ status: 'mismatch', identifier: 'alice@npub.cash' });
  expect(await loadNpcIdentity(makeNdk(), pubkey, new AbortController().signal)).toEqual({
    status: 'unverified',
  });
  jest
    .mocked(verifyNip05)
    .mockResolvedValueOnce({ status: 'verified', identifier: 'alice@npub.cash' });
  expect(await loadNpcIdentity(makeNdk(), pubkey, new AbortController().signal)).toEqual({
    status: 'verified',
    identifier: 'alice@npub.cash',
  });
  expect(verifyNip05).toHaveBeenLastCalledWith(
    'alice@npub.cash',
    pubkey,
    expect.objectContaining({ signal: expect.anything() })
  );
});

it('rejects account data for a different key and does not use its username', async () => {
  jest
    .mocked(safeFetch)
    .mockResolvedValue(response({ pubkey: 'b'.repeat(64), name: 'alice' }) as Response);
  expect(await loadNpcIdentity(makeNdk(), pubkey, new AbortController().signal)).toEqual({
    status: 'unavailable',
  });
  expect(verifyNip05).not.toHaveBeenCalled();
});

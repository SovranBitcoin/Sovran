import { signVertexRequest } from '@/shared/lib/nostr/vertex/signVertexRequest';
import { fakeClient } from './helpers/fakeNostrClient';

let mockMode = false;
const mockSign = jest.fn();
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ mockMode }) },
}));
const unsigned = { kind: 5312, tags: [], content: '', created_at: 123 };
const signer = { pubkey: 'pubkey', sign: (template: unknown) => mockSign(template) };
const client = fakeClient({ signer });
beforeEach(() => {
  mockMode = false;
  mockSign.mockReset().mockImplementation((template: object) => ({
    ...template,
    id: 'id',
    sig: 'sig',
    pubkey: 'pubkey',
  }));
  delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
});

it('uses the supplied active signer and returns the signed public event', async () => {
  const result = await signVertexRequest(unsigned, client);
  expect(result._unsafeUnwrap()).toMatchObject({ ...unsigned, sig: 'sig', id: 'id' });
  expect(mockSign).toHaveBeenCalledWith(unsigned);
});
it('returns typed no-signer and signing-failure errors', async () => {
  expect((await signVertexRequest(unsigned))._unsafeUnwrapErr()).toEqual({ type: 'no-signer' });
  mockSign.mockImplementation(() => {
    throw new Error('private upstream detail');
  });
  expect((await signVertexRequest(unsigned, client))._unsafeUnwrapErr()).toEqual({
    type: 'sign-failed',
  });
});
it.each(['mock', 'automation'])('never signs during %s', async (mode) => {
  mockMode = mode === 'mock';
  if (mode === 'automation') process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
  expect((await signVertexRequest(unsigned, client)).isErr()).toBe(true);
  expect(mockSign).not.toHaveBeenCalled();
});

import type NDK from '@nostr-dev-kit/ndk-mobile';
import { signVertexRequest } from '@/shared/lib/nostr/vertex/signVertexRequest';

let mockMode = false;
const mockSign = jest.fn();
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    NDKEvent: class {
      kind = 0;
      tags: string[][] = [];
      content = '';
      created_at = 0;
      sign(signer: unknown) {
        return mockSign(signer);
      }
      rawEvent() {
        return {
          kind: this.kind,
          tags: this.tags,
          content: this.content,
          created_at: this.created_at,
          id: 'id',
          sig: 'sig',
          pubkey: 'pubkey',
        };
      }
    },
  }),
  { virtual: true }
);
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ mockMode }) },
}));
const unsigned = { kind: 5312, tags: [], content: '', created_at: 123 };
const ndk = { signer: {} } as unknown as NDK;
beforeEach(() => {
  mockMode = false;
  mockSign.mockReset().mockResolvedValue('sig');
  delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
});

it('uses the supplied active NDK signer and returns the signed public event', async () => {
  const result = await signVertexRequest(unsigned, ndk);
  expect(result._unsafeUnwrap()).toMatchObject({ ...unsigned, sig: 'sig', id: 'id' });
  expect(mockSign).toHaveBeenCalledWith(ndk.signer);
});
it('returns typed no-signer and signing-failure errors', async () => {
  expect((await signVertexRequest(unsigned))._unsafeUnwrapErr()).toEqual({ type: 'no-signer' });
  mockSign.mockRejectedValue(new Error('private upstream detail'));
  expect((await signVertexRequest(unsigned, ndk))._unsafeUnwrapErr()).toEqual({
    type: 'sign-failed',
  });
});
it.each(['mock', 'automation'])('never signs during %s', async (mode) => {
  mockMode = mode === 'mock';
  if (mode === 'automation') process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
  expect((await signVertexRequest(unsigned, ndk)).isErr()).toBe(true);
  expect(mockSign).not.toHaveBeenCalled();
});

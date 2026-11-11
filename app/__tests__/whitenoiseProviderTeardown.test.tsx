/**
 * What the White Noise provider does with its client when it goes away: a
 * plain unmount drops the listeners and zeroes the signer's copy of the key at
 * once; an in-process profile switch drains the invitation reader and the
 * client first, then releases them. Either way the account holder and the
 * switch service are unregistered.
 *
 * The client, the invitation reader and the account registry are replaced at
 * the provider's boundary, so each teardown step is observed directly.
 */
import { act, render } from '@testing-library/react-native';

import { WhitenoiseProvider } from '@/features/whitenoise/WhitenoiseProvider';

let mockSwitching = false;
const mockClient = { removeAllListeners: jest.fn(), signer: {} };
const mockClientHandle = {
  client: mockClient,
  disposeSigner: jest.fn(),
  shutdown: jest.fn(async () => undefined),
  release: jest.fn(),
};
const mockReaderListeners = jest.fn();
const mockReader = { stop: jest.fn(async () => undefined), release: jest.fn() };
const mockUnregisterHolder = jest.fn();
const mockUnregisterService = jest.fn();
const mockSteps: string[] = [];

jest.mock('@/features/whitenoise/client', () => ({
  createWhitenoiseClient: () => mockClientHandle,
}));
jest.mock('@internet-privacy/marmot-ts', () => ({
  InviteReader: class {
    removeAllListeners = () => mockReaderListeners();
  },
}));
jest.mock('@/features/whitenoise/storage/inviteStore', () => ({
  createWhitenoiseInviteStore: () => ({}),
}));
jest.mock('@/shared/lib/profile/profileSwitchResource', () => ({
  profileSwitchResource: (value: unknown) => ({ value, ...mockReader }),
}));
jest.mock('@/features/whitenoise/hooks/useWhitenoiseInbox', () => ({
  useWhitenoiseInbox: () => undefined,
}));
jest.mock('@/shared/lib/account/accountRegistry', () => ({
  registerAccountScoped: () => mockUnregisterHolder,
  registerProfileSwitchService: () => mockUnregisterService,
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ inProcessProfileSwitch: mockSwitching }) },
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { privateKey: new Uint8Array(32).fill(1) } }),
}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: {} }) }));
jest.mock('@/shared/ndk', () => ({ relays: ['wss://relay.example'] }));
jest.mock('@/shared/lib/logger', () => ({
  wnLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const { wnLog: mockLog } = jest.requireMock<{ wnLog: { warn: jest.Mock } }>('@/shared/lib/logger');

function mount() {
  return render(
    <WhitenoiseProvider accountIndex={0}>
      <></>
    </WhitenoiseProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSwitching = false;
  mockSteps.length = 0;
  for (const [name, fn] of [
    ['client listeners', mockClient.removeAllListeners],
    ['reader listeners', mockReaderListeners],
    ['dispose signer', mockClientHandle.disposeSigner],
    ['client shutdown', mockClientHandle.shutdown],
    ['client release', mockClientHandle.release],
    ['reader stop', mockReader.stop],
    ['reader release', mockReader.release],
    ['unregister holder', mockUnregisterHolder],
    ['unregister service', mockUnregisterService],
  ] as const) {
    (fn as jest.Mock).mockImplementation(() => {
      mockSteps.push(name);
    });
  }
});

it('a plain unmount unregisters, drops the listeners and zeroes the signer at once', () => {
  mount().unmount();

  expect(mockSteps).toEqual([
    'unregister service',
    'unregister holder',
    'client listeners',
    'reader listeners',
    'dispose signer',
  ]);
});

it('a plain unmount whose listener removal throws still finishes, leaving the signer as it was', () => {
  mockClient.removeAllListeners.mockImplementation(() => {
    throw new Error('emitter broken');
  });

  expect(() => mount().unmount()).not.toThrow();
  expect(mockSteps).toEqual(['unregister service', 'unregister holder']);
  expect(mockLog.warn).toHaveBeenCalledWith('whitenoise.client.dispose_failed', {
    error: 'emitter broken',
  });
});

it('an in-process switch drains the reader and the client, then releases them', async () => {
  const view = mount();
  mockSwitching = true;

  await act(async () => {
    view.unmount();
  });

  expect(mockSteps).toEqual([
    'unregister service',
    'reader stop',
    'reader listeners',
    'client shutdown',
    'reader release',
    'client release',
    'unregister holder',
  ]);
});

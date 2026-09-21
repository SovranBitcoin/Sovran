import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { addBLEPrivateMessageListener, beginBLEBackgroundTask } from 'bitchat-module';

import { useNutDropAutoRedeem } from '@/features/nearPay/hooks/useNutDropAutoRedeem';
import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';

jest.mock('bitchat-module', () => ({
  addBLEPrivateMessageListener: jest.fn(() => ({ remove: jest.fn() })),
  beginBLEBackgroundTask: jest.fn(),
  endBLEBackgroundTask: jest.fn(),
}));
jest.mock('wallet', () => ({
  classifyMeshToken: () => ({
    classification: 'bearer',
    mintUrl: 'https://mint.example',
    amount: 1,
    unit: 'sat',
  }),
  meshTokenDedupeKey: () => 'token-hash-fixture',
}));
jest.mock('@/features/nearPay/lib/nutDropAutoRedeem', () => ({
  drainNutDropRedeemQueue: jest.fn(),
}));
jest.mock('@/shared/lib/protocolIds', () => ({ cashuP2pkPubkeyFromNostrHex: () => '02ab' }));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
  mintUrlLogFields: () => ({}),
  redactError: (e: unknown) => e,
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'ab' } }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/shared/stores/profile/nutDropRedeemQueueStore', () => ({
  useNutDropRedeemQueueStore: { getState: () => ({ enqueue: () => true }) },
}));
jest.mock('@/shared/ui/composed/chat/extractCashuToken', () => ({
  extractCashuToken: () => 'cashuBfixture',
}));

const drain = jest.mocked(drainNutDropRedeemQueue);
const begin = jest.mocked(beginBLEBackgroundTask);
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('useNutDropAutoRedeem fire-and-forget drains', () => {
  const unhandled = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    process.on('unhandledRejection', unhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', unhandled);
    jest.restoreAllMocks();
  });

  it('absorbs a rejected mount drain instead of leaving it unhandled', async () => {
    drain.mockRejectedValue(new Error('mint unreachable'));
    renderHook(() => useNutDropAutoRedeem());
    await flush();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('still drains a backgrounded message when the native budget cannot be taken', async () => {
    drain.mockResolvedValue(undefined);
    begin.mockRejectedValue(new Error('native assertion failed'));
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('background');
    renderHook(() => useNutDropAutoRedeem());
    await flush();
    drain.mockClear();
    const onMessage = jest.mocked(addBLEPrivateMessageListener).mock.calls[0][0];
    onMessage({
      id: 'message',
      peerID: 'peer',
      sender: 'sender',
      content: 'cashuBfixture',
      timestamp: 0,
      isOwn: false,
    });
    await flush();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from '@testing-library/react-native';
import { useAiSend } from '@/features/ai/hooks/useAiSend';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { emptyLineup, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { sendMessage, checkBalance } from '@/shared/lib/routstr/api';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { staticPopup } from '@/shared/lib/popup';

jest.mock('@/shared/lib/routstr/api', () => ({
  ...jest.requireActual('@/shared/lib/routstr/api'),
  sendMessage: jest.fn(),
  checkBalance: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/refreshLineup', () => ({ refreshRoutstrLineup: jest.fn() }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: 0 }) },
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: { getState: jest.fn() },
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({ useMintStore: { getState: jest.fn() } }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: null }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { navigateHaptic: jest.fn() },
}));
jest.mock('@/features/ai/lib/attachments', () => ({ encodeChatImage: jest.fn() }));
jest.mock('@/shared/lib/logger', () => {
  const log = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    startSpan: () => ({ end: jest.fn() }),
  };
  return { apiLog: log, aiLog: log, storeLog: log, log, applyFileLogging: jest.fn() };
});

const entry = (modelId: string): LineupEntry => ({
  modelId,
  displayName: modelId,
  contextLength: 100000,
  created: 1,
  visionInput: true,
  satsPricing: { prompt: 0, completion: 0.001, request: 0, image: 0, max_cost: 1 },
});
const failure = (status: number, message: string) => ({
  status,
  error: { message, type: status === 0 ? 'network_error' : 'server_error' },
});
const success = () => ({
  stream: (async function* () {
    yield { choices: [{ delta: { content: 'reply' } }] };
  })(),
});
const sendMock = jest.mocked(sendMessage);
const refreshMock = jest.mocked(refreshRoutstrLineup);

async function send() {
  const hook = renderHook(useAiSend);
  await act(async () => {
    await hook.result.current.send('hello');
  });
  return hook;
}

describe('AI send lineup recovery', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await useRoutstrStore.persist.rehydrate();
    const lineup = emptyLineup();
    lineup.openai.auto = entry('old-auto');
    lineup.openai.pro = entry('old-pro');
    lineup.claude.auto = entry('other-auto');
    useRoutstrStore.setState({
      apiKey: 'cashuA-original',
      authMode: 'bearer',
      balance: 100000,
      lineup,
      lastKnownLineup: null,
      nodeBaseUrl: 'https://old.example',
      selectedProvider: 'openai',
      selectedTier: 'pro',
      conversationHistory: [],
      sessions: [],
      currentSessionId: null,
      isAnonymousMode: true,
    });
    jest.mocked(checkBalance).mockResolvedValue({ balance: 90000 });
    refreshMock.mockResolvedValue(false);
  });

  it.each([404, 503, 0])(
    'refreshes after node failure %s and retries once on the changed node with its Auto model and current token',
    async (status) => {
      sendMock
        .mockRejectedValueOnce(failure(status, 'Unavailable'))
        .mockResolvedValueOnce(success());
      refreshMock.mockImplementationOnce(async () => {
        const lineup = emptyLineup();
        lineup.openai.auto = entry('new-auto');
        useRoutstrStore.setState({
          lineup,
          nodeBaseUrl: 'https://new.example',
          apiKey: 'cashuB-change',
        });
        return true;
      });
      await send();
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[1][0]).toBe('cashuB-change');
      expect(sendMock.mock.calls[1][2]).toMatchObject({ model: 'new-auto', max_tokens: 4096 });
      expect(refreshMock).toHaveBeenCalledWith('failure');
      expect(staticPopup).not.toHaveBeenCalled();
      expect(jest.mocked(checkBalance).mock.calls[0][0]).toBe('cashuB-change');
    }
  );

  it('retries the refreshed Auto model when a model is retired on the same node', async () => {
    sendMock.mockRejectedValueOnce(failure(400, 'Unknown model')).mockResolvedValueOnce(success());
    refreshMock.mockImplementationOnce(async () => {
      const lineup = emptyLineup();
      lineup.openai.auto = entry('replacement');
      useRoutstrStore.setState({ lineup });
      return true;
    });
    await send();
    expect(sendMock.mock.calls[1][2].model).toBe('replacement');
  });

  it.each([401, 402, 429])(
    'never retries or refreshes auth/payment/rate failures (%s)',
    async (status) => {
      sendMock.mockRejectedValueOnce(failure(status, 'Rejected'));
      await send();
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(refreshMock).not.toHaveBeenCalled();
    }
  );

  it('stops on an unchanged failed node and removes the assistant placeholder', async () => {
    const error = failure(404, 'Not found');
    sendMock.mockRejectedValueOnce(error);
    await send();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(staticPopup).toHaveBeenCalledWith('send-message-failed', {
      failure: { service: 'routstr', error },
    });
    expect(useRoutstrStore.getState().conversationHistory).toEqual([
      expect.objectContaining({ role: 'user', pending: false }),
    ]);
  });

  it('does not retry a second failure after repointing', async () => {
    sendMock.mockRejectedValue(failure(503, 'Unavailable'));
    refreshMock.mockImplementation(async () => {
      const lineup = emptyLineup();
      lineup.openai.auto = entry('new-auto');
      useRoutstrStore.setState({ lineup, nodeBaseUrl: 'https://new.example' });
      return true;
    });
    await send();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('never retries after a stream has started', async () => {
    sendMock.mockResolvedValueOnce({
      stream: (async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] };
        throw new Error('disconnected');
      })(),
    });
    await send();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

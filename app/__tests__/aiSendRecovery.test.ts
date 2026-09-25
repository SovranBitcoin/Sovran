import { act, renderHook } from '@testing-library/react-native';
import { useAiSend } from '@/features/ai/hooks/useAiSend';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { emptyLineup, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { sendMessage, checkBalance, ROUTSTR_MAX_COMPLETION_TOKENS } from '@/shared/lib/routstr/api';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { staticPopup } from '@/shared/lib/popup';
import { confirmSpend } from '@/features/ai/lib/spendConfirm';
import { getTurnError, resetTurnErrors } from '@/features/ai/lib/turnErrors';
import { chatErrorActions } from '@/features/ai/lib/chatErrorActions';
import { ERROR_COPY } from '@/shared/lib/errors/catalog';

jest.mock('@/features/ai/lib/spendConfirm', () => ({ confirmSpend: jest.fn() }));

jest.mock('@/shared/lib/routstr/api', () => ({
  ...jest.requireActual('@/shared/lib/routstr/api'),
  sendMessage: jest.fn(),
  checkBalance: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/refreshLineup', () => ({ refreshRoutstrLineup: jest.fn() }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: 0 }) },
}));
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
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: { getState: jest.fn() },
}));
jest.mock('@/shared/stores/profile/mintStore', () => {
  const useMintStore = Object.assign(
    (selector: (s: { selectedMint: string }) => unknown) =>
      selector({ selectedMint: 'https://mint.example' }),
    { getState: () => ({ selectedMint: 'https://mint.example' }) }
  );
  return { useMintStore };
});
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

jest.mock('@cashu/coco-react', () => ({
  // The gate prices against the wallet now; a funded mint keeps the
  // affordability snapshot realistic without booting a wallet.
  useBalanceContext: () => ({
    balances: {
      byMint: { 'https://mint.example': { total: 100_000, spendable: 100_000, unit: 'sat' } },
    },
  }),
}));

const entry = (modelId: string, upstreamId?: string): LineupEntry => ({
  modelId,
  ...(upstreamId != null ? { upstreamId } : {}),
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
/** A 402 routstr raised about this key's own balance — carries the markers
 *  `isWalletBalanceError` looks for. Distinct from a 402 the node forwarded
 *  verbatim from the AI provider, which has none of them. */
const walletBalanceFailure = () => ({
  status: 402,
  error: {
    message: 'Insufficient balance: 85577 mSats required. 216 available.',
    type: 'insufficient_quota',
    code: 'insufficient_balance',
    details: { required: 85577, available: 216 },
  },
});
const success = (costSats = 3) => ({
  cost: Promise.resolve(costSats),
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
  it('does not spend when the selected model changes during cost confirmation', async () => {
    useRoutstrStore.setState({ confirmSpend: true });
    jest.mocked(confirmSpend).mockImplementationOnce(async () => {
      useRoutstrStore.setState({ selectedProvider: 'claude' });
      return true;
    });
    const hook = await send();
    expect(sendMock).not.toHaveBeenCalled();
    expect(staticPopup).toHaveBeenCalledWith('ai-payment-options-changed');
    hook.unmount();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    resetTurnErrors();
    await useRoutstrStore.persist.rehydrate();
    const lineup = emptyLineup();
    lineup.openai.auto = entry('old-auto');
    lineup.openai.pro = entry('old-pro');
    lineup.claude.auto = entry('other-auto');
    useRoutstrStore.setState({
      apiKey: 'cashuA-original',
      authMode: 'bearer',
      // These tests are about recovery, not the spend prompt; the prompt has
      // its own suite.
      confirmSpend: false,
      balance: 100000,
      lineup,
      lastKnownLineup: null,
      nodeBaseUrl: 'https://old.example',
      // A provider the user picked. Nothing is sent until one is, and these
      // tests are about what happens after the send leaves.
      userNodeBaseUrl: 'https://old.example',
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
    'refreshes after node failure %s and retries once on the changed node with its Auto model',
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
      // There is no credential to carry across the repoint any more: the retry
      // mints its own payment from the wallet, which is what makes a node
      // change cost the user nothing.
      expect(sendMock.mock.calls[1][1]).toMatchObject({
        model: 'new-auto',
        max_tokens: ROUTSTR_MAX_COMPLETION_TOKENS,
      });
      expect(refreshMock).toHaveBeenCalledWith('failure');
      expect(staticPopup).not.toHaveBeenCalled();
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
    expect(sendMock.mock.calls[1][1].model).toBe('replacement');
  });

  it.each([401, 429])('never retries or refreshes auth/rate failures (%s)', async (status) => {
    sendMock.mockRejectedValueOnce(failure(status, 'Rejected'));
    await send();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('never retries or refreshes a wallet 402 — more attempts cannot fund it', async () => {
    sendMock.mockRejectedValueOnce(walletBalanceFailure());
    await send();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('advances to the next candidate when the upstream declines with a bare 402', async () => {
    // The node forwards the AI provider's own error body under the provider's
    // status, so this 402 says nothing about the node or the user's credit.
    // The next candidate usually sits behind a different upstream.
    sendMock
      .mockRejectedValueOnce(failure(402, 'Payment Required'))
      .mockResolvedValueOnce(success());
    await send();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][1].model).not.toBe(sendMock.mock.calls[0][1].model);
    // The node is reachable and the catalog is current — nothing to refresh.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('skips the rest of the upstream that just declined', async () => {
    // The chain is old-pro, old-auto, other-auto. The first two sit behind one
    // upstream account; a 402 from it means every model behind it refuses
    // identically, so the walk must jump straight to the other upstream rather
    // than pay to be refused again.
    const lineup = emptyLineup();
    lineup.openai.pro = entry('old-pro', 'openrouter');
    lineup.openai.auto = entry('old-auto', 'openrouter');
    lineup.claude.auto = entry('other-auto', 'tinfoil');
    useRoutstrStore.setState({ lineup });

    sendMock
      .mockRejectedValueOnce(failure(402, 'Payment Required'))
      .mockResolvedValueOnce(success());
    await send();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][1].model).toBe('old-pro');
    expect(sendMock.mock.calls[1][1].model).toBe('other-auto');
  });

  it('does not narrow the walk when the node reports no upstreams', async () => {
    // Older nodes omit `upstream_provider_id`; the walk must then behave
    // exactly as it did before, one candidate at a time.
    sendMock
      .mockRejectedValueOnce(failure(402, 'Payment Required'))
      .mockResolvedValueOnce(success());
    await send();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][1].model).toBe('old-auto');
  });

  it('stops declining after the attempt cap rather than fanning out the lineup', async () => {
    sendMock.mockRejectedValue(failure(402, 'Payment Required'));
    await send();
    expect(sendMock).toHaveBeenCalledTimes(3);
    // Once the walk is exhausted, re-ask nagg: a 402 is not a node failure, so
    // nothing else would, and a node with a dead upstream serves a healthy
    // catalog indefinitely.
    expect(refreshMock).toHaveBeenCalledWith('failure');
  });

  it('stops on an unchanged failed node and leaves the failure in the conversation', async () => {
    const error = failure(404, 'Not found');
    sendMock.mockRejectedValueOnce(error);
    await send();
    expect(sendMock).toHaveBeenCalledTimes(1);
    // No toast. The turn it failed stays where it was, and carries the reason
    // and its recovery — the assistant bubble renders `AiTurnErrorPill` for it.
    expect(staticPopup).not.toHaveBeenCalled();
    const history = useRoutstrStore.getState().conversationHistory;
    expect(history).toEqual([
      expect.objectContaining({ role: 'user', pending: false }),
      expect.objectContaining({ role: 'assistant', content: '' }),
    ]);
    const assistant = history[1];
    expect(getTurnError(assistant.id)).toEqual({
      id: 'routstr.not_found',
      text: ERROR_COPY['routstr.not_found'],
    });
    expect(chatErrorActions('routstr.not_found')).toContain('retry');
  });

  it('keeps an aborted turn out of the conversation — it did not fail', async () => {
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    sendMock.mockRejectedValueOnce(abort);
    await send();
    expect(useRoutstrStore.getState().conversationHistory).toEqual([
      expect.objectContaining({ role: 'user', pending: false }),
    ]);
  });

  it('carries the exact shortfall on a wallet 402 rather than a bare top-up prompt', async () => {
    sendMock.mockRejectedValueOnce(walletBalanceFailure());
    await send();
    const history = useRoutstrStore.getState().conversationHistory;
    const recorded = getTurnError(history[1].id);
    expect(recorded?.id).toBe('routstr.balance');
    // Our own arithmetic over the 402's structured details — never its prose.
    expect(recorded?.detail).toContain('Add at least 86 sats');
    expect(recorded?.detail).not.toContain('Insufficient balance: 85577 mSats');
    expect(chatErrorActions('routstr.balance')).toEqual(['top-up', 'change-model']);
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
      cost: Promise.resolve(3),
      stream: (async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] };
        throw new Error('disconnected');
      })(),
    });
    await send();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  /**
   * The encryption promise, at the one place it is kept or broken.
   *
   * `@routstr/sdk` seals a request on `modelId.startsWith('tinfoil-')`, so
   * every one of these cases asks the same question of the wire: which model
   * ids actually went out. The candidate walk used to answer a sealed
   * selection with an OpenAI model whenever the sealed one refused, was
   * retired, or simply cost more than the wallet held — no toast, no pill,
   * nothing in the conversation to say the prompt had been read in the clear.
   */
  describe('an encrypted selection', () => {
    const sentModels = () => sendMock.mock.calls.map((call) => call[1].model);

    beforeEach(() => {
      const lineup = emptyLineup();
      lineup.tinfoil = {
        auto: entry('tinfoil-glm-5-3'),
        pro: entry('tinfoil-qwen3-coder'),
        max: entry('tinfoil-deepseek-r1'),
      };
      // The plaintext ladder the old walk fell onto, still present and still
      // cheaper — which is exactly why it kept winning.
      lineup.openai.auto = entry('gpt-5.4-nano');
      lineup.openai.pro = entry('gpt-5.4-mini');
      lineup.claude.auto = entry('claude-haiku-4.5');
      useRoutstrStore.setState({ lineup, selectedProvider: 'tinfoil', selectedTier: 'pro' });
    });

    it('walks only encrypted models when an upstream declines with a bare 402', async () => {
      sendMock
        .mockRejectedValueOnce(failure(402, 'Payment Required'))
        .mockResolvedValueOnce(success());
      await send();
      expect(sentModels()).toEqual(['tinfoil-qwen3-coder', 'tinfoil-glm-5-3']);
    });

    it('walks only encrypted models when the chosen one is retired', async () => {
      sendMock
        .mockRejectedValueOnce(failure(400, 'Unknown model tinfoil-qwen3-coder'))
        .mockResolvedValueOnce(success());
      await send();
      expect(sentModels()).toEqual(['tinfoil-qwen3-coder', 'tinfoil-glm-5-3']);
    });

    it('gives up rather than retry a repoint onto the new node\u2019s plaintext Auto model', async () => {
      sendMock.mockRejectedValue(failure(503, 'Unavailable'));
      refreshMock.mockImplementationOnce(async () => {
        // The node nagg repoints us to serves no enclave at all.
        const lineup = emptyLineup();
        lineup.openai.auto = entry('new-auto');
        useRoutstrStore.setState({ lineup, nodeBaseUrl: 'https://new.example' });
        return true;
      });
      await send();
      // One attempt, and it was the sealed one. The recovery retry is the
      // subtlest crossing of the boundary: it resolves against a lineup that
      // has just been replaced wholesale.
      expect(sentModels()).toEqual(['tinfoil-qwen3-coder']);
    });

    it('refuses the send with an honest reason when the node serves nothing encrypted', async () => {
      const lineup = emptyLineup();
      lineup.openai.auto = entry('gpt-5.4-nano');
      lineup.openai.pro = entry('gpt-5.4-mini');
      useRoutstrStore.setState({ lineup });

      await send();

      expect(sendMock).not.toHaveBeenCalled();
      const history = useRoutstrStore.getState().conversationHistory;
      const recorded = getTurnError(history[1].id);
      // NOT `catalog_unavailable`: the catalogue landed, and telling the user
      // to check their connection would send them after the wrong thing.
      expect(recorded).toEqual({
        id: 'routstr.e2ee_unavailable',
        text: ERROR_COPY['routstr.e2ee_unavailable'],
      });
      expect(chatErrorActions('routstr.e2ee_unavailable')).toEqual([
        'change-provider',
        'change-model',
      ]);
    });

    it('asks for funds instead of answering an unaffordable sealed pick in the clear', async () => {
      const dear: LineupEntry = {
        ...entry('tinfoil-deepseek-r1'),
        satsPricing: { prompt: 0, completion: 0, request: 500_000, image: 0, max_cost: 500_000 },
      };
      const lineup = emptyLineup();
      lineup.tinfoil = { auto: dear, pro: dear, max: dear };
      // Affordable, plaintext, and one step down the old chain.
      lineup.openai.pro = entry('gpt-5.4-mini');
      useRoutstrStore.setState({ lineup });

      await send();

      // "Cannot afford the encrypted model" is a wallet problem with a wallet
      // answer. It was never a reason to change who reads the prompt.
      expect(sendMock).not.toHaveBeenCalled();
    });
  });
});

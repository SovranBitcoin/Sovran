/**
 * An AI request is paid for only while it still belongs where it was asked.
 *
 * A send or regenerate checks its account, conversation and screen after each
 * wait while it gets ready. After it hands the request to `sendMessage`, the
 * request still waits on choosing a paying mint and building the payment
 * client, and a refused candidate leads to another request. A conversation
 * switched in any of those waits must stop the request before its token is
 * minted and dispatched, and the question waits in its own conversation to be
 * asked again.
 *
 * The last group covers what is checked before any of that: a regenerate and
 * the error pill's Retry pass the same provider, mint and funds checks and the
 * same spend sheet as a send.
 *
 * The real `useAiSend`, `sendMessage`, Routstr store and turns run. Replaced:
 * the payment client (`getRoutstrClient`; its request asks `canDispatch` the
 * way the client's `sendToken` does before it mints and before it hands the
 * token over, then records the dispatch in `mockRoute`), the wallet balances
 * the paying mint is chosen from, storage, the logger and the screen glue the
 * harness in `aiConversationBranchStream.test.tsx` also replaces.
 */
import { act, renderHook } from '@testing-library/react-native';
import { ProviderError } from '@routstr/sdk/browser';

import { useAiSend } from '@/features/ai/hooks/useAiSend';
import { getTurn, readAnswer, resetTurns } from '@/features/ai/lib/turns';
import { resetModelAvailability } from '@/features/ai/lib/modelAvailability';
import { setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';
import { emptyLineup, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { confirmSpend } from '@/features/ai/lib/spendConfirm';
import { staticPopup } from '@/shared/lib/popup';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

const mockRoute = jest.fn<Promise<Response>, [{ modelId?: string }]>();
let mockClientGate: Promise<void> = Promise.resolve();
let mockBalancesGate: Promise<void> = Promise.resolve();
/** What the wallet holds at the one mint, in sats. */
let mockWalletSats = 100_000;
const mockAddFunds = jest.fn();
jest.mock('@/shared/lib/routstr/sdk/client', () => ({
  getRoutstrClient: async (_origin: string, canDispatch: () => boolean = () => true) => {
    await mockClientGate;
    return {
      client: {
        routeRequest: async (request: { modelId?: string }) => {
          if (!canDispatch()) throw new Error('Payment request was cancelled');
          return mockRoute(request);
        },
      },
      baseUrl: 'https://node.example/',
      payment: () => ({
        mintedSats: null,
        mintedFromHost: undefined,
        changeSats: null,
        changeReceived: false,
        changeFailed: false,
      }),
      finish: async () => {},
      refusal: () => null,
      settleWithoutChange: jest.fn(),
    };
  },
  acceptedMintsForProvider: async () => ['https://mint.example'],
  seedProviderCatalog: jest.fn(),
  sweepUnsettledPayments: jest.fn(async () => {}),
  scheduleRecoverySweeps: jest.fn(),
  resetRoutstrClient: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/sdk/walletAdapter', () => ({
  cocoWalletAdapter: {
    getBalances: async () => {
      await mockBalancesGate;
      return { 'https://mint.example': 100_000 };
    },
  },
}));
jest.mock('@/features/ai/lib/navigateToAddFunds', () => ({
  useNavigateToAddFunds: () => mockAddFunds,
}));
jest.mock('@/features/ai/lib/spendConfirm', () => ({ confirmSpend: jest.fn() }));
jest.mock('@/shared/lib/routstr/refreshLineup', () => ({
  refreshRoutstrLineup: jest.fn(async () => false),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: 0 }),
    subscribe: () => () => undefined,
  },
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
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  isTestnutMint: () => false,
  useIsTestnutMint: () => () => false,
}));
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
  useBalanceContext: () => ({
    balances: {
      byMint: {
        'https://mint.example': { total: mockWalletSats, spendable: mockWalletSats, unit: 'sat' },
      },
    },
  }),
}));

const entry = (modelId: string, upstreamId: string): LineupEntry => ({
  modelId,
  upstreamId,
  displayName: modelId,
  contextLength: 100000,
  created: 1,
  visionInput: true,
  satsPricing: { prompt: 0, completion: 0.001, request: 0, image: 0, max_cost: 1 },
});

function msg(id: string, role: 'user' | 'assistant', parentId: string | null): RoutstrMessage {
  return { id, role, content: id, timestamp: id.length, parentId };
}
const first = [msg('u1', 'user', null), msg('a1', 'assistant', 'u1')];
const other = [msg('o1', 'user', null), msg('o2', 'assistant', 'o1')];
const session = (id: string, messages: RoutstrMessage[]) => ({
  id,
  title: id,
  createdAt: 1,
  messages,
  activeChildren: {},
});
const messagesOf = (id: string) =>
  useRoutstrStore.getState().sessions.find((s) => s.id === id)!.messages;

function hold() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  return { held, release: () => act(async () => release()) };
}
const tick = () => act(async () => undefined);
const switchAway = () =>
  act(async () => {
    useRoutstrStore.getState().switchSession('s2');
  });

function start(action: 'send' | 'retry') {
  const hook = renderHook(useAiSend);
  let pending!: Promise<unknown>;
  act(() => {
    pending =
      action === 'send' ? hook.result.current.send('and this?') : hook.result.current.retry('a1');
  });
  return { hook, settle: () => act(async () => void (await pending)) };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetTurns();
  resetModelAvailability();
  mockClientGate = Promise.resolve();
  mockBalancesGate = Promise.resolve();
  mockWalletSats = 100_000;
  mockRoute.mockReset().mockRejectedValue(new Error('the test does not answer'));
  await useRoutstrStore.persist.rehydrate();
  const lineup = emptyLineup();
  lineup.openai.pro = entry('model-pro', 'openrouter');
  lineup.claude.pro = entry('other-pro', 'tinfoil');
  setRoutstrNodeBaseUrl('https://node.example');
  useRoutstrStore.setState({
    apiKey: null,
    confirmSpend: false,
    balance: 100000,
    lineup,
    lastKnownLineup: null,
    nodeBaseUrl: 'https://node.example',
    userNodeBaseUrl: 'https://node.example',
    selectedProvider: 'openai',
    selectedTier: 'pro',
    isAnonymousMode: false,
    sessions: [session('s1', first), session('s2', other)],
    currentSessionId: 's1',
    conversationHistory: first,
    activeChildren: {},
  });
});

describe('a request whose conversation is switched away after it was handed over', () => {
  it.each(['send', 'retry'] as const)(
    'a %s still dispatches when nothing moved while its payment client is built',
    async (action) => {
      const client = hold();
      mockClientGate = client.held;
      const { settle } = start(action);
      await tick();
      await client.release();
      await settle();

      expect(mockRoute).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    [
      'its paying mint is chosen',
      (gate: Promise<void>) => {
        mockBalancesGate = gate;
      },
    ],
    [
      'its payment client is built',
      (gate: Promise<void>) => {
        mockClientGate = gate;
      },
    ],
  ])(
    'a send is not paid for when the conversation is switched while %s',
    async (_label, holdAt) => {
      const wait = hold();
      holdAt(wait.held);
      const { settle } = start('send');
      await tick();
      await switchAway();
      await wait.release();
      await settle();

      expect(mockRoute).not.toHaveBeenCalled();
      expect(messagesOf('s2')).toEqual(other);
      const s1 = messagesOf('s1');
      expect(s1.slice(2).map((m) => [m.role, m.content])).toEqual([
        ['user', 'and this?'],
        ['assistant', ''],
      ]);
      // The question waits in its own conversation, to be asked again.
      expect(readAnswer(s1[3]!, getTurn(s1[3]!.id)).phase).toBe('interrupted');
    }
  );

  it('a regenerate is not paid for when the conversation is switched while its payment client is built', async () => {
    const client = hold();
    mockClientGate = client.held;
    const { settle } = start('retry');
    await tick();
    await switchAway();
    await client.release();
    await settle();

    expect(mockRoute).not.toHaveBeenCalled();
    expect(messagesOf('s2')).toEqual(other);
  });

  it.each(['send', 'retry'] as const)(
    'a %s is not paid for when the conversation is switched away and back while its payment client is built',
    async (action) => {
      const client = hold();
      mockClientGate = client.held;
      const { settle } = start(action);
      await tick();
      await switchAway();
      await act(async () => {
        useRoutstrStore.getState().switchSession('s1');
      });
      await client.release();
      await settle();

      // Once it lost its conversation the request is over, though it is open again.
      expect(mockRoute).not.toHaveBeenCalled();
      expect(messagesOf('s2')).toEqual(other);
    }
  );

  it('a refused candidate does not lead to a paid request for the next one after a switch', async () => {
    mockRoute.mockImplementationOnce(async () => {
      useRoutstrStore.getState().switchSession('s2');
      throw new ProviderError('https://node.example/', 402, 'Payment Required');
    });
    const { settle } = start('send');
    await settle();

    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(messagesOf('s2')).toEqual(other);
  });

  it('a refused candidate still leads to the next one when nothing moved', async () => {
    mockRoute.mockRejectedValueOnce(
      new ProviderError('https://node.example/', 402, 'Payment Required')
    );
    const { settle } = start('send');
    await settle();

    expect(mockRoute.mock.calls.map(([request]) => request.modelId)).toEqual([
      'model-pro',
      'other-pro',
    ]);
  });
});

describe('what a regenerate or a Retry checks before it spends', () => {
  // The error pill's Retry and the regenerate button both call `retry`.
  const answered = () =>
    mockRoute.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
  const askFirst = (answer: boolean | (() => Promise<boolean>)) => {
    useRoutstrStore.setState({ confirmSpend: true });
    jest
      .mocked(confirmSpend)
      .mockImplementation(typeof answer === 'function' ? answer : async () => answer);
  };

  it.each(['send', 'retry'] as const)(
    'a %s is not paid for when the spend sheet is declined',
    async (action) => {
      askFirst(false);
      const { settle } = start(action);
      await settle();

      expect(confirmSpend).toHaveBeenCalledTimes(1);
      expect(mockRoute).not.toHaveBeenCalled();
      // No question and no new answer is left behind.
      expect(messagesOf('s1')).toEqual(first);
    }
  );

  it('a regenerate is paid for once the spend sheet is accepted, and is shown what the model holds', async () => {
    askFirst(true);
    answered();
    const { settle } = start('retry');
    await settle();

    expect(confirmSpend).toHaveBeenCalledWith({
      modelName: 'model-pro',
      reserveSats: expect.any(Number),
      reserveKnown: expect.any(Boolean),
    });
    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(messagesOf('s1').map((m) => [m.role, m.parentId])).toEqual([
      ['user', null],
      ['assistant', 'u1'],
      ['assistant', 'u1'],
    ]);
  });

  it('a regenerate opens Add funds when the wallet cannot cover what the model holds', async () => {
    mockWalletSats = 0;
    answered();
    const { settle } = start('retry');
    await settle();

    expect(mockAddFunds).toHaveBeenCalledTimes(1);
    expect(mockRoute).not.toHaveBeenCalled();
    expect(messagesOf('s1')).toEqual(first);
  });

  it('a regenerate with no provider chosen says so and opens the provider list', async () => {
    useRoutstrStore.setState({ userNodeBaseUrl: null });
    answered();
    const { settle } = start('retry');
    await settle();

    expect(staticPopup).toHaveBeenCalledWith('ai-no-provider');
    expect(guardedRouter.navigate).toHaveBeenCalledWith('/(ai-flow)/providers');
    expect(mockRoute).not.toHaveBeenCalled();
    expect(messagesOf('s1')).toEqual(first);
  });

  it('a regenerate is refused when the provider takes only a mint the wallet does not hold', async () => {
    const provider = useRoutstrStore.getState().knownProviders['https://node.example'];
    useRoutstrStore.setState({
      knownProviders: {
        'https://node.example': { ...provider, mints: ['https://other-mint.example'] },
      },
    });
    answered();
    const { settle } = start('retry');
    await settle();

    expect(staticPopup).toHaveBeenCalledWith('ai-mint-not-accepted');
    expect(mockRoute).not.toHaveBeenCalled();
    expect(messagesOf('s1')).toEqual(first);
  });

  it.each(['send', 'retry'] as const)(
    'a %s is not paid for when the model is changed while its spend sheet is open',
    async (action) => {
      askFirst(async () => {
        useRoutstrStore.setState({ selectedProvider: 'claude' });
        return true;
      });
      answered();
      const { settle } = start(action);
      await settle();

      expect(staticPopup).toHaveBeenCalledWith('ai-payment-options-changed');
      expect(mockRoute).not.toHaveBeenCalled();
      expect(messagesOf('s1')).toEqual(first);
    }
  );

  it('a regenerate is not paid for when the conversation is switched while its spend sheet is open', async () => {
    askFirst(async () => {
      useRoutstrStore.getState().switchSession('s2');
      return true;
    });
    answered();
    const { settle } = start('retry');
    await settle();

    expect(mockRoute).not.toHaveBeenCalled();
    expect(staticPopup).not.toHaveBeenCalled();
    expect(messagesOf('s1')).toEqual(first);
    expect(messagesOf('s2')).toEqual(other);
  });
});

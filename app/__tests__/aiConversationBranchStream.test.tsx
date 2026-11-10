/**
 * The AI conversation tree and its live stream.
 *
 * Branching: the flat saved message list is read as a tree (`parentId`, with
 * legacy messages chained by order), the visible thread is the active path,
 * and regenerating an answer forks a sibling and switches to it. The app has
 * no "edit an earlier message" action; regenerate and sending after switching
 * branches are the two ways the tree forks, and both are pinned here.
 *
 * Streaming: chunks go to the live streaming buffer the bubble reads, not to
 * the saved store, and land in the store in one write when the stream ends.
 * Pinned: what the bubble sees per chunk, what the store holds mid-stream
 * (what would survive the app being killed), and what an abort or a failure
 * mid-stream leaves.
 *
 * The real `useAiSend`, Routstr store and branching run. The network edge
 * (`sendMessage`) returns a stream the test feeds chunk by chunk; the
 * harness otherwise follows `aiSendRecovery.test.ts`.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAiSend } from '@/features/ai/hooks/useAiSend';
import {
  deriveActivePath,
  getAncestorsExclusive,
  getSiblingInfo,
  withSynthesisedParents,
} from '@/features/ai/lib/branching';
import { useStreamingContent, useStreamingReasoning } from '@/features/ai/lib/streamingBuffer';
import { getTurnError, resetTurnErrors } from '@/features/ai/lib/turnErrors';
import { resetModelAvailability } from '@/features/ai/lib/modelAvailability';
import { sendMessage, checkBalance } from '@/shared/lib/routstr/api';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { emptyLineup, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';

jest.mock('@/features/ai/lib/navigateToAddFunds', () => ({
  useNavigateToAddFunds: () => jest.fn(),
}));
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
      byMint: { 'https://mint.example': { total: 100_000, spendable: 100_000, unit: 'sat' } },
    },
  }),
}));

const sendMock = jest.mocked(sendMessage);

const entry = (modelId: string): LineupEntry => ({
  modelId,
  displayName: modelId,
  contextLength: 100000,
  created: 1,
  visionInput: true,
  satsPricing: { prompt: 0, completion: 0.001, request: 0, image: 0, max_cost: 1 },
});

type Chunk = { choices: { delta?: Record<string, string>; finish_reason?: string }[] };

/** A stream the test feeds: each `push` releases one chunk to the consumer. */
function controlledStream(signal?: AbortSignal) {
  const queue: (Chunk | Error | null)[] = [];
  let wake: (() => void) | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  signal?.addEventListener('abort', () => {
    queue.push(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    poke();
  });
  async function* iterate() {
    for (;;) {
      if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const next = queue.shift()!;
      if (next === null) return;
      if (next instanceof Error) throw next;
      yield next;
    }
  }
  return {
    stream: iterate(),
    push: (chunk: Chunk) => {
      queue.push(chunk);
      poke();
    },
    end: () => {
      queue.push(null);
      poke();
    },
    fail: (err: Error) => {
      queue.push(err);
      poke();
    },
  };
}
const content = (text: string): Chunk => ({ choices: [{ delta: { content: text } }] });
const reasoning = (text: string): Chunk => ({ choices: [{ delta: { reasoning_content: text } }] });

let live: ReturnType<typeof controlledStream>;
function arrangeStream(cost = 4) {
  sendMock.mockImplementationOnce(async (_messages, options) => {
    live = controlledStream((options as { signal?: AbortSignal }).signal);
    const result: Awaited<ReturnType<typeof sendMessage>> = {
      stream: live.stream as never,
      cost: Promise.resolve(cost),
    };
    return result;
  });
}
const tick = () => act(async () => undefined);
const history = () => useRoutstrStore.getState().conversationHistory;

function msg(
  id: string,
  role: 'user' | 'assistant',
  parentId: string | null | undefined,
  timestamp: number,
  text = id
): RoutstrMessage {
  return { id, role, content: text, timestamp, ...(parentId !== undefined ? { parentId } : {}) };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetTurnErrors();
  resetModelAvailability();
  await useRoutstrStore.persist.rehydrate();
  const lineup = emptyLineup();
  lineup.openai.auto = entry('model-auto');
  lineup.openai.pro = entry('model-pro');
  useRoutstrStore.setState({
    apiKey: 'cashuA-key',
    authMode: 'bearer',
    confirmSpend: false,
    balance: 100000,
    lineup,
    lastKnownLineup: null,
    nodeBaseUrl: 'https://node.example',
    userNodeBaseUrl: 'https://node.example',
    selectedProvider: 'openai',
    selectedTier: 'pro',
    conversationHistory: [],
    activeChildren: {},
    sessions: [],
    currentSessionId: null,
    isAnonymousMode: true,
  });
  jest.mocked(checkBalance).mockResolvedValue({ balance: 90000 });
  jest.mocked(refreshRoutstrLineup).mockResolvedValue(false);
});

describe('reading the saved list as a tree', () => {
  it('chains legacy messages without parentId in saved order, keeping existing ones', () => {
    const legacy = [msg('a', 'user', undefined, 1), msg('b', 'assistant', undefined, 2)];
    expect(withSynthesisedParents(legacy).map((m) => [m.id, m.parentId])).toEqual([
      ['a', null],
      ['b', 'a'],
    ]);
    const current = [msg('a', 'user', null, 1)];
    expect(withSynthesisedParents(current)).toBe(current);
  });

  it('shows the newest child at a fork unless another one is chosen', () => {
    const tree = [
      msg('u1', 'user', null, 1),
      msg('a-old', 'assistant', 'u1', 2),
      msg('u2', 'user', 'a-old', 3),
      msg('a-new', 'assistant', 'u1', 4),
    ];

    expect(deriveActivePath(tree, {}).map((m) => m.id)).toEqual(['u1', 'a-new']);
    expect(deriveActivePath(tree, { u1: 'a-old' }).map((m) => m.id)).toEqual(['u1', 'a-old', 'u2']);
    expect(getSiblingInfo('a-new', tree)).toMatchObject({ index: 2, total: 2 });
    expect(getSiblingInfo('u1', tree)).toBeNull();
  });

  it('ignores a chosen child that no longer exists, and stops at a cycle', () => {
    const tree = [msg('u1', 'user', null, 1), msg('a1', 'assistant', 'u1', 2)];
    expect(deriveActivePath(tree, { u1: 'gone' }).map((m) => m.id)).toEqual(['u1', 'a1']);

    const cycle = [msg('x', 'user', 'y', 1), msg('y', 'assistant', 'x', 2)];
    // QUIRK: with no root, the earliest message starts the path, and a chosen
    // child pointing anywhere in the list is followed even if it is not a child.
    expect(deriveActivePath(cycle, {}).map((m) => m.id)).toEqual(['x', 'y']);
    const deeper = [...tree, msg('u2', 'user', 'a1', 3)];
    expect(deriveActivePath(deeper, { u1: 'u2' }).map((m) => m.id)).toEqual(['u1', 'u2']);
  });

  it('gives a message its ancestors, root first, without itself', () => {
    const tree = [
      msg('u1', 'user', null, 1),
      msg('a1', 'assistant', 'u1', 2),
      msg('u2', 'user', 'a1', 3),
      msg('a2', 'assistant', 'u2', 4),
    ];
    expect(getAncestorsExclusive('a2', tree).map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
    expect(getAncestorsExclusive('missing', tree)).toEqual([]);
  });
});

describe('forking the conversation', () => {
  const seeded = [
    msg('u1', 'user', null, 1, 'first question'),
    msg('a1', 'assistant', 'u1', 2, 'first answer'),
    msg('u2', 'user', 'a1', 3, 'follow up'),
    msg('a2', 'assistant', 'u2', 4, 'second answer'),
  ];

  it('regenerating an earlier answer adds a sibling, switches to it and sends only its ancestors', async () => {
    useRoutstrStore.setState({ conversationHistory: seeded });
    arrangeStream();
    const { result } = renderHook(useAiSend);

    let retrying!: Promise<unknown>;
    act(() => {
      retrying = result.current.retry('a1');
    });
    await tick();
    const newId = history()[4]!.id;
    expect(history()[4]).toMatchObject({ role: 'assistant', parentId: 'u1', content: '' });
    expect(useRoutstrStore.getState().activeChildren).toEqual({ u1: newId });
    expect(sendMock.mock.calls[0]![0]).toEqual([{ role: 'user', content: 'first question' }]);

    await act(async () => {
      live.push(content('a better first answer'));
      live.end();
      await retrying;
    });

    const state = useRoutstrStore.getState();
    expect(
      deriveActivePath(state.conversationHistory, state.activeChildren).map((m) => m.id)
    ).toEqual(['u1', newId]);
    expect(state.conversationHistory.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', newId]);
    expect(getSiblingInfo(newId, state.conversationHistory)).toMatchObject({ index: 2, total: 2 });
    expect(deriveActivePath(state.conversationHistory, { u1: 'a1' }).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ]);
  });

  it('a send after switching back to an older branch continues that branch', async () => {
    useRoutstrStore.setState({
      conversationHistory: [...seeded, msg('a1b', 'assistant', 'u1', 5, 'other answer')],
      activeChildren: { u1: 'a1' },
    });
    arrangeStream();
    const { result } = renderHook(useAiSend);

    let sending!: Promise<unknown>;
    act(() => {
      sending = result.current.send('third question');
    });
    await tick();
    await act(async () => {
      live.push(content('third answer'));
      live.end();
      await sending;
    });

    const [user, assistant] = history().slice(-2);
    expect(user).toMatchObject({ role: 'user', parentId: 'a2', content: 'third question' });
    expect(assistant).toMatchObject({ role: 'assistant', parentId: user!.id });
    expect(sendMock.mock.calls[0]![0].map((m) => m.content)).toEqual([
      'first question',
      'first answer',
      'follow up',
      'second answer',
      'third question',
    ]);
  });

  it('regenerate refuses a user message and sends nothing', async () => {
    useRoutstrStore.setState({ conversationHistory: seeded });
    const { result } = renderHook(useAiSend);

    await act(async () => {
      await result.current.retry('u2');
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(history()).toEqual(seeded);
  });
});

describe('streaming an answer', () => {
  async function startSend(text = 'hello') {
    arrangeStream();
    const hook = renderHook(useAiSend);
    let sending!: Promise<unknown>;
    act(() => {
      sending = hook.result.current.send(text);
    });
    await tick();
    const assistantId = history()[1]!.id;
    const bubble = renderHook(() => ({
      text: useStreamingContent(assistantId),
      thinking: useStreamingReasoning(assistantId),
    }));
    return { hook, bubble, assistantId, sending: () => sending };
  }

  it('the bubble reads each chunk from the live buffer while the store keeps an empty placeholder', async () => {
    const { bubble, assistantId, hook } = await startSend();
    expect(hook.result.current).toMatchObject({ isSending: true, streamingMessageId: assistantId });
    expect(bubble.result.current).toEqual({ text: '', thinking: '' });

    await act(async () => live.push(reasoning('let me think')));
    await act(async () => live.push(content('Hel')));
    await act(async () => live.push(content('lo!')));

    expect(bubble.result.current).toEqual({ text: 'Hello!', thinking: 'let me think' });
    expect(history()[1]).toMatchObject({ id: assistantId, content: '' });
    expect(history()[0]).toMatchObject({ role: 'user', content: 'hello', pending: true });
  });

  it('on completion writes content, reasoning and cost to the store once and clears the live buffer', async () => {
    const { bubble, assistantId, hook, sending } = await startSend();

    await act(async () => {
      live.push(reasoning('hmm'));
      live.push(content('Done.'));
      live.end();
      await sending();
    });

    expect(history()[1]).toMatchObject({
      id: assistantId,
      content: 'Done.',
      reasoningContent: 'hmm',
      costSats: 4,
    });
    expect(history()[0]!.pending).toBe(false);
    expect(bubble.result.current).toEqual({ text: null, thinking: null });
    expect(hook.result.current).toMatchObject({ isSending: false, streamingMessageId: null });
  });

  it('what is saved mid-stream: the session holds the pending question and an empty answer', async () => {
    useRoutstrStore.setState({ isAnonymousMode: false });
    await startSend('saved?');
    await act(async () => live.push(content('partial text')));

    const state = useRoutstrStore.getState();
    const persisted = useRoutstrStore.persist.getOptions().partialize!(state) as {
      sessions: { id: string; messages: RoutstrMessage[] }[];
      currentSessionId: string | null;
    };
    const session = persisted.sessions.find((s) => s.id === persisted.currentSessionId)!;

    // QUIRK: a kill now relaunches into a question marked pending forever and
    // an empty answer with no error; the streamed text was never written.
    expect(session.messages.map((m) => [m.role, m.content, m.pending ?? null])).toEqual([
      ['user', 'saved?', true],
      ['assistant', '', null],
    ]);
  });

  it('an abort mid-stream (the screen unmounting) removes the answer placeholder and its partial text', async () => {
    const { hook, bubble, assistantId, sending } = await startSend();
    await act(async () => live.push(content('half an ans')));

    hook.unmount();
    await act(async () => {
      await sending();
    });

    expect(history().map((m) => m.role)).toEqual(['user']);
    expect(history().some((m) => m.id === assistantId)).toBe(false);
    expect(getTurnError(assistantId)).toBeNull();
    expect(bubble.result.current).toEqual({ text: null, thinking: null });
  });

  it('a failure mid-stream keeps the placeholder empty with an error pill; the streamed text is lost', async () => {
    const { bubble, assistantId, sending } = await startSend();
    await act(async () => live.push(content('half an ans')));

    await act(async () => {
      live.fail(Object.assign(new Error('socket closed'), { status: 0 }));
      await sending();
    });

    // QUIRK: the text already shown is dropped; the turn keeps only the error.
    expect(history()[1]).toMatchObject({ id: assistantId, content: '' });
    expect(getTurnError(assistantId)).not.toBeNull();
    expect(history()[0]!.pending).toBe(false);
    expect(bubble.result.current).toEqual({ text: null, thinking: null });
  });

  it('a stream that ends with no chunks leaves the placeholder empty and unfinalised', async () => {
    const { assistantId, sending } = await startSend();

    await act(async () => {
      live.end();
      await sending();
    });

    expect(history()[1]).toMatchObject({ id: assistantId, content: '' });
    expect(history()[1]!.costSats).toBeUndefined();
    expect(getTurnError(assistantId)).toBeNull();
  });

  it('a second send while one streams is dropped', async () => {
    const { hook } = await startSend();

    await act(async () => {
      await expect(hook.result.current.send('again')).resolves.toBeUndefined();
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(history()).toHaveLength(2);
  });
});

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
import { getTurn, readAnswer, resetTurns, useTurn, type Turn } from '@/features/ai/lib/turns';
import { resetModelAvailability } from '@/features/ai/lib/modelAvailability';
import { sendMessage } from '@/shared/lib/routstr/api';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { encodeChatImage } from '@/features/ai/lib/attachments';
import { confirmSpend } from '@/features/ai/lib/spendConfirm';
import { emptyLineup, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';

jest.mock('@/features/ai/lib/navigateToAddFunds', () => ({
  useNavigateToAddFunds: () => jest.fn(),
}));
jest.mock('@/features/ai/lib/spendConfirm', () => ({ confirmSpend: jest.fn() }));
jest.mock('@/shared/lib/routstr/api', () => ({
  ...jest.requireActual('@/shared/lib/routstr/api'),
  sendMessage: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/refreshLineup', () => ({ refreshRoutstrLineup: jest.fn() }));
let mockAccount = 0;
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: mockAccount }),
    subscribe: () => () => undefined,
  },
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  // What a relaunch reads; set on the mock, since the store loads on import.
  const saved = { value: null as string | null };
  return {
    saved,
    createProfileScopedStorage: () => ({
      getItem: async () => saved.value,
      setItem: async () => {},
      removeItem: async () => {},
    }),
  };
});
const savedBlob = (): { value: string | null } =>
  jest.requireMock('@/shared/lib/cashu/profileScopedStorage').saved;
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

/** What the bubble shows live for a turn: its text and reasoning while asked or streamed. */
function liveOf(turn: Turn | undefined) {
  if (turn?.phase === 'streaming') return { text: turn.text, thinking: turn.reasoning };
  if (turn?.phase === 'asking') return { text: '', thinking: '' };
  return { text: null, thinking: null };
}

/** The failure recorded on an answer's turn, if it failed. */
function getTurnError(messageId: string) {
  const turn = getTurn(messageId);
  return turn?.phase === 'failed' ? turn.error : null;
}
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
  mockAccount = 0;
  resetTurns();
  resetModelAvailability();
  savedBlob().value = null;
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
    const bubble = renderHook(() => liveOf(useTurn(assistantId)));
    return { hook, bubble, assistantId, sending: () => sending };
  }

  it('the bubble reads each chunk from the turn while the store keeps an empty placeholder', async () => {
    const { bubble, assistantId, hook } = await startSend();
    expect(hook.result.current.isSending).toBe(true);
    expect(getTurn(assistantId)?.phase).toBe('asking');
    expect(bubble.result.current).toEqual({ text: '', thinking: '' });

    await act(async () => live.push(reasoning('let me think')));
    await act(async () => live.push(content('Hel')));
    await act(async () => live.push(content('lo!')));

    expect(bubble.result.current).toEqual({ text: 'Hello!', thinking: 'let me think' });
    expect(history()[1]).toMatchObject({ id: assistantId, content: '' });
    expect(history()[0]).toMatchObject({ role: 'user', content: 'hello', pending: true });
  });

  it('on completion writes content, reasoning and cost to the store once and settles the turn', async () => {
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
    expect(hook.result.current.isSending).toBe(false);
    // The saved message holds the answer, so its turn is dropped and it reads from there.
    expect(getTurn(assistantId)).toBeUndefined();
    expect(readAnswer(history()[1]!, getTurn(assistantId))).toEqual({
      phase: 'done',
      truncation: null,
    });
  });

  it('a failure after the answer settled does not mark the finished answer failed', async () => {
    const { updateSessionTitle } = useRoutstrStore.getState();
    useRoutstrStore.setState({
      isAnonymousMode: false,
      updateSessionTitle: () => {
        throw new Error('title');
      },
    });
    const { assistantId, sending } = await startSend();

    await act(async () => {
      live.push(content('Done.'));
      live.end();
      await sending();
    });

    useRoutstrStore.setState({ updateSessionTitle });
    expect(getTurn(assistantId)).toBeUndefined();
    expect(readAnswer(history()[1]!, getTurn(assistantId)).phase).toBe('done');
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

  it('never saves a question without its answer, so a kill leaves one to ask again', async () => {
    useRoutstrStore.setState({ isAnonymousMode: false });
    const saved: RoutstrMessage[][] = [];
    const stop = useRoutstrStore.subscribe((state) => {
      const blob = useRoutstrStore.persist.getOptions().partialize!(state) as {
        sessions: { messages: RoutstrMessage[] }[];
      };
      for (const session of blob.sessions) saved.push(session.messages);
    });
    await startSend('kept?');
    stop();

    for (const messages of saved) {
      for (const question of messages.filter((m) => m.role === 'user' && m.pending))
        expect(messages.some((m) => m.parentId === question.id)).toBe(true);
    }
    expect(saved.length).toBeGreaterThan(0);
  });

  it('reads a question saved as sending, by a kill or an older build, as an answer to ask again', async () => {
    savedBlob().value = JSON.stringify({
      version: 3,
      state: {
        currentSessionId: 's1',
        sessions: [
          {
            id: 's1',
            title: 'Saved',
            createdAt: 1,
            messages: [
              { ...msg('u1', 'user', null, 1, 'asked before the kill'), pending: true },
              msg('a1', 'assistant', 'u1', 2, ''),
            ],
          },
        ],
      },
    });
    useRoutstrStore.setState({ isAnonymousMode: false });
    await useRoutstrStore.persist.rehydrate();

    const [question, answer] = history();
    expect(question).toMatchObject({ id: 'u1', pending: false });
    expect(readAnswer(answer!, getTurn('a1'))).toEqual({ phase: 'interrupted', text: '' });

    arrangeStream();
    const { result } = renderHook(useAiSend);
    let retrying!: Promise<unknown>;
    act(() => {
      retrying = result.current.retry('a1');
    });
    await tick();
    await act(async () => {
      live.push(content('answered now'));
      live.end();
      await retrying;
    });
    expect(history().at(-1)).toMatchObject({ parentId: 'u1', content: 'answered now' });
  });

  it('leaving the screen mid-answer keeps the answer so far, as one that can be asked again', async () => {
    const { hook, assistantId, sending } = await startSend();
    await act(async () => live.push(content('half an ans')));

    hook.unmount();
    await act(async () => {
      await sending();
    });

    expect(history().map((m) => [m.role, m.content, m.pending ?? null])).toEqual([
      ['user', 'hello', false],
      ['assistant', '', null],
    ]);
    expect(getTurn(assistantId)).toEqual({ phase: 'interrupted', text: 'half an ans' });

    // Back on the screen, the answer can be asked again.
    arrangeStream();
    const again = renderHook(useAiSend);
    let retrying!: Promise<unknown>;
    act(() => {
      retrying = again.result.current.retry(assistantId);
    });
    await tick();
    await act(async () => {
      live.push(content('a whole answer'));
      live.end();
      await retrying;
    });
    expect(history().at(-1)).toMatchObject({
      parentId: history()[0]!.id,
      content: 'a whole answer',
    });
  });

  it('a stream stopped by a newer one keeps the answer it had so far', async () => {
    useRoutstrStore.setState({
      conversationHistory: [
        msg('u1', 'user', null, 1, 'first question'),
        msg('a1', 'assistant', 'u1', 2, 'first answer'),
      ],
    });
    arrangeStream();
    const hook = renderHook(useAiSend);
    let retrying!: Promise<unknown>;
    act(() => {
      retrying = hook.result.current.retry('a1');
    });
    await tick();
    const older = history().at(-1)!.id;
    await act(async () => live.push(content('regenerat')));

    arrangeStream();
    act(() => {
      void hook.result.current.send('second question');
    });
    await act(async () => {
      await retrying;
    });

    expect(history().some((m) => m.id === older)).toBe(true);
    expect(getTurn(older)).toEqual({ phase: 'interrupted', text: 'regenerat' });
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

  it.each([
    ['another conversation is opened', () => useRoutstrStore.getState().switchSession('other')],
    ['a new conversation is started', () => void useRoutstrStore.getState().createSession()],
  ])(
    'an answer still streaming when %s lands in the conversation that asked',
    async (_label, leave) => {
      useRoutstrStore.setState({
        isAnonymousMode: false,
        sessions: [
          { id: 'other', title: 'Other', createdAt: 1, messages: [msg('o1', 'user', null, 1)] },
        ],
      });
      const { assistantId, sending } = await startSend('first question');
      const asked = useRoutstrStore.getState().currentSessionId!;
      await act(async () => live.push(content('the paid ')));

      act(leave);
      await act(async () => {
        live.push(content('answer'));
        live.end();
        await sending();
      });

      const sessions = useRoutstrStore.getState().sessions;
      const own = sessions.find((s) => s.id === asked)!;
      expect(own.messages.map((m) => [m.role, m.content, m.pending ?? null])).toEqual([
        ['user', 'first question', false],
        ['assistant', 'the paid answer', null],
      ]);
      expect(own.messages.find((m) => m.id === assistantId)?.costSats).toBe(4);
      expect(own.title).toBe('first question');
      // The conversation now on screen is untouched.
      expect(history().some((m) => m.id === assistantId)).toBe(false);
      expect(sessions.find((s) => s.id === 'other')!.messages).toEqual([
        msg('o1', 'user', null, 1),
      ]);

      act(() => useRoutstrStore.getState().switchSession(asked));
      expect(history().find((m) => m.id === assistantId)?.content).toBe('the paid answer');
    }
  );

  it('a send that overlaps a regenerated answer keeps its own live text and sending state', async () => {
    useRoutstrStore.setState({
      conversationHistory: [
        msg('u1', 'user', null, 1, 'first question'),
        msg('a1', 'assistant', 'u1', 2, 'first answer'),
      ],
    });
    arrangeStream();
    const hook = renderHook(useAiSend);
    act(() => {
      void hook.result.current.retry('a1');
    });
    await tick();
    const older = live;
    await act(async () => older.push(content('regenerat')));

    // The composer's send starts a second stream, which stops the first.
    arrangeStream();
    let sending!: Promise<unknown>;
    act(() => {
      sending = hook.result.current.send('second question');
    });
    await tick();
    const newer = history().at(-1)!.id;
    const bubble = renderHook(() => liveOf(useTurn(newer)).text);
    await act(async () => live.push(content('still here')));

    expect(bubble.result.current).toBe('still here');
    expect(hook.result.current.isSending).toBe(true);

    await act(async () => {
      live.end();
      await sending;
    });
    expect(history().at(-1)).toMatchObject({ id: newer, content: 'still here' });
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

describe('what happens while a send or regenerate is still getting ready', () => {
  const photo = { localUri: 'file:///photo.jpg', mimeType: 'image/jpeg', width: 1, height: 1 };
  const first = [
    { ...msg('u1', 'user', null, 1, 'what is this?'), attachments: [photo] },
    msg('a1', 'assistant', 'u1', 2, 'a cat'),
  ];
  const other = [msg('o1', 'user', null, 1, 'other'), msg('o2', 'assistant', 'o1', 2, 'reply')];
  const session = (id: string, messages: RoutstrMessage[]) => ({
    id,
    title: id,
    createdAt: 1,
    messages,
    activeChildren: {},
  });

  /** Image encoding that finishes only when the test says so. */
  function holdEncoding() {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    jest.mocked(encodeChatImage).mockImplementation(async () => {
      await held;
      return 'data:image/jpeg;base64,AAAA';
    });
    return () => act(async () => release());
  }

  /** Let the send or regenerate run its course; a request it started is answered at once. */
  async function settle(pending: Promise<unknown>) {
    for (let i = 0; i < 5; i++) await tick();
    if (sendMock.mock.calls.length > 0) live.end();
    await act(async () => {
      await pending;
    });
  }

  beforeEach(() => {
    useRoutstrStore.setState({
      isAnonymousMode: false,
      sessions: [session('s1', first), session('s2', other)],
      currentSessionId: 's1',
      conversationHistory: first,
      activeChildren: {},
    });
    arrangeStream();
  });

  const messagesOf = (id: string) =>
    useRoutstrStore.getState().sessions.find((s) => s.id === id)!.messages;

  it('a send whose conversation is switched away while its image encodes is not sent, and waits in its own conversation', async () => {
    const release = holdEncoding();
    const { result } = renderHook(useAiSend);
    let sending!: Promise<unknown>;
    act(() => {
      sending = result.current.send('and this?', [photo]);
    });
    await tick();
    act(() => useRoutstrStore.getState().switchSession('s2'));
    await release();
    await settle(sending);

    expect(sendMock).not.toHaveBeenCalled();
    expect(messagesOf('s2')).toEqual(other);
    expect(history()).toEqual(other);
    const s1 = messagesOf('s1');
    expect(s1.map((m) => [m.role, m.content, m.parentId])).toEqual([
      ['user', 'what is this?', null],
      ['assistant', 'a cat', 'u1'],
      ['user', 'and this?', 'a1'],
      ['assistant', '', s1[2]!.id],
    ]);
    expect(readAnswer(s1[3]!, getTurn(s1[3]!.id)).phase).toBe('interrupted');
  });

  it('a send whose conversation is switched away while its spend sheet is open is not sent, and waits in its own conversation', async () => {
    useRoutstrStore.setState({ confirmSpend: true });
    jest.mocked(confirmSpend).mockImplementationOnce(async () => {
      useRoutstrStore.getState().switchSession('s2');
      return true;
    });
    const { result } = renderHook(useAiSend);
    let sending!: Promise<unknown>;
    act(() => {
      sending = result.current.send('and this?');
    });
    await settle(sending);

    expect(sendMock).not.toHaveBeenCalled();
    expect(messagesOf('s2')).toEqual(other);
    expect(messagesOf('s1').map((m) => [m.role, m.content])).toEqual([
      ['user', 'what is this?'],
      ['assistant', 'a cat'],
      ['user', 'and this?'],
      ['assistant', ''],
    ]);
  });

  it('a regenerate whose conversation is switched away while its image encodes is not sent', async () => {
    const release = holdEncoding();
    const { result } = renderHook(useAiSend);
    let retrying!: Promise<unknown>;
    act(() => {
      retrying = result.current.retry('a1');
    });
    await tick();
    act(() => useRoutstrStore.getState().switchSession('s2'));
    await release();
    await settle(retrying);

    expect(sendMock).not.toHaveBeenCalled();
    expect(messagesOf('s2')).toEqual(other);
    expect(messagesOf('s1')).toEqual(first);
  });

  it.each(['send', 'retry'] as const)(
    'a %s whose account is switched while its image encodes is not sent',
    async (action) => {
      const release = holdEncoding();
      const { result } = renderHook(useAiSend);
      let pending!: Promise<unknown>;
      act(() => {
        pending =
          action === 'send'
            ? result.current.send('and this?', [photo])
            : result.current.retry('a1');
      });
      await tick();
      mockAccount = 1;
      await release();
      await settle(pending);

      expect(sendMock).not.toHaveBeenCalled();
      expect(messagesOf('s1')).toEqual(first);
    }
  );

  it.each(['send', 'retry'] as const)(
    'a %s whose screen closes while its image encodes is not sent, and the question stays to be asked again',
    async (action) => {
      const release = holdEncoding();
      const hook = renderHook(useAiSend);
      let pending!: Promise<unknown>;
      act(() => {
        pending =
          action === 'send'
            ? hook.result.current.send('and this?', [photo])
            : hook.result.current.retry('a1');
      });
      await tick();
      hook.unmount();
      await release();
      await settle(pending);

      expect(sendMock).not.toHaveBeenCalled();
      const s1 = messagesOf('s1');
      if (action === 'retry') expect(s1).toEqual(first);
      else {
        expect(s1.slice(2).map((m) => [m.role, m.content])).toEqual([
          ['user', 'and this?'],
          ['assistant', ''],
        ]);
        expect(readAnswer(s1[3]!, getTurn(s1[3]!.id)).phase).toBe('interrupted');
      }
    }
  );
});

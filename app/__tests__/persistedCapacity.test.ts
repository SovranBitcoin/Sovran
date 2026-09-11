/**
 * Capacity guards: a store must not be able to produce a blob its own schema
 * rejects for being too big.
 *
 * `persistRoundTrip` next door proves each store's INITIAL state parses
 * against its own schema, and says plainly what it cannot see: "an initial
 * state does not exercise populated rows". This is that gap, in the one store
 * where the two ends had actually drifted — the schema allowed 1024 sessions
 * and `createSession` prepended without a cap, so creating the 1025th made the
 * persisted blob fail parse. `createMergeWithSchema` is all-or-nothing, so the
 * next launch discarded the whole store: the API key, every session and its
 * transcript, the last-known lineup, the node override.
 *
 * These drive the real store past both of its ceilings and assert the
 * projection still parses. A cap enforced in only one of the two places fails
 * here.
 */
import { z } from 'zod';

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';

// `jest.mock` is hoisted above the imports above, so this still applies.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const STORE_NAME = 'routstr-store';

function registered(name: string) {
  const entry = persistRegistry.find((e) => e.name === name);
  if (!entry) throw new Error(`${name} is not registered`);
  return entry;
}

function project(name: string, state: unknown): unknown {
  const partialize = registered(name).partialize as (s: unknown) => unknown;
  // Through JSON, because that is what AsyncStorage hands back on rehydrate.
  return JSON.parse(JSON.stringify(partialize(state as never)));
}

function projection(): unknown {
  return project(STORE_NAME, useRoutstrStore.getState());
}

function parsed() {
  return registered(STORE_NAME).schema.safeParse(projection());
}

/** The ceilings the schema declares, read back out of it rather than retyped. */
function schemaLimits(): { sessions: number; messages: number } {
  const entry = persistRegistry.find((e) => e.name === STORE_NAME);
  const shape: unknown = z.toJSONSchema(entry!.schema, {
    unrepresentable: 'any',
    io: 'input',
  });
  const sessions = (
    shape as {
      properties?: {
        sessions?: {
          maxItems?: number;
          items?: { properties?: { messages?: { maxItems?: number } } };
        };
      };
    }
  ).properties?.sessions;
  const sessionCap = sessions?.maxItems;
  const messageCap = sessions?.items?.properties?.messages?.maxItems;
  if (sessionCap === undefined || messageCap === undefined) {
    throw new Error('routstr schema no longer declares its collection ceilings');
  }
  return { sessions: sessionCap, messages: messageCap };
}

function message(index: number): RoutstrMessage {
  const role: RoutstrMessage['role'] = index % 2 === 0 ? 'user' : 'assistant';
  return {
    id: `m${index}`,
    role,
    content: `body ${index}`,
    timestamp: 1_700_000_000 + index,
    // A real transcript is a chain, which is what makes head truncation able
    // to strand the messages that survive it.
    parentId: index === 0 ? null : `m${index - 1}`,
  };
}

beforeEach(() => {
  useRoutstrStore.setState({
    apiKey: 'sk-test',
    sessions: [],
    conversationHistory: [],
    currentSessionId: null,
  });
});

describe('routstr store capacity', () => {
  it('still parses after one more session than the schema allows', () => {
    const { sessions: cap } = schemaLimits();
    for (let i = 0; i < cap + 1; i++) useRoutstrStore.getState().createSession();

    // The store keeps them all in memory — only the projection is bounded.
    expect(useRoutstrStore.getState().sessions).toHaveLength(cap + 1);

    const result = parsed();
    expect(result.success).toBe(true);
    expect((projection() as { sessions: unknown[] }).sessions).toHaveLength(cap);
    // Newest-first, so the newest survive and the API key comes back with them.
    expect((result as { data: { apiKey: string } }).data.apiKey).toBe('sk-test');
  });

  it('still parses after one more message in a session than the schema allows', () => {
    const { messages: cap } = schemaLimits();
    useRoutstrStore.getState().createSession();
    const id = useRoutstrStore.getState().currentSessionId as string;
    const overflowing = Array.from({ length: cap + 1 }, (_, i) => message(i));
    useRoutstrStore.setState((state) => ({
      conversationHistory: overflowing,
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, messages: overflowing } : s)),
    }));

    const result = parsed();
    expect(result.success).toBe(true);
    const persisted = projection() as { sessions: { messages: { id: string }[] }[] };
    expect(persisted.sessions[0].messages).toHaveLength(cap);
    // Chronological, so the TAIL survives — the newest turns, not the oldest.
    expect(persisted.sessions[0].messages[cap - 1].id).toBe(`m${cap}`);
  });

  it('keeps the session the user is in, wherever it sits in the list', () => {
    // Trimming the newest 1024 would otherwise drop the one they are typing
    // into: the turns stay visible until relaunch and then are simply gone.
    const { sessions: cap } = schemaLimits();
    for (let i = 0; i < cap + 1; i++) useRoutstrStore.getState().createSession();
    const oldest = useRoutstrStore.getState().sessions[cap].id;
    useRoutstrStore.setState({ currentSessionId: oldest });

    const persisted = projection() as { sessions: { id: string }[]; currentSessionId: unknown };
    expect(persisted.sessions).toHaveLength(cap);
    expect(persisted.sessions.some((s) => s.id === oldest)).toBe(true);
    expect(persisted.currentSessionId).toBe(oldest);
    expect(parsed().success).toBe(true);
  });

  it('leaves no branch pointer aimed at a message the truncation dropped', () => {
    const { messages: cap } = schemaLimits();
    useRoutstrStore.getState().createSession();
    const id = useRoutstrStore.getState().currentSessionId as string;
    const overflowing = Array.from({ length: cap + 2 }, (_, i) => message(i));
    useRoutstrStore.setState((state) => ({
      conversationHistory: overflowing,
      sessions: state.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              messages: overflowing,
              // One pointer into the head that will be dropped, one wholly
              // inside the tail that must survive.
              activeChildren: { m0: 'm1', [`m${cap}`]: `m${cap + 1}` },
            }
          : s
      ),
    }));

    const persisted = projection() as {
      sessions: {
        activeChildren?: Record<string, string>;
        messages: { id: string; parentId?: string | null }[];
      }[];
    };
    expect(persisted.sessions[0].activeChildren).toEqual({ [`m${cap}`]: `m${cap + 1}` });
    // And the first retained turn is a root, not an orphan pointing at a
    // message that is not there: `buildBranchIndex` cannot root an orphan, so
    // its siblings would collapse to one arbitrary branch and the rest would
    // be unreachable.
    const dangling = persisted.sessions[0].messages.filter(
      (m) => m.parentId != null && !persisted.sessions[0].messages.some((x) => x.id === m.parentId)
    );
    expect(dangling).toEqual([]);
    expect(persisted.sessions[0].messages[0].parentId).toBeNull();
  });

  it('hands persist the same array when nothing exceeds a ceiling', () => {
    // `partialize` runs on every state change, including each streamed chunk.
    const partialize = registered(STORE_NAME).partialize as (s: unknown) => { sessions: unknown };
    useRoutstrStore.getState().createSession();
    const state = useRoutstrStore.getState();
    expect(partialize(state as never).sessions).toBe(state.sessions);
  });

  it('leaves a store inside both ceilings untouched', () => {
    useRoutstrStore.getState().createSession();
    const before = projection();
    expect(parsed().success).toBe(true);
    expect(projection()).toEqual(before);
  });
});

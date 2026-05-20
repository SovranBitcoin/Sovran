import { restoreActiveSessionView } from '@/shared/stores/profile/restoreActiveSessionView';

const message = (id: string, content: string) => ({
  id,
  role: 'user' as const,
  content,
  timestamp: 1,
});

describe('restoreActiveSessionView (audit 14.json F-003)', () => {
  it('repopulates conversationHistory and activeChildren from the active session', () => {
    const state = {
      currentSessionId: 's1',
      sessions: [
        {
          id: 's1',
          title: 't',
          createdAt: 0,
          messages: [message('m1', 'hi'), message('m2', 'there')],
          activeChildren: { m1: 'm2' },
        },
      ],
      conversationHistory: [],
      activeChildren: {},
    };

    restoreActiveSessionView(state);

    expect(state.conversationHistory).toEqual(state.sessions[0].messages);
    expect(state.activeChildren).toEqual({ m1: 'm2' });
  });

  it('leaves working copies untouched when there is no current session', () => {
    const state = {
      currentSessionId: null,
      sessions: [],
      conversationHistory: [message('anon-1', 'scratch')],
      activeChildren: { x: 'y' },
    };

    restoreActiveSessionView(state);

    expect(state.conversationHistory).toEqual([message('anon-1', 'scratch')]);
    expect(state.activeChildren).toEqual({ x: 'y' });
  });

  it('skips restoration when currentSessionId points at a missing session', () => {
    const state = {
      currentSessionId: 'gone',
      sessions: [],
      conversationHistory: [],
      activeChildren: {},
    };

    restoreActiveSessionView(state);

    expect(state.conversationHistory).toEqual([]);
    expect(state.activeChildren).toEqual({});
  });

  it('defaults activeChildren to an empty map when the session row omits it', () => {
    const state = {
      currentSessionId: 's1',
      sessions: [{ id: 's1', title: 't', createdAt: 0, messages: [message('m1', 'hi')] }],
      conversationHistory: [],
      activeChildren: { stale: 'value' },
    };

    restoreActiveSessionView(state);

    expect(state.conversationHistory).toEqual([message('m1', 'hi')]);
    expect(state.activeChildren).toEqual({});
  });
});

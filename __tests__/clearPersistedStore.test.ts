import { clearPersistedStore } from '@/shared/lib/persist/clearPersistedStore';

describe('clearPersistedStore', () => {
  it('replaces state with initialState before clearing storage', async () => {
    const calls: string[] = [];
    const store = {
      setState: (state: Partial<{ count: number }>) => {
        calls.push(`setState:${state.count}`);
      },
      persist: {
        clearStorage: async () => {
          calls.push('clearStorage');
        },
      },
    };

    await clearPersistedStore(store, { count: 0 });

    expect(calls).toEqual(['setState:0', 'clearStorage']);
  });

  it('awaits a synchronous clearStorage', async () => {
    const calls: string[] = [];
    const store = {
      setState: (_: object) => {
        calls.push('setState');
      },
      persist: {
        clearStorage: () => {
          calls.push('clearStorage');
        },
      },
    };

    await clearPersistedStore(store, {});

    expect(calls).toEqual(['setState', 'clearStorage']);
  });

  it('propagates rejection from clearStorage', async () => {
    const store = {
      setState: () => {},
      persist: {
        clearStorage: async () => {
          throw new Error('storage unavailable');
        },
      },
    };

    await expect(clearPersistedStore(store, {})).rejects.toThrow('storage unavailable');
  });
});

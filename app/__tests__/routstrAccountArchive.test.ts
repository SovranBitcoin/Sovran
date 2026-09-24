/**
 * Archived Routstr credentials.
 *
 * A Routstr key is `sk-<sha256(token)>` — a row in ONE node's database — and
 * the only bearer instrument for whatever was deposited there. Deleting it
 * makes that balance permanently unreachable, and a node repoint is exactly
 * what produced the 401 that used to delete it. These tests pin the three
 * properties that keep a user's sats reachable: the key survives retirement,
 * an oversized record never evicts an unreclaimed row, and one malformed entry
 * cannot take the other providers' keys down with it.
 */

import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  }),
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: noop,
    aiLog: noop,
    storeLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

const account = (apiKey: string, reclaimed: boolean) => ({
  apiKey,
  lastKnownBalanceMsats: reclaimed ? 0 : 50_000,
  archivedAt: 1,
  reclaimedAt: reclaimed ? 2 : null,
});

describe('archiveAccount', () => {
  beforeEach(() => useRoutstrStore.setState({ legacyAccounts: {} }));

  it('records the credential under the node it is believed to belong to', () => {
    useRoutstrStore.getState().archiveAccount('https://a.example', 'sk-aaa', 250_000);
    expect(useRoutstrStore.getState().legacyAccounts).toEqual({
      'https://a.example': expect.objectContaining({
        apiKey: 'sk-aaa',
        lastKnownBalanceMsats: 250_000,
        reclaimedAt: null,
      }),
    });
  });

  it('files a credential with no known node rather than dropping it', () => {
    // A repoint can move `nodeBaseUrl` out from under a key before anything
    // archives it. Losing the key because we cannot name its node is the
    // failure we are preventing, so it is kept regardless.
    useRoutstrStore.getState().archiveAccount(null, 'sk-orphan', null);
    expect(useRoutstrStore.getState().legacyAccounts['unknown']?.apiKey).toBe('sk-orphan');
  });

  it('never downgrades a known balance to null on a repeat archive', () => {
    useRoutstrStore.getState().archiveAccount('https://a.example', 'sk-aaa', 250_000);
    useRoutstrStore.getState().archiveAccount('https://a.example', 'sk-aaa', null);
    expect(
      useRoutstrStore.getState().legacyAccounts['https://a.example']?.lastKnownBalanceMsats
    ).toBe(250_000);
  });

  it('ignores an empty key', () => {
    useRoutstrStore.getState().archiveAccount('https://a.example', '', 0);
    expect(useRoutstrStore.getState().legacyAccounts).toEqual({});
  });

  it('marks a swept account without discarding its row', () => {
    // The row stays: the node may still hold dust and a refund is idempotent,
    // so the credential remains worth keeping.
    useRoutstrStore.getState().archiveAccount('https://a.example', 'sk-aaa', 250_000);
    useRoutstrStore.getState().markAccountReclaimed('https://a.example');
    const row = useRoutstrStore.getState().legacyAccounts['https://a.example'];
    expect(row?.apiKey).toBe('sk-aaa');
    expect(row?.reclaimedAt).toEqual(expect.any(Number));
    expect(row?.lastKnownBalanceMsats).toBe(0);
  });
});

describe('persisted archive', () => {
  const partialize = () => {
    const entry = useRoutstrStore.persist.getOptions().partialize;
    return (entry?.(useRoutstrStore.getState() as never) ?? {}) as {
      legacyAccounts: Record<string, unknown>;
    };
  };

  it('keeps every unreclaimed credential even past the ceiling', () => {
    // An oversized blob is recoverable. A deleted key is not — so when there is
    // nothing safe to evict, the record is left over its ceiling on purpose.
    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`https://n${i}.example`, account(`sk-${i}`, false)])
    );
    useRoutstrStore.setState({ legacyAccounts: many });
    expect(Object.keys(partialize().legacyAccounts)).toHaveLength(60);
  });

  it('evicts only reclaimed rows, oldest first', () => {
    const rows: Record<string, ReturnType<typeof account>> = {};
    for (let i = 0; i < 40; i++) rows[`https://done${i}.example`] = account(`sk-d${i}`, true);
    for (let i = 0; i < 5; i++) rows[`https://live${i}.example`] = account(`sk-l${i}`, false);
    useRoutstrStore.setState({ legacyAccounts: rows });

    const kept = partialize().legacyAccounts;
    expect(Object.keys(kept)).toHaveLength(32);
    for (let i = 0; i < 5; i++) {
      expect(kept[`https://live${i}.example`]).toBeDefined();
    }
  });
});

/**
 * @jest-environment node
 *
 * Characterization of the Whitenoise (Marmot) storage on the phone: the
 * versioned envelope every namespace is saved in, how bytes and bigints come
 * back, how keys are scoped per account and namespace, the DM index, the
 * per-group message history and the per-account wipe. The real adapters run
 * over an in-memory AsyncStorage. marmot-ts ships untranspiled ESM that the
 * app's Jest config does not transform, so its rumor codec is replaced by a
 * representative JSON codec that, like the real one, throws on bytes it cannot
 * decode.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AsyncStorageKVBackend } from '@/features/whitenoise/storage/asyncStorageBackend';
import { WhitenoiseDmIndex } from '@/features/whitenoise/storage/dmIndex';
import { WhitenoiseGroupHistory } from '@/features/whitenoise/storage/groupHistory';
import { wipeWhitenoiseStorageForAccounts } from '@/features/whitenoise/storage/cleanup';
import { WhitenoiseNamespace, whitenoisePrefix } from '@/features/whitenoise/storage/namespaces';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@internet-privacy/marmot-ts', () => ({
  deserializeApplicationRumor: (bytes: Uint8Array) => {
    const rumor = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof rumor?.content !== 'string') throw new Error('not a rumor');
    return rumor;
  },
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { wnLog: log, log, storeLog: log, redactError: (e: unknown) => e };
});

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const GROUP = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

const serializeApplicationRumor = (value: object) =>
  new TextEncoder().encode(JSON.stringify(value));

function rumor(content: string, created_at: number) {
  return {
    id: '1'.repeat(64),
    pubkey: ALICE,
    created_at,
    kind: 9,
    tags: [],
    content,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(AsyncStorage.setItem).mockClear();
});

describe('the versioned envelope', () => {
  it('saves a value as {v:1,d} under prefix:key, with bytes and bigints tagged', async () => {
    const backend = new AsyncStorageKVBackend<unknown>('whitenoise:0:group-state');
    await backend.setItem('g1', {
      bytes: new Uint8Array([1, 2, 3]),
      epoch: 12345678901234567890n,
      name: 'x',
    });

    expect(await AsyncStorage.getItem('whitenoise:0:group-state:g1')).toBe(
      '{"v":1,"d":{"bytes":{"__u8b64__":"AQID"},"epoch":{"__bigint__":"12345678901234567890"},"name":"x"}}'
    );
  });

  it('reads a saved fixture back with real Uint8Array and bigint values', async () => {
    await AsyncStorage.setItem(
      'whitenoise:0:key-package:kp',
      '{"v":1,"d":{"bytes":{"__u8b64__":"AQID"},"lifetime":{"__bigint__":"18446744073709551615"},"nested":[{"__u8b64__":""}]}}'
    );
    const value = (await new AsyncStorageKVBackend<Record<string, unknown>>(
      'whitenoise:0:key-package'
    ).getItem('kp'))!;

    expect(value.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(value.bytes as Uint8Array)).toEqual([1, 2, 3]);
    expect(value.lifetime).toBe(18446744073709551615n);
    expect((value.nested as Uint8Array[])[0]).toBeInstanceOf(Uint8Array);
    expect((value.nested as Uint8Array[])[0]).toHaveLength(0);
  });

  it.each([
    ['a bare string from before the envelope', 'group-id-hex'],
    ['unparseable JSON', '{not json'],
    ['another envelope version', '{"v":2,"d":"x"}'],
    ['an object with no envelope', '{"d":"x"}'],
  ])('reads %s as absent', async (_label, raw) => {
    await AsyncStorage.setItem('whitenoise:0:dm-index:peer', raw);
    // QUIRK: a value this version cannot read is reported as missing, not as an
    // error, so callers recreate it. A later fix should change this on purpose.
    expect(await new AsyncStorageKVBackend('whitenoise:0:dm-index').getItem('peer')).toBeNull();
  });

  it('lets a storage read failure reject instead of reading as absent', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('io error'));
    await expect(
      new AsyncStorageKVBackend('whitenoise:0:dm-index').getItem('peer')
    ).rejects.toThrow('io error');
  });
});

describe('scoping', () => {
  it('builds one prefix per account and namespace', () => {
    expect(whitenoisePrefix(3, WhitenoiseNamespace.History)).toBe('whitenoise:3:history');
    expect(whitenoisePrefix(0, WhitenoiseNamespace.InviteSeen)).toBe('whitenoise:0:invite-seen');
  });

  it('keys, entries and clear see only their own prefix, even where indexes share digits', async () => {
    const one = new AsyncStorageKVBackend<string>(whitenoisePrefix(1, WhitenoiseNamespace.DmIndex));
    const ten = new AsyncStorageKVBackend<string>(
      whitenoisePrefix(10, WhitenoiseNamespace.DmIndex)
    );
    const oneState = new AsyncStorageKVBackend<string>(
      whitenoisePrefix(1, WhitenoiseNamespace.GroupState)
    );
    await one.setItem(ALICE, 'g-alice');
    await ten.setItem(BOB, 'g-bob');
    await oneState.setItem('g', 'state');
    await AsyncStorage.setItem(`${whitenoisePrefix(1, WhitenoiseNamespace.DmIndex)}:raw`, 'legacy');

    expect((await one.keys()).sort()).toEqual([ALICE, 'raw'].sort());
    // Values that cannot be read are left out of entries.
    expect(await one.entries()).toEqual([[ALICE, 'g-alice']]);

    await one.clear();
    expect(await one.keys()).toEqual([]);
    expect(await ten.getItem(BOB)).toBe('g-bob');
    expect(await oneState.getItem('g')).toBe('state');
  });
});

describe('the DM index', () => {
  it('maps a counterparty to a group per account and lists them', async () => {
    const account0 = new WhitenoiseDmIndex(0);
    const account1 = new WhitenoiseDmIndex(1);
    await account0.set(ALICE, 'group-a');
    await account0.set(BOB, 'group-b');
    await account1.set(ALICE, 'group-other');

    expect(await account0.get(ALICE)).toBe('group-a');
    expect(await account1.get(ALICE)).toBe('group-other');
    expect(await account1.get(BOB)).toBeNull();
    expect((await account0.list()).sort((x, y) => x.pubkey.localeCompare(y.pubkey))).toEqual([
      { pubkey: ALICE, groupIdHex: 'group-a' },
      { pubkey: BOB, groupIdHex: 'group-b' },
    ]);
  });
});

describe('the group history', () => {
  it('saves each message under the group id in hex and loads it back decoded', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const history = new WhitenoiseGroupHistory(0, GROUP);
    await history.saveMessage(serializeApplicationRumor(rumor('hello', 1)));

    expect(await AsyncStorage.getAllKeys()).toEqual(['whitenoise:0:history:deadbeef']);
    const loaded = await history.loadMessages();
    expect(loaded).toEqual([
      {
        rumor: expect.objectContaining({ content: 'hello', kind: 9 }),
        receivedAt: 1_700_000_000_000,
      },
    ]);
    jest.restoreAllMocks();
  });

  it('keeps both of two saves started together, in the order they were made', async () => {
    const history = new WhitenoiseGroupHistory(0, GROUP);
    await Promise.all([
      history.saveMessage(serializeApplicationRumor(rumor('sent', 1))),
      history.saveMessage(serializeApplicationRumor(rumor('received', 2))),
    ]);

    expect((await history.loadMessages()).map((m) => m.rumor.content)).toEqual([
      'sent',
      'received',
    ]);
  });

  it('a rejected save does not stop the next one', async () => {
    const history = new WhitenoiseGroupHistory(0, GROUP);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    const first = history.saveMessage(serializeApplicationRumor(rumor('lost', 1)));
    const second = history.saveMessage(serializeApplicationRumor(rumor('kept', 2)));
    await expect(first).rejects.toThrow('disk full');
    await second;

    expect((await history.loadMessages()).map((m) => m.rumor.content)).toEqual(['kept']);
  });

  it('skips a stored message that cannot be decoded and keeps the rest', async () => {
    const history = new WhitenoiseGroupHistory(0, GROUP);
    await history.saveMessage(new Uint8Array([1, 2, 3]));
    await history.saveMessage(serializeApplicationRumor(rumor('good', 3)));

    expect((await history.loadMessages()).map((m) => m.rumor.content)).toEqual(['good']);
  });

  it('histories are separate per account and per group, and purge removes only one', async () => {
    const mine = new WhitenoiseGroupHistory(0, GROUP);
    const otherAccount = new WhitenoiseGroupHistory(1, GROUP);
    const otherGroup = new WhitenoiseGroupHistory(0, new Uint8Array([1]));
    await mine.saveMessage(serializeApplicationRumor(rumor('mine', 1)));
    await otherAccount.saveMessage(serializeApplicationRumor(rumor('theirs', 1)));
    await otherGroup.saveMessage(serializeApplicationRumor(rumor('other group', 1)));

    await mine.purgeMessages();

    expect(await mine.loadMessages()).toEqual([]);
    expect((await otherAccount.loadMessages()).map((m) => m.rumor.content)).toEqual(['theirs']);
    expect((await otherGroup.loadMessages()).map((m) => m.rumor.content)).toEqual(['other group']);
  });
});

describe('the account wipe', () => {
  it('removes every Whitenoise namespace of the named accounts and nothing else', async () => {
    for (const ns of Object.values(WhitenoiseNamespace)) {
      await AsyncStorage.setItem(`${whitenoisePrefix(1, ns)}:k`, 'x');
      await AsyncStorage.setItem(`${whitenoisePrefix(2, ns)}:k`, 'x');
      await AsyncStorage.setItem(`${whitenoisePrefix(10, ns)}:k`, 'x');
    }
    await AsyncStorage.setItem('settings-store', '{}');

    await wipeWhitenoiseStorageForAccounts([1, 2]);

    const left = [...(await AsyncStorage.getAllKeys())].sort();
    expect(left).toEqual(
      [
        'settings-store',
        ...Object.values(WhitenoiseNamespace).map((ns) => `${whitenoisePrefix(10, ns)}:k`),
      ].sort()
    );
  });

  it('swallows a storage failure', async () => {
    jest.mocked(AsyncStorage.getAllKeys).mockRejectedValueOnce(new Error('io error'));
    await expect(wipeWhitenoiseStorageForAccounts([1])).resolves.toBeUndefined();
  });
});

/**
 * The ecash releases 0.0.1 to 0.0.40 stored themselves, claimed into the open
 * wallet. The row is built in the shapes the old reducers wrote. The mint is
 * faked at the HTTP boundary, so the requests and the error bodies go through
 * the real cashu-ts client, and Coco is faked at its receive operation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hashToCurve, MintOperationError } from '@cashu/cashu-ts';
import { UnknownMintError, type Manager } from '@cashu/coco-core';
import { readLegacyEcash } from 'wallet';

import { claimLegacyEcash, startLegacyEcashClaim } from '@/shared/lib/cashu/legacyEcashClaim';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import { legacyClaimPrompt, useLegacyEcashStore } from '@/shared/stores/global/legacyEcashStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => {
  const disk = new Map<string, string>();
  return {
    disk,
    getItem: jest.fn(async (key: string) => disk.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void disk.set(key, value)),
    removeItem: jest.fn(async (key: string) => void disk.delete(key)),
  };
});
/** What is on the phone's disk. Stores are loaded when imported, so the map lives in the mock. */
const mockDisk = (AsyncStorage as unknown as { disk: Map<string, string> }).disk;
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  ...jest.requireActual('@/shared/lib/nostr/secureStorage'),
  retrieveMnemonic: jest.fn(),
}));

const ROW = 'persist:SOVRAN';
const STORE = 'legacy-ecash-store';
const MINT = 'https://mint.example.com';
const KEYSET = '009a1f293253e41e';
/** A keyset id as mints issued them until early 2024: base64, not hex. */
const OLD_KEYSET = '9mlfd5vCzgGl';
// The published BIP-39 test phrases; no wallet holds them.
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PUBKEY_0 = 'a'.repeat(64);
const PUBKEY_1 = 'b'.repeat(64);
const HOUR_MS = 60 * 60 * 1000;
const START = 1_800_000_000_000;

/** Every proof a test has made, so the fakes can price a secret. */
const amounts = new Map<string, number>();
/** The point a mint knows a secret by (NUT-07), back to the secret. */
const secretByY = new Map<string, string>();
function proof(name: string, amount: number, id = KEYSET) {
  const secret = `secret-${name}`;
  amounts.set(secret, amount);
  secretByY.set(hashToCurve(new TextEncoder().encode(secret)).toHex(true), secret);
  return { id, amount, secret, C: `02${name}` };
}
const PROOFS = [proof('a', 64), proof('b', 32)];
const GROUP_ID = `0|${KEYSET}|${MINT}`;
const PROFILE_1_GROUP = `1|${KEYSET}|${MINT}`;

type QuoteAnswer =
  | { state: 'UNPAID' | 'PAID' | 'ISSUED'; expiry: number | null }
  | { status: number; body: unknown };

/** The mint: which proofs it has spent, what it signed, and how it answers. */
const mint = {
  reachable: true,
  spent: new Set<string>(),
  pending: new Set<string>(),
  /** Proofs whose signature the mint does not accept. */
  invalid: new Set<string>(),
  /** Outputs the mint signed, by receive operation: what a wallet can restore. */
  signed: new Map<string, number>(),
  quotes: new Map<string, QuoteAnswer>(),
  stateRequests: 0,
  quoteRequests: 0,
  /** While set, every request waits on it. */
  hold: null as Promise<void> | null,
};

function response(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

async function mintHttp(url: unknown, init?: { body?: string }) {
  const path = new URL(String(url)).pathname;
  if (mint.hold) await mint.hold;
  if (!mint.reachable) throw new TypeError('Network request failed');
  if (path === '/v1/info') return response(200, { name: 'Fixture mint', nuts: {} });
  if (path === '/v1/keysets') {
    return response(200, {
      keysets: [KEYSET, OLD_KEYSET].map((id) => ({ id, unit: 'sat', active: true })),
    });
  }
  if (path === '/v1/checkstate') {
    mint.stateRequests += 1;
    const { Ys } = JSON.parse(init?.body ?? '{}') as { Ys: string[] };
    return response(200, {
      states: Ys.map((Y) => {
        const secret = secretByY.get(Y) ?? '';
        const state = mint.spent.has(secret)
          ? 'SPENT'
          : mint.pending.has(secret)
            ? 'PENDING'
            : 'UNSPENT';
        return { Y, state, witness: null };
      }),
    });
  }
  const quoteId = /^\/v1\/mint\/quote\/bolt11\/(.+)$/.exec(path)?.[1];
  if (quoteId) {
    mint.quoteRequests += 1;
    // What nutshell sends for a quote it does not have.
    const answer = mint.quotes.get(quoteId) ?? {
      status: 400,
      body: { detail: 'quote not found', code: 0 },
    };
    if ('status' in answer) return response(answer.status, answer.body);
    return response(200, {
      quote: quoteId,
      request: 'lnbc1fixture',
      amount: 21,
      unit: 'sat',
      state: answer.state,
      expiry: answer.expiry,
    });
  }
  return response(404, { detail: 'Not Found' });
}

const mintRequest = jest.fn(mintHttp);

/** One profile as `helper/redux/cashu/reducer.ts` kept it at a09fe2d54. */
function oldProfile(proofs: Record<string, unknown> | unknown[], transactions: unknown[] = []) {
  return {
    selectedMint: MINT,
    mints: [MINT],
    proofs,
    counters: { [MINT]: { [KEYSET]: 12 } },
    keysets: {},
    transactions,
  };
}

/** The whole redux-persist row: every top-level value is itself a JSON string. */
function oldRow(profiles: unknown[], phrases: string[] = [PHRASE]): string {
  return JSON.stringify({
    cashu: JSON.stringify({
      profiles,
      keysets: { [MINT]: [{ id: KEYSET, unit: 'sat', active: true }] },
      keys: {},
      info: {},
    }),
    nostr: JSON.stringify({
      currentProfile: { id: 0, mnemonic: phrases[0], pubkey: PUBKEY_0 },
      profiles: phrases.map((mnemonic, index) => ({
        mnemonic,
        pubkey: index === 0 ? PUBKEY_0 : PUBKEY_1,
      })),
    }),
    settings: '{}',
    _persist: '{"version":120,"rehydrated":true}',
  });
}

/** A Lightning receive as 0.0.13 and later stored it (`helper/cashu/pay.ts` at a09fe2d54). */
const invoice = (quote: string, paid = false) => ({
  type: 'lightning',
  transactionType: 'receive',
  request: 'lnbc1fixture',
  mintQuote: { quote, request: 'lnbc1fixture' },
  mintUrl: MINT,
  amount: 21,
  unit: 'sat',
  paid,
});

interface Token {
  mint: string;
  unit: string;
  proofs: { id: string; secret: string; C: string; amount: { toNumber(): number } }[];
}

/**
 * One account's Coco, as the claim uses it. A receive counts only when its
 * outputs are saved: by execute, or by recovery restoring what the mint signed.
 */
function fakeCoco() {
  const coco = {
    trusted: new Set<string>([MINT]),
    stored: new Map<string, 'ready' | 'spent'>(),
    operations: new Map<string, { state: string; secrets: string[]; amount: number }>(),
    /** Every token handed to the receive, as it was handed over. */
    tokens: [] as Token[],
    /** Face value of the outputs this wallet saved, per receive. */
    saved: [] as number[],
    /** False when a restore from the mint finds nothing, as after a lost counter. */
    canRestoreOutputs: true,
    /** When set, the app dies right after the mint swaps: execute never returns normally. */
    killAfterSwap: null as null | (() => void),
    listeners: [] as { event: string; listener: () => void }[],
    manager(): Manager {
      const fake = {
        mint: { isTrustedMint: async (mintUrl: string) => coco.trusted.has(mintUrl) },
        proofRepository: {
          getProofsBySecrets: async (_mintUrl: string, secrets: string[]) =>
            secrets.flatMap((secret) => {
              const state = coco.stored.get(secret);
              return state ? [{ secret, state }] : [];
            }),
        },
        ops: {
          receive: {
            prepare: async ({ token }: { token: Token }) => {
              if (!coco.trusted.has(token.mint)) throw new UnknownMintError(`not trusted`);
              coco.tokens.push(token);
              const id = `op-${coco.operations.size + 1}`;
              const secrets = token.proofs.map((p) => p.secret);
              coco.operations.set(id, {
                state: 'prepared',
                secrets,
                amount: secrets.reduce((total, secret) => total + (amounts.get(secret) ?? 0), 0),
              });
              return { id };
            },
            execute: async (id: string) => {
              const operation = coco.operations.get(id)!;
              operation.state = 'executing';
              if (!mint.reachable) throw new TypeError('Network request failed');
              const refuse = (code: number, detail: string) => {
                operation.state = 'rolled_back';
                return new MintOperationError(code, detail);
              };
              if (operation.secrets.some((secret) => mint.invalid.has(secret))) {
                throw refuse(10003, 'Token not verified');
              }
              if (operation.secrets.some((secret) => mint.spent.has(secret))) {
                throw refuse(11001, 'Token already spent');
              }
              for (const secret of operation.secrets) mint.spent.add(secret);
              mint.signed.set(id, operation.amount);
              if (coco.killAfterSwap) {
                coco.killAfterSwap();
                throw new Error('process killed');
              }
              coco.saved.push(operation.amount);
              operation.state = 'finalized';
            },
            get: async (id: string) => coco.operations.get(id) ?? null,
            // Coco's recovery: spent inputs are not enough. The outputs have to
            // be restored from the mint and saved, or the receive is rolled back.
            refresh: async (id: string) => {
              const operation = coco.operations.get(id)!;
              if (operation.state !== 'executing') return operation;
              if (!operation.secrets.every((secret) => mint.spent.has(secret))) return operation;
              const restored = coco.canRestoreOutputs ? mint.signed.get(id) : undefined;
              if (restored === undefined) {
                operation.state = 'rolled_back';
                return operation;
              }
              coco.saved.push(restored);
              operation.state = 'finalized';
              return operation;
            },
            cancel: async (id: string) => void (coco.operations.get(id)!.state = 'rolled_back'),
          },
        },
        on: (event: string, listener: () => void) => {
          coco.listeners.push({ event, listener });
          return () => {};
        },
      };
      return fake as unknown as Manager;
    },
  };
  return coco;
}

let now = START;
/** A cold start: memory is empty, the store is read back from disk, a new wallet is opened. */
async function coldStart(): Promise<void> {
  const onDisk = mockDisk.get(STORE);
  useLegacyEcashStore.setState(useLegacyEcashStore.getInitialState(), true);
  if (onDisk === undefined) mockDisk.delete(STORE);
  else mockDisk.set(STORE, onDisk);
  jest.mocked(AsyncStorage.setItem).mockClear();
  await useLegacyEcashStore.persist.rehydrate();
}
async function launch(coco: ReturnType<typeof fakeCoco>, isLive = () => true): Promise<Manager> {
  await coldStart();
  const manager = coco.manager();
  await claimLegacyEcash(manager, isLive);
  return manager;
}
const group = (id = GROUP_ID) => useLegacyEcashStore.getState().groups[id];
const quotes = () => Object.values(useLegacyEcashStore.getState().quotes);
function restoreDisk(snapshot: Map<string, string>): void {
  mockDisk.clear();
  for (const [key, value] of snapshot) mockDisk.set(key, value);
}
/** Lets everything that can run without the held request run. */
const settle = async () => {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
};
const storeWrites = () =>
  jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === STORE).length;

beforeEach(async () => {
  mockDisk.clear();
  Object.assign(mint, { reachable: true, stateRequests: 0, quoteRequests: 0, hold: null });
  for (const set of [mint.spent, mint.pending, mint.invalid, mint.signed, mint.quotes]) set.clear();
  now = START;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mintRequest.mockClear();
  // cashu-ts calls the global fetch; this is the mint's side of the wire.
  Object.assign(globalThis, { fetch: mintRequest });
  jest.mocked(retrieveMnemonic).mockResolvedValue(PHRASE);
  await useProfileStore.persist.rehydrate();
  useProfileStore.setState({
    profiles: [{ accountIndex: 0, pubkey: PUBKEY_0, addedAt: START }],
    activeAccountIndex: 0,
  });
  useLegacyEcashStore.setState(useLegacyEcashStore.getInitialState(), true);
  mockDisk.delete(STORE);
  jest.mocked(AsyncStorage.setItem).mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('reading the old row', () => {
  it('groups proofs by old profile, mint and keyset, with the unit the old app cached', () => {
    const read = readLegacyEcash(
      oldRow(
        [oldProfile({ [MINT]: PROOFS }), oldProfile({ [MINT]: [proof('c', 8)] })],
        [PHRASE, PHRASE]
      )
    );
    expect(read).toEqual({
      kind: 'read',
      skipped: 0,
      mintQuotes: [],
      groups: [
        {
          id: GROUP_ID,
          profileIndex: 0,
          profilePubkeyHex: PUBKEY_0,
          mintUrl: MINT,
          keysetId: KEYSET,
          unit: 'sat',
          proofs: PROOFS,
        },
        {
          id: PROFILE_1_GROUP,
          profileIndex: 1,
          profilePubkeyHex: PUBKEY_1,
          mintUrl: MINT,
          keysetId: KEYSET,
          unit: 'sat',
          proofs: [proof('c', 8)],
        },
      ],
    });
  });

  it('skips and counts what it cannot read, and reads a profile created with `proofs: []`', () => {
    const read = readLegacyEcash(
      oldRow([
        oldProfile([]),
        oldProfile({
          [MINT]: [PROOFS[0], PROOFS[0], { id: KEYSET, amount: 1.5, secret: 's', C: 'c' }, null],
          'not a url': [proof('x', 1)],
        }),
        'garbage',
      ])
    );
    expect(read).toMatchObject({ kind: 'read', skipped: 4 });
    expect(read.kind === 'read' && read.groups.map((g) => g.proofs)).toEqual([[PROOFS[0]]]);
  });

  it('lists Lightning receives the old app never recorded as paid, in both shapes it stored', () => {
    // Up to 0.0.12 (`helper/cashu/lightning.ts` at 957eed9ea) the quote id sat on the transaction.
    const earliest = {
      request: 'lnbc1fixture',
      quote: 'q0',
      amount: 5,
      date: '2024-05-01T00:00:00.000Z',
      type: 'lightning',
      paid: false,
      transactionType: 'receive',
      unit: 'sat',
      mintUrl: MINT,
    };
    const paidOut = { type: 'lightning', transactionType: 'send', quote: 'melt', mintUrl: MINT };
    const read = readLegacyEcash(
      oldRow([oldProfile({}, [earliest, invoice('q1'), invoice('q2', true), paidOut])])
    );
    expect(read).toEqual({
      kind: 'read',
      groups: [],
      skipped: 0,
      mintQuotes: [
        { mintUrl: MINT, mintQuoteId: 'q0', amount: 5, unit: 'sat' },
        { mintUrl: MINT, mintQuoteId: 'q1', amount: 21, unit: 'sat' },
      ],
    });
  });

  it.each([null, 'not json', '[]', '{"cashu":"{broken"}', '{"cashu":"{\\"profiles\\":3}"}'])(
    'never throws on %p',
    (raw) => {
      expect(readLegacyEcash(raw).kind).toBe(raw === null ? 'none' : 'unreadable');
    }
  );
});

describe('claiming', () => {
  it('does nothing and asks no mint when there is no row', async () => {
    await launch(fakeCoco());
    expect(mintRequest).not.toHaveBeenCalled();
    expect(useLegacyEcashStore.getState().groups).toEqual({});
    expect(mockDisk.has(STORE)).toBe(false);
  });

  it.each(['not json', '{"cashu":"{broken"}'])('leaves a malformed row %p alone', async (raw) => {
    mockDisk.set(ROW, raw);
    const coco = fakeCoco();
    await expect(launch(coco)).resolves.toBeDefined();
    expect(mockDisk.get(ROW)).toBe(raw);
    expect(mintRequest).not.toHaveBeenCalled();
    expect(coco.operations.size).toBe(0);
  });

  it('settles proofs the mint reports spent, removes the row and leaves a note', async () => {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS })]));
    for (const { secret } of PROOFS) mint.spent.add(secret);
    const coco = fakeCoco();

    await launch(coco);

    expect(group()).toMatchObject({ status: 'settled', spent: 96, claimed: 0, attempts: 0 });
    expect(coco.operations.size).toBe(0);
    expect(mockDisk.has(ROW)).toBe(false);
    expect(useLegacyEcashStore.getState().rowRemoved).toEqual({
      at: START,
      groups: 1,
      claimed: {},
      spent: { sat: 96 },
      inWallet: {},
    });

    await launch(coco);
    expect(mint.stateRequests).toBe(1);
  });

  it('receives unspent proofs at a trusted mint once, through the wallet, then removes the row', async () => {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS })]));
    const coco = fakeCoco();

    await launch(coco);

    expect(coco.saved).toEqual([96]);
    expect(group()).toMatchObject({ status: 'settled', claimed: 96, spent: 0, claiming: null });
    expect(mockDisk.has(ROW)).toBe(false);
    expect(useLegacyEcashStore.getState().rowRemoved).toMatchObject({ claimed: { sat: 96 } });

    await launch(coco);
    expect(coco.saved).toEqual([96]);
    expect(mint.stateRequests).toBe(1);
  });

  it('hands 2024 proofs with a base64 keyset id to the wallet unchanged', async () => {
    const old = [proof('old-a', 4, OLD_KEYSET), proof('old-b', 2, OLD_KEYSET)];
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: old })]));
    const coco = fakeCoco();

    await launch(coco);

    // The row never cached this keyset's unit, so the mint's own list supplied it.
    expect(
      coco.tokens.map(({ mint: mintUrl, unit, proofs }) => ({
        mintUrl,
        unit,
        proofs: proofs.map((p) => ({ ...p, amount: p.amount.toNumber() })),
      }))
    ).toEqual([{ mintUrl: MINT, unit: 'sat', proofs: old }]);
    expect(coco.saved).toEqual([6]);
    expect(group(`0|${OLD_KEYSET}|${MINT}`)).toMatchObject({ status: 'settled', claimed: 6 });
  });

  it('does not receive a proof an earlier release already imported into this wallet', async () => {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS })]));
    const coco = fakeCoco();
    coco.stored.set(PROOFS[0].secret, 'ready');

    await launch(coco);

    expect(coco.saved).toEqual([32]);
    expect(group()).toMatchObject({ status: 'settled', inWallet: 64, claimed: 32 });
  });

  it('leaves a proof the mint reports pending neither spent nor claimed, and the group open', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    mint.pending.add(PROOFS[1].secret);
    const coco = fakeCoco();

    await launch(coco);

    expect(coco.tokens.map((token) => token.proofs.map((p) => p.secret))).toEqual([
      [PROOFS[0].secret],
    ]);
    expect(group()).toMatchObject({
      status: 'open',
      claimed: 64,
      spent: 0,
      failed: 0,
      attempts: 1,
      lastError: 'pending',
    });
    expect(group().done).toHaveLength(1);
    expect(mockDisk.get(ROW)).toBe(row);

    // The mint finished with it: the other party took it.
    mint.pending.clear();
    mint.spent.add(PROOFS[1].secret);
    now += HOUR_MS;
    await launch(coco);
    expect(group()).toMatchObject({ status: 'settled', claimed: 64, spent: 32 });
    expect(coco.saved).toEqual([64]);
  });

  it('claims the good proofs of a batch in which the mint rejects one, and keeps the row for that one', async () => {
    const many = Array.from({ length: 7 }, (_, index) => proof(`m${index}`, 1));
    const row = oldRow([oldProfile({ [MINT]: many })]);
    mockDisk.set(ROW, row);
    mint.invalid.add(many[4].secret);
    const coco = fakeCoco();

    await launch(coco);

    expect(coco.saved.reduce((total, amount) => total + amount, 0)).toBe(6);
    expect([...mint.spent].sort()).toEqual(
      many
        .filter((_, index) => index !== 4)
        .map((p) => p.secret)
        .sort()
    );
    expect(group()).toMatchObject({
      status: 'could-not-claim',
      claimed: 6,
      failed: 1,
      lastError: 'proofs-rejected',
      claiming: null,
    });
    expect(mockDisk.get(ROW)).toBe(row);

    const receives = coco.operations.size;
    now += 365 * 24 * HOUR_MS;
    await launch(coco);
    expect(coco.operations.size).toBe(receives);
    expect(mint.stateRequests).toBe(1);
  });

  it('never removes the row, and never asks again, on a phone that stores a different phrase', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    jest.mocked(retrieveMnemonic).mockResolvedValue(OTHER_PHRASE);
    for (const { secret } of PROOFS) mint.spent.add(secret);
    const coco = fakeCoco();

    await launch(coco);
    now += 30 * 24 * HOUR_MS;
    await launch(coco);

    expect(group()).toMatchObject({ status: 'settled', spent: 96 });
    expect(mockDisk.get(ROW)).toBe(row);
    expect(useLegacyEcashStore.getState().rowRemoved).toBeNull();
    expect(mint.stateRequests).toBe(1);
  });

  it('keeps a row that holds a second phrase the phone does not store', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })], [PHRASE, OTHER_PHRASE]);
    mockDisk.set(ROW, row);
    for (const { secret } of PROOFS) mint.spent.add(secret);

    await launch(fakeCoco());

    expect(group().status).toBe('settled');
    expect(mockDisk.get(ROW)).toBe(row);
  });

  it('keeps the row while it holds an entry it could not read', async () => {
    const row = oldRow([oldProfile({ [MINT]: [...PROOFS, { amount: 4 }] })]);
    mockDisk.set(ROW, row);

    await launch(fakeCoco());

    expect(group()).toMatchObject({ status: 'settled', claimed: 96 });
    expect(mockDisk.get(ROW)).toBe(row);
  });

  it('gives up on a mint that never answers after five spaced attempts and keeps the row', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    mint.reachable = false;
    const coco = fakeCoco();
    const requests = () => mintRequest.mock.calls.length;

    await launch(coco);
    expect(group()).toMatchObject({ status: 'open', attempts: 1, lastError: 'transient' });
    // A relaunch inside the wait does not ask again.
    const afterFirst = requests();
    now += HOUR_MS - 1;
    await launch(coco);
    expect(requests()).toBe(afterFirst);

    for (const [attempt, waitHours] of [1, 24, 72, 168].entries()) {
      now += waitHours * HOUR_MS;
      await launch(coco);
      expect(group().attempts).toBe(attempt + 2);
    }
    const afterLast = requests();
    expect(group()).toMatchObject({
      status: 'could-not-claim',
      attempts: 5,
      failed: 96,
      claimed: 0,
      lastError: 'transient',
    });

    mint.reachable = true;
    now += 365 * 24 * HOUR_MS;
    await launch(coco);
    expect(requests()).toBe(afterLast);
    expect(coco.saved).toEqual([]);
    expect(mockDisk.get(ROW)).toBe(row);
  });

  it('receives nothing when the record of the claim cannot be saved, and claims once it can', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    const coco = fakeCoco();
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      if (key === STORE) throw new Error('database or disk is full');
      mockDisk.set(key, value);
    });

    await expect(launch(coco)).resolves.toBeDefined();

    expect(coco.saved).toEqual([]);
    expect(mint.spent.size).toBe(0);
    expect(mockDisk.has(STORE)).toBe(false);
    expect(mockDisk.get(ROW)).toBe(row);

    jest
      .mocked(AsyncStorage.setItem)
      .mockImplementation(async (key, value) => void mockDisk.set(key, value));
    await launch(coco);
    expect(coco.saved).toEqual([96]);
    expect(group()).toMatchObject({ status: 'settled', claimed: 96 });
  });
});

describe('a row that holds nothing', () => {
  /**
   * `persist:SOVRAN` as a 0.0.63 build (28bf7713a) wrote it on an iPhone
   * simulator: redux's initial state, with every field of the one profile
   * empty. Copied from that run, less the list of public profile cards under
   * `nostr.search`. Every install from 0.0.45 to 0.1.1 has this row.
   */
  const row0063 = (profile: Record<string, unknown> = {}, proofs: unknown = {}) =>
    JSON.stringify({
      settings: JSON.stringify({
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 3,
          passcode: '',
          experimental: false,
          termsAccepted: null,
        },
      }),
      cashu: JSON.stringify({
        profiles: [{ mints: [], proofs, counters: {}, keysets: {}, transactions: [] }],
        audits: {},
        info: {},
        keys: {},
        keysets: {},
        allocation: {},
      }),
      nostr: JSON.stringify({
        currentProfile: { id: 0 },
        search: [],
        profiles: [
          {
            id: 0,
            mnemonic: '',
            pubkey: '',
            profile: { created_at: 0, profileEvent: '', name: '', picture: '', image: '' },
            npub: '',
            nsec: '',
            mints: [],
            picture: '',
            root: { xpub: '', xpriv: '' },
            nut13: '',
            ...profile,
          },
        ],
        messages: { loaded_messages: [] },
        follows: {},
        contacts: [],
      }),
      _persist: '{"version":251,"rehydrated":true}',
    });

  it('removes the row a 0.0.63 build wrote, with a note and no mint request, and then does nothing', async () => {
    mockDisk.set(ROW, row0063());
    const coco = fakeCoco();

    await launch(coco);

    expect(mockDisk.has(ROW)).toBe(false);
    expect(useLegacyEcashStore.getState()).toMatchObject({
      groups: {},
      quotes: {},
      rowRemoved: { at: START, groups: 0, claimed: {}, spent: {}, inWallet: {} },
    });
    expect(mintRequest).not.toHaveBeenCalled();
    expect(coco.operations.size).toBe(0);

    const afterFirst = mockDisk.get(STORE);
    now += 24 * HOUR_MS;
    await launch(coco);
    expect(storeWrites()).toBe(0);
    expect(mockDisk.get(STORE)).toBe(afterFirst);
    expect(mintRequest).not.toHaveBeenCalled();
  });

  it('removes it on a phone whose SecureStore holds no phrase to compare with', async () => {
    mockDisk.set(ROW, row0063());
    jest.mocked(retrieveMnemonic).mockResolvedValue(null);

    await launch(fakeCoco());

    expect(mockDisk.has(ROW)).toBe(false);
  });

  it('keeps a row with no ecash whose phrase is not the stored one', async () => {
    const row = row0063({ mnemonic: OTHER_PHRASE });
    mockDisk.set(ROW, row);

    await launch(fakeCoco());

    expect(mockDisk.get(ROW)).toBe(row);
    expect(useLegacyEcashStore.getState().rowRemoved).toBeNull();
    expect(mintRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['a Nostr key', { nsec: 'nsec1fixture' }],
    ['a root key', { root: { xpub: '', xpriv: 'xprvfixture' } }],
    ['a Cashu phrase', { nut13: OTHER_PHRASE }],
  ])('keeps a row whose profile holds %s and no phrase to derive it from', async (_name, held) => {
    const row = row0063(held);
    mockDisk.set(ROW, row);

    await launch(fakeCoco());

    expect(mockDisk.get(ROW)).toBe(row);
  });

  it('claims a proof from a row with an empty phrase the normal way, then removes the row', async () => {
    mockDisk.set(ROW, row0063({}, { [MINT]: [PROOFS[0]] }));
    const coco = fakeCoco();

    await launch(coco);

    // The row never cached the keyset's unit, so the mint's own list supplied it.
    expect(coco.saved).toEqual([64]);
    expect(group()).toMatchObject({ status: 'settled', claimed: 64, unit: 'sat' });
    expect(mockDisk.has(ROW)).toBe(false);
    expect(useLegacyEcashStore.getState().rowRemoved).toMatchObject({
      groups: 1,
      claimed: { sat: 64 },
    });
  });

  it('keeps that row while its proof is unsettled', async () => {
    const row = row0063({}, { [MINT]: [PROOFS[0]] });
    mockDisk.set(ROW, row);
    mint.reachable = false;

    await launch(fakeCoco());

    expect(group()).toMatchObject({ status: 'open', attempts: 1 });
    expect(mockDisk.get(ROW)).toBe(row);
  });
});

describe('a claim interrupted between the mint’s swap and the record', () => {
  async function killDuringClaim(coco: ReturnType<typeof fakeCoco>) {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS })]));
    let diskAtKill = new Map<string, string>();
    coco.killAfterSwap = () => {
      diskAtKill = new Map(mockDisk);
    };
    await launch(coco);
    // Only what had reached the disk when the process died survives it.
    expect(JSON.parse(diskAtKill.get(STORE)!).state.groups[GROUP_ID]).toMatchObject({
      claimed: 0,
      claiming: { operationId: 'op-1', amount: 96 },
    });
    return diskAtKill;
  }

  it('counts the value once when the wallet restores the outputs', async () => {
    const coco = fakeCoco();
    // The process is dead: nothing in it recovers anything before the relaunch.
    coco.canRestoreOutputs = false;
    const diskAtKill = await killDuringClaim(coco);
    const afterKill = fakeCoco();
    afterKill.operations.set('op-1', {
      state: 'executing',
      secrets: PROOFS.map((p) => p.secret),
      amount: 96,
    });
    restoreDisk(diskAtKill);

    await launch(afterKill);

    expect(afterKill.saved).toEqual([96]);
    expect(afterKill.operations.size).toBe(1);
    expect(group()).toMatchObject({ status: 'settled', claimed: 96, spent: 0, claiming: null });
    expect(mockDisk.has(ROW)).toBe(false);
  });

  it('records the proofs as spent, not claimed, when the wallet could not restore the outputs', async () => {
    const coco = fakeCoco();
    coco.canRestoreOutputs = false;
    const diskAtKill = await killDuringClaim(coco);
    const afterKill = fakeCoco();
    afterKill.canRestoreOutputs = false;
    afterKill.operations.set('op-1', {
      state: 'executing',
      secrets: PROOFS.map((p) => p.secret),
      amount: 96,
    });
    restoreDisk(diskAtKill);

    await launch(afterKill);

    expect(afterKill.saved).toEqual([]);
    expect(afterKill.operations.size).toBe(1);
    expect(group()).toMatchObject({ status: 'settled', claimed: 0, spent: 96, claiming: null });
  });

  it('settles as spent, without a second receive, when the wallet has no record of the claim', async () => {
    const coco = fakeCoco();
    coco.canRestoreOutputs = false;
    restoreDisk(await killDuringClaim(coco));
    const reset = fakeCoco();

    await launch(reset);

    expect(reset.operations.size).toBe(0);
    expect(group()).toMatchObject({ status: 'settled', claimed: 0, spent: 96, claiming: null });
  });
});

describe('old Lightning invoices', () => {
  const rowWith = (quote: string) => oldRow([oldProfile({}, [invoice(quote)])]);
  const exhaust = async () => {
    for (const waitHours of [0, 1, 24, 72, 168]) {
      now += waitHours * HOUR_MS;
      await launch(fakeCoco());
    }
  };

  it('keeps the row and records an invoice the mint holds paid and unminted', async () => {
    mockDisk.set(ROW, rowWith('q1'));
    mint.quotes.set('q1', { state: 'PAID', expiry: 1 });

    await launch(fakeCoco());
    await launch(fakeCoco());

    expect(quotes()).toEqual([
      {
        mintUrl: MINT,
        amount: 21,
        unit: 'sat',
        status: 'paid-unclaimed',
        attempts: 0,
        nextAttemptAt: 0,
      },
    ]);
    expect(mint.quoteRequests).toBe(1);
    expect(mockDisk.get(ROW)).toBe(rowWith('q1'));
  });

  it.each([
    ['never paid and expired', { state: 'UNPAID', expiry: START / 1000 - 1 }],
    ['already minted', { state: 'ISSUED', expiry: 1 }],
    ['unknown to nutshell', { status: 400, body: { detail: 'quote not found', code: 0 } }],
    ['unknown to cdk', { status: 400, body: { detail: 'Unknown quote', code: 50000 } }],
  ] as const)('removes the row when the invoice is %s', async (_name, answer) => {
    mockDisk.set(ROW, rowWith('q1'));
    mint.quotes.set('q1', answer);

    await launch(fakeCoco());

    expect(quotes()).toMatchObject([{ status: 'nothing-to-claim', attempts: 0 }]);
    expect(mockDisk.has(ROW)).toBe(false);
  });

  it.each([
    [
      'cdk does not know the payment state',
      { status: 400, body: { detail: 'Payment state is unknown', code: 50000 } },
    ],
    [
      'cdk reports a database error under the same code',
      { status: 400, body: { detail: 'Database error', code: 50000 } },
    ],
    [
      'nutshell fails for another reason',
      { status: 400, body: { detail: 'backend not connected', code: 0 } },
    ],
    ['the mint refuses the request', { status: 401, body: { detail: 'Unauthorized' } }],
    ['the mint is broken', { status: 500, body: { detail: 'Internal Server Error' } }],
    ['the invoice is unpaid and not known to have expired', { state: 'UNPAID', expiry: null }],
  ] as const)('keeps the row when %s', async (_name, answer) => {
    mockDisk.set(ROW, rowWith('q1'));
    mint.quotes.set('q1', answer);

    await launch(fakeCoco());
    expect(quotes()).toMatchObject([{ status: 'open', attempts: 1 }]);
    expect(mockDisk.get(ROW)).toBe(rowWith('q1'));

    await exhaust();
    expect(quotes()).toMatchObject([{ status: 'unresolved', attempts: 5 }]);
    expect(mint.quoteRequests).toBe(5);
    expect(mockDisk.get(ROW)).toBe(rowWith('q1'));

    now += 365 * 24 * HOUR_MS;
    await launch(fakeCoco());
    expect(mint.quoteRequests).toBe(5);
  });

  it('keeps the row when the mint never answers about the invoice', async () => {
    mockDisk.set(ROW, rowWith('q1'));
    mint.reachable = false;

    await launch(fakeCoco());
    await exhaust();

    expect(quotes()).toMatchObject([{ status: 'unresolved', attempts: 5 }]);
    expect(mockDisk.get(ROW)).toBe(rowWith('q1'));
  });
});

describe('old profiles and accounts', () => {
  const twoProfiles = () =>
    oldRow([oldProfile({}), oldProfile({ [MINT]: PROOFS })], [PHRASE, PHRASE]);
  const twoAccounts = (activeAccountIndex: number) =>
    useProfileStore.setState({
      profiles: [
        { accountIndex: 0, pubkey: PUBKEY_0, addedAt: START },
        { accountIndex: 1, pubkey: PUBKEY_1, addedAt: START },
      ],
      activeAccountIndex,
    });

  it('claims an old profile that is no account on this phone into account 0', async () => {
    mockDisk.set(ROW, twoProfiles());
    const coco = fakeCoco();

    await launch(coco);

    expect(coco.saved).toEqual([96]);
    expect(group(PROFILE_1_GROUP)).toMatchObject({ status: 'settled', accountIndex: 0 });
  });

  it('claims nothing into another account until account 0 has been opened', async () => {
    mockDisk.set(ROW, twoProfiles());
    twoAccounts(1);
    const second = fakeCoco();

    await launch(second);

    expect(second.operations.size).toBe(0);
    expect(mintRequest).not.toHaveBeenCalled();
    expect(group(PROFILE_1_GROUP)).toBeUndefined();
    expect(mockDisk.has(ROW)).toBe(true);
  });

  it('compares with account 0 first, then claims the rest into the profile’s own account', async () => {
    mockDisk.set(ROW, twoProfiles());
    twoAccounts(0);
    const first = fakeCoco();
    const second = fakeCoco();

    await launch(first);
    expect(first.operations.size).toBe(0);
    expect(mintRequest).not.toHaveBeenCalled();
    expect(group(PROFILE_1_GROUP)).toMatchObject({
      status: 'open',
      accountIndex: 1,
      firstAccountComparison: 'compared',
      inWallet: 0,
    });
    expect(mockDisk.has(ROW)).toBe(true);

    twoAccounts(1);
    await launch(second);
    expect(second.saved).toEqual([96]);
    expect(group(PROFILE_1_GROUP)).toMatchObject({ status: 'settled', claimed: 96 });
    expect(mockDisk.has(ROW)).toBe(false);
  });

  it('never swaps proofs that 0.0.45 to 0.0.56 imported into account 0 into the profile’s own account', async () => {
    mockDisk.set(ROW, twoProfiles());
    twoAccounts(0);
    const first = fakeCoco();
    first.stored.set(PROOFS[0].secret, 'ready');
    const second = fakeCoco();

    await launch(first);
    expect(group(PROFILE_1_GROUP)).toMatchObject({ status: 'open', inWallet: 64 });

    twoAccounts(1);
    await launch(second);

    expect(second.tokens.map((token) => token.proofs.map((p) => p.secret))).toEqual([
      [PROOFS[1].secret],
    ]);
    expect(mint.spent.has(PROOFS[0].secret)).toBe(false);
    expect(second.saved).toEqual([32]);
    expect(group(PROFILE_1_GROUP)).toMatchObject({ status: 'settled', inWallet: 64, claimed: 32 });
  });

  it('claims into the lowest account, without waiting, on a phone that has no account 0', async () => {
    mockDisk.set(
      ROW,
      oldRow(
        [oldProfile({ [MINT]: PROOFS }), oldProfile({ [MINT]: [proof('c', 8)] })],
        [PHRASE, PHRASE]
      )
    );
    // Account 0 was removed; an account at index 2 has nothing to do with the old profiles.
    useProfileStore.setState({
      profiles: [
        { accountIndex: 2, pubkey: 'c'.repeat(64), addedAt: START },
        { accountIndex: 1, pubkey: PUBKEY_1, addedAt: START },
      ],
      activeAccountIndex: 1,
    });
    const second = fakeCoco();

    await launch(second);

    expect(second.saved).toEqual([96, 8]);
    expect(group()).toMatchObject({
      status: 'settled',
      accountIndex: 1,
      claimed: 96,
      firstAccountComparison: 'no-first-account',
    });
    expect(group(PROFILE_1_GROUP)).toMatchObject({
      status: 'settled',
      accountIndex: 1,
      firstAccountComparison: 'no-first-account',
    });
    expect(mockDisk.has(ROW)).toBe(false);
  });

  it('moves a group to an account that exists when the one it was recorded for is removed', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    const first = fakeCoco();
    first.trusted.clear();
    await launch(first);
    expect(group()).toMatchObject({ status: 'awaiting-trust', accountIndex: 0 });

    useProfileStore.setState({
      profiles: [{ accountIndex: 3, pubkey: 'c'.repeat(64), addedAt: START }],
      activeAccountIndex: 3,
    });
    const third = fakeCoco();
    await launch(third);

    expect(third.saved).toEqual([96]);
    expect(group()).toMatchObject({ status: 'settled', accountIndex: 3, claimed: 96 });
    expect(mockDisk.has(ROW)).toBe(false);
  });

  it('still waits when account 0 exists and is not the open account', async () => {
    mockDisk.set(ROW, twoProfiles());
    twoAccounts(1);
    const second = fakeCoco();

    await launch(second);
    now += 30 * 24 * HOUR_MS;
    await launch(second);

    expect(second.operations.size).toBe(0);
    expect(mintRequest).not.toHaveBeenCalled();
    expect(group(PROFILE_1_GROUP)).toBeUndefined();
    expect(mockDisk.has(ROW)).toBe(true);
  });

  it('settles a group account 0 holds entirely without opening the other account', async () => {
    mockDisk.set(ROW, twoProfiles());
    twoAccounts(0);
    const first = fakeCoco();
    for (const { secret } of PROOFS) first.stored.set(secret, 'ready');

    await launch(first);

    expect(mintRequest).not.toHaveBeenCalled();
    expect(group(PROFILE_1_GROUP)).toMatchObject({ status: 'settled', inWallet: 96, claimed: 0 });
    expect(mockDisk.has(ROW)).toBe(false);
  });
});

describe('a wallet that closes while the claim is running', () => {
  it('does nothing at all when the wallet is already closed', async () => {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS }, [invoice('q1')])]));
    const coco = fakeCoco();

    await launch(coco, () => false);

    expect(mintRequest).not.toHaveBeenCalled();
    expect(coco.operations.size).toBe(0);
    expect(storeWrites()).toBe(0);
  });

  it.each([
    ['proof states', oldRow([oldProfile({ [MINT]: PROOFS })])],
    ['an old invoice', oldRow([oldProfile({}, [invoice('q1')])])],
  ])(
    'writes nothing after delete-all wiped storage during a request for %s',
    async (_name, row) => {
      mockDisk.set(ROW, row);
      let answer = () => {};
      mint.hold = new Promise((resolve) => (answer = resolve));
      let live = true;
      const coco = fakeCoco();
      const running = launch(coco, () => live);
      await settle();
      expect(mintRequest).toHaveBeenCalledTimes(1);

      // Delete-all: the wallet is closed, then every key is removed.
      live = false;
      mockDisk.clear();
      jest.mocked(AsyncStorage.setItem).mockClear();
      answer();
      await running;

      expect([...mockDisk.keys()]).toEqual([]);
      expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
      expect(coco.operations.size).toBe(0);
      expect(mint.spent.size).toBe(0);
    }
  );

  it('prepares and receives nothing after an account switch during a request', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    let answer = () => {};
    mint.hold = new Promise((resolve) => (answer = resolve));
    let live = true;
    const coco = fakeCoco();
    const running = launch(coco, () => live);
    await settle();
    const writesBefore = storeWrites();

    live = false;
    answer();
    await running;

    expect(storeWrites()).toBe(writesBefore);
    expect(coco.operations.size).toBe(0);
    expect(mockDisk.get(ROW)).toBe(row);

    // The next time this account is open the claim simply runs.
    mint.hold = null;
    await launch(coco);
    expect(coco.saved).toEqual([96]);
  });

  it('does not send a receive it prepared before the wallet closed', async () => {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS })]));
    let live = true;
    const coco = fakeCoco();
    const manager = coco.manager();
    const prepare = manager.ops.receive.prepare.bind(manager.ops.receive);
    manager.ops.receive.prepare = async (input) => {
      const prepared = await prepare(input);
      live = false;
      return prepared;
    };
    await coldStart();

    await claimLegacyEcash(manager, () => live);

    expect(coco.operations.get('op-1')).toMatchObject({ state: 'prepared' });
    expect(mint.spent.size).toBe(0);
    expect(group().claiming).toBeNull();
  });
});

describe('a mint the wallet does not trust', () => {
  const prompt = () => legacyClaimPrompt(useLegacyEcashStore.getState().groups, 0);

  it('claims nothing, asks the person, and asks again on the next launch without asking the mint', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    const coco = fakeCoco();
    coco.trusted.clear();

    await launch(coco);

    expect(coco.operations.size).toBe(0);
    expect(coco.trusted.size).toBe(0);
    expect(group()).toMatchObject({ status: 'awaiting-trust', awaiting: 96, attempts: 0 });
    expect(prompt()).toEqual({ mintUrl: MINT, amount: 96, unit: 'sat' });

    now += 7 * 24 * HOUR_MS;
    await launch(coco);
    expect(prompt()).toEqual({ mintUrl: MINT, amount: 96, unit: 'sat' });
    expect(mintRequest).toHaveBeenCalledTimes(1);
    expect(mockDisk.get(ROW)).toBe(row);
  });

  it('claims as soon as the person trusts the mint', async () => {
    mockDisk.set(ROW, oldRow([oldProfile({ [MINT]: PROOFS })]));
    const coco = fakeCoco();
    coco.trusted.clear();
    await coldStart();
    const manager = coco.manager();
    await startLegacyEcashClaim(manager, () => true);
    expect(prompt()).not.toBeNull();

    coco.trusted.add(MINT);
    coco.listeners.find(({ event }) => event === 'mint:trusted')!.listener();
    await claimLegacyEcash(manager, () => true);

    expect(coco.saved).toEqual([96]);
    expect(prompt()).toBeNull();
    expect(group()).toMatchObject({ status: 'settled', claimed: 96, awaiting: 0 });
    expect(mockDisk.has(ROW)).toBe(false);
  });

  it('stops asking once declined, keeps the proofs, and claims if the mint is trusted later', async () => {
    const row = oldRow([oldProfile({ [MINT]: PROOFS })]);
    mockDisk.set(ROW, row);
    const coco = fakeCoco();
    coco.trusted.clear();
    await launch(coco);

    useLegacyEcashStore.getState().leaveUnclaimed(MINT, 0);
    await launch(coco);

    expect(prompt()).toBeNull();
    expect(group().status).toBe('left-unclaimed');
    expect(mockDisk.get(ROW)).toBe(row);
    expect(mintRequest).toHaveBeenCalledTimes(1);

    coco.trusted.add(MINT);
    await launch(coco);
    expect(coco.saved).toEqual([96]);
    expect(group().status).toBe('settled');
  });
});

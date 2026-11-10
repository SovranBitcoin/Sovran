/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * What 0.1.4 writes outside the store registry, read back after the upgrade.
 *
 * The release-fixture runner reads every persisted store, but the
 * nearby-payment journal and the Routstr SDK's recovery records live in
 * secure vaults, and Whitenoise in its own AsyncStorage namespace, so the
 * runner only checks that their bytes are kept (`keptSecureStore`,
 * `keptAsyncStorage` in `releaseFixtures/E20-0.1.4.ts`). This starts the app
 * over E20 three times with the runner's own launch and then reads each one
 * through the code that owns it.
 *
 * The rows themselves are `releaseFixtures/E20-0.1.4.records.json`, written by
 * this build's code (the journal, the SDK storage driver, the Whitenoise
 * backend) over the upgraded disk:
 *
 *   cd app && WRITE_E20_RECORDS=1 bun run test -- __tests__/releaseFixtureE20Records.test.ts --runInBand
 *
 * Shapes, at 87b8afffe (0.1.4 is not cut yet):
 * - journal: features/nearPay/lib/nearbyPayments.ts:45-68 (`version: 1`), written by `bind` :108,
 *   with the delivery `captureNearbyDelivery` makes (:411-419);
 * - SDK record: `xcashu_tokens` as @routstr/sdk 0.4.6 declares it
 *   (dist/store-VDJfxChl.d.ts:124-129), through shared/lib/routstr/sdk/driver.ts:61;
 * - Whitenoise: features/whitenoise/storage/asyncStorageBackend.ts:104 (`{ v: 1, d }`, bytes as
 *   `__u8b64__`), unchanged since 0.1.0; prefixes namespaces.ts:27; group state keyed by the
 *   group id in hex as marmot-ts's `KeyValueGroupStateBackend` does.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Amount,
  getEncodedToken,
  PaymentRequest,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import { nprofileEncode } from 'nostr-tools/nip19';
import type { BitchatBLEIdentityMaterial } from 'bitchat-module';

// Mocks storage with in-memory maps; nothing above loads storage.
import { install, launch, rejectionsOfLastLaunchSoFar, snapshot } from './releaseFixtures/launch';
import { fixture as E20 } from './releaseFixtures/E20-0.1.4';
import records from './releaseFixtures/E20-0.1.4.records.json';
import upgraded from './releaseFixtures/E20-0.1.4.upgraded.json';
import { ACCOUNTS } from './releaseFixtures/format';
import type { ReleaseFixture } from './releaseFixtures/format';

// Each case starts the whole app over a disk; allow what the fixture runner allows.
jest.setTimeout(120_000);

const A0 = ACCOUNTS[0].pubkey;
/** The account E20 has selected: the journal belongs to the active profile. */
const A1 = ACCOUNTS[1].pubkey;
const MINT = 'https://mint.example/Bitcoin';
const RECIPIENT = ACCOUNTS[2].pubkey;

const OPERATION_ID = 'send-op-fixture-1';
const DELIVERY = {
  peerID: '0123456789abcdef',
  pubkey: RECIPIENT,
  creq: new PaymentRequest(
    [{ type: PaymentRequestTransportType.NOSTR, target: nprofileEncode({ pubkey: RECIPIENT }) }],
    'nearby-request-fixture',
    undefined,
    'sat',
    [MINT],
    undefined,
    false,
    { kind: 'P2PK', data: `02${RECIPIENT}`, tags: [] }
  ).toEncodedRequest(),
  sessionID: 'nearby-session-fixture',
  bleAccepted: false,
  nostrAccepted: false,
  nextAttemptAt: 0,
};
const XCASHU_TOKENS = {
  'https://node.example/': [
    {
      baseUrl: 'https://node.example/',
      token: getEncodedToken({
        mint: MINT,
        unit: 'sat',
        proofs: [
          {
            id: '00ad268c4d1f5826',
            amount: Amount.from(8),
            secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
            C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
          },
        ],
      }),
      createdAt: 1_789_400_000_000,
      tryCount: 2,
    },
  ],
};
const GROUP_ID_HEX = '9a'.repeat(32);
const GROUP_STATE = Uint8Array.from({ length: 48 }, (_, index) => (index * 37) % 256);
const DM_PEER = ACCOUNTS[2].pubkey;

/** The active account's radio identity; only an inbound payment would read it. */
const IDENTITY: BitchatBLEIdentityMaterial = {
  version: 'sovran-bitchat-ble-v1',
  nostrPubkey: A1,
  noisePrivateKeyHex: '01'.repeat(32),
  signingPrivateKeyHex: '02'.repeat(32),
};

/** A wallet that answers only what the journal's delivery pass asks. */
function walletAnswering(sendState: string) {
  const get = jest.fn(async (id: string) => ({ id, state: sendState }));
  const manager = {
    ops: { send: { get } },
    mint: { isTrustedMint: jest.fn(async () => false) },
    recoverPendingPaymentRequestReceiveAttempts: jest.fn(async () => undefined),
  } as unknown as Manager;
  return { manager, get };
}

/** Make `manager` the open wallet, as the journal requires before it reads or writes. */
function open(manager: Manager): void {
  const { CocoManager } =
    require('@/shared/lib/cashu/manager') as typeof import('@/shared/lib/cashu/manager');
  jest.spyOn(CocoManager, 'isInitialized').mockReturnValue(true);
  jest.spyOn(CocoManager, 'getInstance').mockReturnValue(manager);
}

function quiet(): void {
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
}

describe('E20: what 0.1.4 writes outside its stores, after the upgrade', () => {
  let startupError: unknown;
  let startupRejections: string[] = [];
  let launches = 0;

  beforeAll(async () => {
    quiet();
    install(E20);
    try {
      for (let n = 0; n < 3; n++) {
        await launch(E20);
        launches += 1;
      }
    } catch (error) {
      startupError = error;
      startupRejections = rejectionsOfLastLaunchSoFar();
    }
  }, 120_000);

  afterAll(() => jest.restoreAllMocks());

  it('starts three times over the records', () => {
    expect({ error: startupError, rejections: startupRejections, launches }).toEqual({
      error: undefined,
      rejections: [],
      launches: 3,
    });
  });

  it('lists every record it reads back as kept, so the runner checks its bytes', () => {
    const { keptAsyncStorage, keptSecureStore } = E20.survives;
    for (const key of Object.keys(records.asyncStorage)) expect(keptAsyncStorage).toContain(key);
    for (const key of Object.keys(records.secureStore)) {
      if (key !== 'secure_key_index') expect(keptSecureStore).toContain(key);
    }
    expect(Object.keys(records.asyncStorage)).toHaveLength(2);
    expect(Object.keys(records.secureStore).length).toBeGreaterThan(4);
  });

  it('keeps the nearby-payment journal readable, with the delivery still bound to its send', async () => {
    const { manager, get } = walletAnswering('prepared');
    open(manager);
    const { nearbyPayments } =
      require('@/features/nearPay/lib/nearbyPayments') as typeof import('@/features/nearPay/lib/nearbyPayments');
    const { createSecureVault } =
      require('@/shared/lib/persist/secureVault') as typeof import('@/shared/lib/persist/secureVault');
    const { NEARBY_PAYMENT_JOURNAL_KEY } =
      require('@/features/nearPay/lib/nearbyPaymentStorage') as typeof import('@/features/nearPay/lib/nearbyPaymentStorage');
    // The delivery pass parses the journal with its own schema and asks the
    // wallet about each bound send; a send that is not pending is left alone.
    await nearbyPayments(manager).drain(new Uint8Array(32).fill(3), IDENTITY, 'fixture');
    expect(get.mock.calls).toEqual([[OPERATION_ID]]);
    const raw = await createSecureVault(A1, NEARBY_PAYMENT_JOURNAL_KEY).read();
    expect(JSON.parse(raw ?? 'null')).toEqual({
      version: 1,
      outbound: { [OPERATION_ID]: DELIVERY },
      inbound: {},
    });
  });

  it('keeps the Routstr SDK recovery record readable through the SDK storage driver', async () => {
    const { createSdkStorageDriver } =
      require('@/shared/lib/routstr/sdk/driver') as typeof import('@/shared/lib/routstr/sdk/driver');
    expect(await createSdkStorageDriver(A0).getItem('xcashu_tokens', {})).toEqual(XCASHU_TOKENS);
  });

  it('keeps the Whitenoise group state and DM index of their accounts', async () => {
    const { AsyncStorageKVBackend } =
      require('@/features/whitenoise/storage/asyncStorageBackend') as typeof import('@/features/whitenoise/storage/asyncStorageBackend');
    const { WhitenoiseNamespace, whitenoisePrefix } =
      require('@/features/whitenoise/storage/namespaces') as typeof import('@/features/whitenoise/storage/namespaces');
    const { WhitenoiseDmIndex } =
      require('@/features/whitenoise/storage/dmIndex') as typeof import('@/features/whitenoise/storage/dmIndex');
    const groupState = new AsyncStorageKVBackend<Uint8Array>(
      whitenoisePrefix(0, WhitenoiseNamespace.GroupState)
    );
    expect(await groupState.getItem(GROUP_ID_HEX)).toEqual(GROUP_STATE);
    expect(await new WhitenoiseDmIndex(1).list()).toEqual([
      { pubkey: DM_PEER, groupIdHex: GROUP_ID_HEX },
    ]);
  });
});

// ── Writing the records ──────────────────────────────────────────────────────

(process.env.WRITE_E20_RECORDS ? it : it.skip)(
  'writes the records this build leaves outside its stores',
  async () => {
    quiet();
    const recordKeys = new Set([
      ...Object.keys(records.asyncStorage),
      ...Object.keys(records.secureStore),
    ]);
    const without = <T>(values: Readonly<Record<string, T>>) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => !recordKeys.has(key)));
    // E20 as it was before these records: the upgraded disk and the hand-written rows.
    const base: ReleaseFixture = {
      ...E20,
      asyncStorage: without(E20.asyncStorage),
      secureStore: upgraded.secureStore,
    };
    install(base);
    await launch(base);
    const before = snapshot();

    const { manager } = walletAnswering('prepared');
    open(manager);
    const { nearbyPayments } =
      require('@/features/nearPay/lib/nearbyPayments') as typeof import('@/features/nearPay/lib/nearbyPayments');
    await nearbyPayments(manager).bind(OPERATION_ID, DELIVERY);

    const { createSdkStorageDriver } =
      require('@/shared/lib/routstr/sdk/driver') as typeof import('@/shared/lib/routstr/sdk/driver');
    const driver = createSdkStorageDriver(A0);
    await driver.setItem('xcashu_tokens', XCASHU_TOKENS);
    await driver.flush();

    const { AsyncStorageKVBackend } =
      require('@/features/whitenoise/storage/asyncStorageBackend') as typeof import('@/features/whitenoise/storage/asyncStorageBackend');
    const { WhitenoiseNamespace, whitenoisePrefix } =
      require('@/features/whitenoise/storage/namespaces') as typeof import('@/features/whitenoise/storage/namespaces');
    const { WhitenoiseDmIndex } =
      require('@/features/whitenoise/storage/dmIndex') as typeof import('@/features/whitenoise/storage/dmIndex');
    await new AsyncStorageKVBackend<Uint8Array>(
      whitenoisePrefix(0, WhitenoiseNamespace.GroupState)
    ).setItem(GROUP_ID_HEX, GROUP_STATE);
    await new WhitenoiseDmIndex(1).set(DM_PEER, GROUP_ID_HEX);

    const after = snapshot();
    const changed = (was: Record<string, string>, now: Record<string, string>) =>
      Object.fromEntries(Object.entries(now).filter(([key, value]) => was[key] !== value));
    const written = {
      asyncStorage: changed(before.asyncStorage, after.asyncStorage),
      secureStore: changed(before.secureStore, after.secureStore),
    };
    // Only the records: nothing else on the disk moved while they were written.
    expect(Object.keys(written.asyncStorage).every((key) => key.startsWith('whitenoise:'))).toBe(
      true
    );
    expect(Object.keys(before.secureStore).filter((key) => !(key in after.secureStore))).toEqual(
      []
    );
    writeFileSync(
      join(__dirname, 'releaseFixtures', 'E20-0.1.4.records.json'),
      `${JSON.stringify(written, null, 2)}\n`
    );
  },
  120_000
);

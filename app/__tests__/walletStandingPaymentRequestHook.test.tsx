/**
 * @jest-environment node
 *
 * Characterization of `useStandingPaymentRequest`, the hook behind the
 * standing Cashu (NUT-18) receive QR and nearby discovery. The real hook runs
 * on the real `payment-request-receive.ts` helper, the real cashu-ts codec and
 * an in-memory identity store; only the provider's Manager seam
 * (`useColadaManager`) is replaced by a fake Coco manager.
 */

import { act, renderHook } from '@testing-library/react-native';
import { PaymentRequest, PaymentRequestTransportType, decodePaymentRequest } from '@cashu/cashu-ts';

import {
  standingPaymentRequestKey,
  type StandingPaymentRequestInput,
} from '../../wallet/src/payment-request-receive';
import type { ReusableQuoteIdentityStore } from '../../wallet/src/quotes/reusable';
import { useStandingPaymentRequest } from '../../wallet/src/react/useStandingPaymentRequest';

jest.mock('../../wallet/src/react/ColadaProvider', () => ({
  useColadaManager: () => mockManager,
}));

const MINT_A = 'https://mint-a.example';
const MINT_B = 'https://mint-b.example';
const KEY = standingPaymentRequestKey('sat');
const LOCK = `02${'ab'.repeat(32)}`;
const NPROFILE = 'nprofile1qqswuyd9ml6qcxd92h6pleptfrcqucvvjy39vg4wx7mv9wm8kakyujgua442w';

type Op = {
  id: string;
  requestId: string;
  encodedRequest: string;
  state: string;
  unit: string;
  mints: string[];
  singleUse: boolean;
};

type CreateArgs = {
  amount: number;
  unit: string;
  mints: string[];
  requestId: string;
  singleUse: boolean;
};

function createFakeManager() {
  const ops = new Map<string, Op>();
  let count = 0;
  const incoming = {
    get: jest.fn(async (id: string) => ops.get(id) ?? null),
    create: jest.fn(async (args: CreateArgs) => {
      count += 1;
      const op: Op = {
        id: `op-${count}`,
        requestId: args.requestId,
        encodedRequest: new PaymentRequest(
          [{ type: PaymentRequestTransportType.NOSTR, target: NPROFILE, tags: [['n', '17']] }],
          args.requestId,
          args.amount,
          args.unit,
          args.mints,
          undefined,
          args.singleUse
        ).toEncodedRequest(),
        state: 'active',
        unit: args.unit,
        mints: args.mints,
        singleUse: args.singleUse,
      };
      ops.set(op.id, op);
      return op;
    }),
    cancel: jest.fn(async (id: string, _reason: string) => {
      const op = ops.get(id);
      if (op) op.state = 'cancelled';
      return op;
    }),
  };
  return { manager: { paymentRequests: { incoming } }, incoming, ops };
}

function createMemoryIdentityStore(): ReusableQuoteIdentityStore & {
  setExternally: (key: string, id: string) => void;
} {
  const values = new Map<string, string>();
  const subscribers = new Map<string, Set<() => void>>();
  return {
    get: (key) => values.get(key),
    set: (key, id) => {
      values.set(key, id);
    },
    subscribe: (key, callback) => {
      const set = subscribers.get(key) ?? new Set();
      set.add(callback);
      subscribers.set(key, set);
      return () => set.delete(callback);
    },
    setExternally: (key, id) => {
      values.set(key, id);
      subscribers.get(key)?.forEach((cb) => cb());
    },
  };
}

let fake = createFakeManager();
let mockManager: unknown = fake.manager;
let store = createMemoryIdentityStore();

beforeEach(() => {
  fake = createFakeManager();
  mockManager = fake.manager;
  store = createMemoryIdentityStore();
});

const flush = () => act(async () => {});
const INPUT: StandingPaymentRequestInput = { unit: 'sat', mints: [MINT_A, MINT_B] };

type Props = { input: StandingPaymentRequestInput | null; fresh?: boolean };

function renderStanding(initial: Props) {
  return renderHook(
    ({ input, fresh }: Props) =>
      useStandingPaymentRequest(input, store, fresh ? { freshOnMount: true } : undefined),
    { initialProps: initial }
  );
}

test('first mount creates one reusable request, records it and advertises it without an amount', async () => {
  const { result } = renderStanding({ input: INPUT });
  expect(result.current.request).toBeNull();
  expect(result.current.isLoading).toBe(true);
  await flush();

  expect(result.current.isLoading).toBe(false);
  expect(fake.incoming.create).toHaveBeenCalledTimes(1);
  const args = fake.incoming.create.mock.calls[0][0];
  expect(args).toMatchObject({
    amount: 1,
    unit: 'sat',
    mints: [MINT_A, MINT_B],
    singleUse: false,
    transport: 'nostr',
  });
  expect(args.requestId).toMatch(/^sov[0-9a-f]{32}$/);
  expect(store.get(KEY)).toBe('op-1');
  expect(result.current.request).toMatchObject({
    operationId: 'op-1',
    requestId: args.requestId,
    unit: 'sat',
  });

  // QUIRK: the operation is created with a one-unit floor amount, but the
  // advertised QR drops it, so payers see an amountless request.
  const advertised = decodePaymentRequest(result.current.request!.encodedRequest);
  expect(advertised.amount).toBeUndefined();
  expect(advertised.singleUse).toBe(false);
  expect(advertised.mints).toEqual([MINT_A, MINT_B]);
  expect(result.current.request!.encodedRequestB.startsWith('CREQB1')).toBe(true);
});

test('a recorded active request is reused without creating another', async () => {
  const first = renderStanding({ input: INPUT });
  await flush();
  first.unmount();

  fake.incoming.create.mockClear();
  const second = renderStanding({ input: INPUT });
  // A remount on the same manager shows the last request at once.
  expect(second.result.current.request?.operationId).toBe('op-1');
  expect(second.result.current.isLoading).toBe(false);
  await flush();
  expect(second.result.current.request?.operationId).toBe('op-1');
  expect(fake.incoming.create).not.toHaveBeenCalled();
});

test('freshOnMount retires the recorded request and hides it until the new one lands', async () => {
  const first = renderStanding({ input: INPUT });
  await flush();
  first.unmount();

  const fresh = renderStanding({ input: INPUT, fresh: true });
  expect(fresh.result.current.request).toBeNull();
  expect(fresh.result.current.isLoading).toBe(true);
  await flush();

  expect(fake.incoming.cancel).toHaveBeenCalledWith('op-1', 'rotated');
  expect(fresh.result.current.request?.operationId).toBe('op-2');
  expect(store.get(KEY)).toBe('op-2');

  fresh.rerender({ input: { ...INPUT }, fresh: true });
  await flush();
  expect(fake.incoming.create).toHaveBeenCalledTimes(2);
});

test('adding a P2PK lock re-encodes the same operation instead of rotating, even with freshOnMount', async () => {
  const { result, rerender } = renderStanding({ input: INPUT, fresh: true });
  await flush();
  const before = result.current.request!;

  rerender({ input: { ...INPUT, lockP2pkPubkey: LOCK }, fresh: true });
  await flush();

  // QUIRK: a lock change never rotates, so the same request id is handed out
  // locked and unlocked.
  expect(fake.incoming.create).toHaveBeenCalledTimes(1);
  expect(fake.incoming.cancel).not.toHaveBeenCalled();
  expect(result.current.request?.operationId).toBe(before.operationId);
  expect(result.current.request?.requestId).toBe(before.requestId);
  const advertised = decodePaymentRequest(result.current.request!.encodedRequest);
  expect(advertised.nut10).toMatchObject({ kind: 'P2PK', data: LOCK });
  expect(decodePaymentRequest(before.encodedRequest).nut10).toBeUndefined();
});

test('narrowing the displayed mints re-encodes the same operation with the subset', async () => {
  const { result, rerender } = renderStanding({ input: INPUT });
  await flush();

  rerender({ input: { ...INPUT, displayMints: [MINT_B] } });
  await flush();

  expect(fake.incoming.create).toHaveBeenCalledTimes(1);
  expect(result.current.request?.operationId).toBe('op-1');
  expect(result.current.request?.mints).toEqual([MINT_A, MINT_B]);
  expect(decodePaymentRequest(result.current.request!.encodedRequest).mints).toEqual([MINT_B]);
});

test('displayed mints that share nothing with the operation fail closed with an error', async () => {
  const { result } = renderStanding({
    input: { ...INPUT, displayMints: ['https://untrusted.example'] },
  });
  await flush();

  expect(result.current.request).toBeNull();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toEqual({
    message: 'No accepted mints in standing request',
    authored: true,
  });
});

test('a new trusted mint keeps advertising the recorded request’s old mint list', async () => {
  const { result, rerender } = renderStanding({ input: { unit: 'sat', mints: [MINT_A] } });
  await flush();

  rerender({ input: { unit: 'sat', mints: [MINT_A, MINT_B] } });
  await flush();

  // QUIRK: without a purpose the recorded operation is reused whatever its
  // mints are, so the QR keeps the old list until someone rotates it.
  expect(fake.incoming.create).toHaveBeenCalledTimes(1);
  expect(result.current.request?.operationId).toBe('op-1');
  expect(decodePaymentRequest(result.current.request!.encodedRequest).mints).toEqual([MINT_A]);
});

test('a rotation recorded from outside swaps the mounted request; re-recording the same id does not', async () => {
  const { result } = renderStanding({ input: INPUT });
  await flush();
  fake.incoming.get.mockClear();

  await act(async () => store.setExternally(KEY, 'op-1'));
  expect(fake.incoming.get).not.toHaveBeenCalled();

  const replacement = await fake.incoming.create({
    amount: 1,
    unit: 'sat',
    mints: INPUT.mints,
    requestId: 'sov-external',
    singleUse: false,
  });
  await act(async () => store.setExternally(KEY, replacement.id));
  expect(result.current.request?.operationId).toBe(replacement.id);
  expect(result.current.request?.requestId).toBe('sov-external');
});

test('rotate cancels the current request and records a new one', async () => {
  const { result } = renderStanding({ input: INPUT });
  await flush();

  await act(async () => {
    await result.current.rotate();
  });
  expect(fake.incoming.cancel).toHaveBeenCalledWith('op-1', 'rotated');
  expect(result.current.request?.operationId).toBe('op-2');
  expect(store.get(KEY)).toBe('op-2');
});

test('a failed load shows the error, and a successful rotate afterwards leaves it showing', async () => {
  fake.incoming.create.mockRejectedValueOnce(new Error('relay down'));
  const { result } = renderStanding({ input: INPUT });
  await flush();
  expect(result.current).toMatchObject({
    request: null,
    isLoading: false,
    error: { message: 'relay down', authored: false },
  });

  await act(async () => {
    await result.current.rotate();
  });
  expect(result.current.request?.operationId).toBe('op-1');
  // QUIRK: rotate never clears the earlier error, so the request and the
  // failure are shown together. A later fix should change this on purpose.
  expect(result.current.error).toEqual({ message: 'relay down', authored: false });
});

test('a null input clears the request, the loading flag and the error', async () => {
  const { result, rerender } = renderStanding({ input: INPUT });
  await flush();
  expect(result.current.request).not.toBeNull();

  rerender({ input: null });
  await flush();
  expect(result.current).toMatchObject({ request: null, isLoading: false, error: null });
});

// These describe a lock that can be taken back. The wallet ships with that
// switched off (`wallet/src/p2pk/reclaimGate.ts`), so it is switched on here
// to keep the behaviour specified for the day it returns.
// `sendLockReclaimGate.test.ts` covers what ships.
jest.mock('../../wallet/src/p2pk/reclaimGate', () => ({ P2PK_RECLAIM_ENABLED: true }));

import { act, renderHook } from '@testing-library/react-native';

import { useSendLock } from '@/features/send/hooks/useSendLock';
import type { SendLockGate } from '@/features/send/lib/sendLockGate';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';
import { useSendLockStore } from '@/shared/stores/runtime/sendLockStore';

type SheetButton = { testID: string; onPress: (close: () => void) => void };
type SheetPayload = { title: string; buttons: SheetButton[]; onDismiss?: () => void };

const mockSheets: SheetPayload[] = [];
const mockNotices: { title: string; description: string }[] = [];
let mockGate: SendLockGate = { kind: 'unavailable', reason: 'Locking needs a Nostr recipient' };
let mockRefundKey: string | null = null;

jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({
  actionMenuSheet: (payload: SheetPayload) => mockSheets.push(payload),
}));
jest.mock('@/shared/lib/popup/popups/acknowledgeSheet', () => ({
  acknowledgeSheet: (notice: { title: string; description: string }) => {
    mockNotices.push(notice);
    return Promise.resolve();
  },
}));
jest.mock('@/features/send/hooks/useSendLockTarget', () => ({
  useSendLockTarget: () => ({ gate: mockGate, refundKey: mockRefundKey, loading: false }),
}));
jest.mock('@/shared/lib/date', () => ({ formatDate: () => 'a date' }));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ALICE = 'a'.repeat(64);
const ALICE_KEY = `02${'ab'.repeat(32)}` as CashuP2pkPubkey;
const PEER_KEY = `02${'cd'.repeat(32)}`;
const OUR_KEY = `02${'ef'.repeat(32)}`;

const nutDrop = { destination: 'sendEcash', p2pkLockPubkey: PEER_KEY };
const toAlice = { destination: 'sendEcash' };

function pick(testID: string) {
  const sheet = mockSheets.at(-1)!;
  const button = sheet.buttons.find((b) => b.testID === testID);
  if (!button) throw new Error(`no ${testID} in ${sheet.buttons.map((b) => b.testID).join(',')}`);
  button.onPress(() => {});
}

beforeEach(() => {
  mockSheets.length = 0;
  mockNotices.length = 0;
  mockGate = { kind: 'ready', lockKey: ALICE_KEY };
  mockRefundKey = OUR_KEY;
  useSendLockStore.setState({ draft: null });
  jest.useFakeTimers().setSystemTime(Date.UTC(2026, 8, 27, 12, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a flow that arrived locked (Nut Drop)', () => {
  const render = () =>
    renderHook(() =>
      useSendLock({ entry: nutDrop, recipientPubkey: ALICE, recipientName: 'David' })
    );

  it('shows locked and asks who and how long before the send leaves', async () => {
    const { result } = render();
    expect(result.current.locked).toBe(true);
    expect(result.current.lockChoice).toBeUndefined();

    let confirmed: unknown;
    await act(async () => {
      const pending = result.current.confirmLock!();
      expect(mockSheets).toHaveLength(1);
      expect(mockSheets[0].title).toBe('Lock to David');
      // The lock is a requirement here, so there is no way to turn it off.
      expect(mockSheets[0].buttons.map((b) => b.testID)).not.toContain('send-lock-off');
      pick('send-lock-1h');
      confirmed = await pending;
    });

    expect(confirmed).toEqual({
      pubkey: PEER_KEY,
      locktimeSec: Math.floor(Date.now() / 1000) + 3600,
      refundKeys: [OUR_KEY],
    });
  });

  it('does not ask twice once the header sheet has been answered', async () => {
    const { result } = render();
    await act(async () => {
      result.current.open();
      pick('send-lock-forever');
    });
    expect(mockSheets).toHaveLength(1);

    let confirmed: unknown;
    await act(async () => {
      confirmed = await result.current.confirmLock!();
    });

    expect(mockSheets).toHaveLength(1);
    expect(confirmed).toEqual({ pubkey: PEER_KEY });
  });

  it('sends nothing when the sheet is dismissed', async () => {
    const { result } = render();
    let confirmed: unknown = 'unset';
    await act(async () => {
      const pending = result.current.confirmLock!();
      mockSheets[0].onDismiss?.();
      confirmed = await pending;
    });
    expect(confirmed).toBeNull();
  });

  it('counts a timed lock from the send, not from when it was chosen', async () => {
    const { result } = render();
    await act(async () => {
      result.current.open();
      pick('send-lock-1h');
    });
    jest.setSystemTime(Date.UTC(2026, 8, 27, 12, 10));

    let confirmed: { locktimeSec?: number } | null = null;
    await act(async () => {
      confirmed = await result.current.confirmLock!();
    });

    expect(confirmed!.locktimeSec).toBe(Math.floor(Date.UTC(2026, 8, 27, 12, 10) / 1000) + 3600);
  });
});

describe('a send to a person', () => {
  const render = () =>
    renderHook(() =>
      useSendLock({ entry: toAlice, recipientPubkey: ALICE, recipientName: 'Alice' })
    );

  it('starts unlocked and says so to the machine', () => {
    const { result } = render();
    expect(result.current.locked).toBe(false);
    expect(result.current.lockChoice).toBeNull();
    expect(result.current.confirmLock).toBeUndefined();
  });

  it('locks from the header, and the plain Next then sends on those terms', async () => {
    const { result } = render();
    await act(async () => {
      result.current.open();
      expect(mockSheets[0].buttons.map((b) => b.testID)).toContain('send-lock-off');
      pick('send-lock-7d');
    });

    expect(result.current.locked).toBe(true);
    let confirmed: unknown;
    await act(async () => {
      confirmed = await result.current.confirmLock!();
    });
    expect(mockSheets).toHaveLength(1);
    expect(confirmed).toEqual({
      pubkey: ALICE_KEY,
      locktimeSec: Math.floor(Date.now() / 1000) + 7 * 86400,
      refundKeys: [OUR_KEY],
    });
  });

  it('unlocks again from the header', async () => {
    const { result } = render();
    await act(async () => {
      result.current.open();
      pick('send-lock-forever');
    });
    expect(result.current.locked).toBe(true);
    await act(async () => {
      result.current.open();
      pick('send-lock-off');
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.lockChoice).toBeNull();
    expect(result.current.confirmLock).toBeUndefined();
  });

  it('drops a choice made for someone else', async () => {
    useSendLockStore.setState({
      draft: { lockKey: PEER_KEY, durationId: 'forever', confirmed: true },
    });
    const { result } = render();
    await act(async () => {});
    expect(result.current.locked).toBe(false);
    expect(useSendLockStore.getState().draft).toBeNull();
  });
});

describe('where there is no choice to make', () => {
  it('explains why a recipient-less send cannot be locked', () => {
    mockGate = { kind: 'unavailable', reason: 'Locking needs a Nostr recipient' };
    const { result } = renderHook(() => useSendLock({ entry: toAlice, recipientName: 'this key' }));
    expect(result.current.mode).toBe('unavailable');
    expect(result.current.locked).toBe(false);
    act(() => result.current.open());
    expect(mockSheets).toHaveLength(0);
    expect(mockNotices).toEqual([
      expect.objectContaining({ description: 'Locking needs a Nostr recipient' }),
    ]);
  });

  it('shows a payment request as locked on the request’s own terms', () => {
    const { result } = renderHook(() =>
      useSendLock({
        entry: { destination: 'paymentRequest', paymentRequestLockPubkey: PEER_KEY },
        recipientName: 'this key',
      })
    );
    expect(result.current.locked).toBe(true);
    expect(result.current.confirmLock).toBeUndefined();
    act(() => result.current.open());
    expect(mockSheets).toHaveLength(0);
    expect(mockNotices).toHaveLength(1);
  });

  it('shows no lock on a payment that is not ecash', () => {
    const { result } = renderHook(() =>
      useSendLock({ entry: { destination: 'meltQuote' }, recipientName: 'this key' })
    );
    expect(result.current.mode).toBe('hidden');
  });
});

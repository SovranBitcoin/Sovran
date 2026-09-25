/**
 * The spend prompt.
 *
 * Paying per request hands the node a token worth its ADMISSION GATE, not the
 * expected cost — thousands of sats on a frontier model against a message that
 * will cost a fraction of one. It comes back, but it is the user's money and
 * they should see the figure before it goes.
 */

import { confirmSpend } from '@/features/ai/lib/spendConfirm';
import { maxSpendSats } from '@/features/ai/lib/format';
import { ROUTSTR_MAX_COMPLETION_TOKENS } from '@/shared/lib/routstr/api';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { LineupEntry } from '@/shared/lib/routstr/lineup';

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));

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

jest.mock('@/shared/lib/popup', () => ({ actionMenuPopup: jest.fn() }));

const { actionMenuPopup } = jest.requireMock('@/shared/lib/popup') as {
  actionMenuPopup: jest.Mock;
};

type Payload = {
  buttons: {
    testID: string;
    text: string;
    description?: string;
    onPress: (close: () => void) => void;
  }[];
  onDismiss?: () => void;
};
const lastPayload = () => actionMenuPopup.mock.calls.at(-1)?.[0] as Payload;

const entry = (prompt: number, completion: number): LineupEntry => ({
  modelId: 'model',
  displayName: 'Model',
  contextLength: 200_000,
  created: 1,
  visionInput: false,
  satsPricing: { prompt, completion, request: 0.001, image: 0, max_cost: 1000 },
});

describe('maxSpendSats', () => {
  it('still prices the typical turn it is named for', () => {
    // The last-resort estimate, for a model the catalogue cannot price:
    // request + 8000 prompt tokens + the completion budget the request will
    // carry, buffered. NOT what the spend sheet quotes any more — that comes
    // from `reservedSatsForSend` over the real body.
    expect(maxSpendSats(entry(0.001, 0.01))).toBe(
      Math.ceil((0.001 + 8 + 0.01 * ROUTSTR_MAX_COMPLETION_TOKENS) * 1.1)
    );
  });

  it('never quotes zero, because a zero token cannot clear any gate', () => {
    expect(maxSpendSats(null)).toBeGreaterThan(0);
    expect(maxSpendSats(entry(0, 0))).toBeGreaterThan(0);
  });
});

describe('confirmSpend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRoutstrStore.setState({ confirmSpend: true });
  });

  it('proceeds only once the user says so', async () => {
    const decision = confirmSpend({ modelName: 'Model', reserveSats: 42, reserveKnown: true });
    lastPayload()
      .buttons.find((b) => b.testID === 'ai-spend-confirm')!
      .onPress(() => {});
    await expect(decision).resolves.toBe(true);
    // No hedge. 42 is what leaves the wallet, so 42 is what the button says —
    // "up to 10 sats" was on screen while 307 went, because the figure came
    // from a typical-turn estimate rather than from this request.
    expect(lastPayload().buttons[0].text).toBe('Send · 42 sats');
  });

  it('marks an unpriced model as an estimate instead of stating a figure', async () => {
    void confirmSpend({ modelName: 'Model', reserveSats: 9, reserveKnown: false });
    expect(lastPayload().buttons[0].text).toBe('Send · roughly 9 sats');
    expect(lastPayload().buttons[0].description).toContain('could hold more');
  });

  it('treats dismissal as a decline', async () => {
    // Tapping away must never be read as consent to spend.
    const decision = confirmSpend({ modelName: 'Model', reserveSats: 42, reserveKnown: true });
    lastPayload().onDismiss?.();
    await expect(decision).resolves.toBe(false);
  });

  it('offers no way to turn itself off', async () => {
    // "Always allow" was a one-way door: it set `confirmSpend: false` and the
    // settings toggle its own copy promised was never built, so one tap opted
    // the user out of every future spend prompt for good. Consenting to one
    // send must never be consent to all of them.
    const decision = confirmSpend({ modelName: 'Model', reserveSats: 42, reserveKnown: true });
    const payload = lastPayload();
    expect(payload.buttons.map((b) => b.testID)).toEqual(['ai-spend-confirm']);

    payload.buttons[0].onPress(() => {});
    await expect(decision).resolves.toBe(true);
    // Saying yes once leaves the prompt armed for the next send.
    expect(useRoutstrStore.getState().confirmSpend).toBe(true);
    actionMenuPopup.mockClear();
    void confirmSpend({ modelName: 'Model', reserveSats: 42, reserveKnown: true });
    expect(actionMenuPopup).toHaveBeenCalled();
  });

  it('settles once even if the sheet reports twice', async () => {
    const decision = confirmSpend({ modelName: 'Model', reserveSats: 42, reserveKnown: true });
    const payload = lastPayload();
    payload.buttons[0].onPress(() => {});
    payload.onDismiss?.();
    await expect(decision).resolves.toBe(true);
  });
});

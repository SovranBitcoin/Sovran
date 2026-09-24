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
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { LineupEntry } from '@/shared/lib/routstr/lineup';

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

jest.mock('@/shared/lib/popup', () => ({ actionMenuPopup: jest.fn() }));

const { actionMenuPopup } = jest.requireMock('@/shared/lib/popup') as {
  actionMenuPopup: jest.Mock;
};

type Payload = {
  buttons: { testID: string; text: string; onPress: (close: () => void) => void }[];
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
  it('quotes the gate the node will hold, not the expected cost', () => {
    // request + 8000 prompt tokens + 4096 completion tokens, buffered.
    expect(maxSpendSats(entry(0.001, 0.01))).toBe(Math.ceil((0.001 + 8 + 40.96) * 1.1));
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
    const decision = confirmSpend({ modelName: 'Model', maxSats: 42 });
    lastPayload()
      .buttons.find((b) => b.testID === 'ai-spend-confirm')!
      .onPress(() => {});
    await expect(decision).resolves.toBe(true);
    expect(lastPayload().buttons[0].text).toContain('42 sats');
  });

  it('treats dismissal as a decline', async () => {
    // Tapping away must never be read as consent to spend.
    const decision = confirmSpend({ modelName: 'Model', maxSats: 42 });
    lastPayload().onDismiss?.();
    await expect(decision).resolves.toBe(false);
  });

  it('only stops asking when the user chooses that explicitly', async () => {
    const decision = confirmSpend({ modelName: 'Model', maxSats: 42 });
    lastPayload()
      .buttons.find((b) => b.testID === 'ai-spend-always')!
      .onPress(() => {});

    await expect(decision).resolves.toBe(true);
    expect(useRoutstrStore.getState().confirmSpend).toBe(false);
    // And from then on it does not prompt at all.
    actionMenuPopup.mockClear();
    await expect(confirmSpend({ modelName: 'Model', maxSats: 42 })).resolves.toBe(true);
    expect(actionMenuPopup).not.toHaveBeenCalled();
  });

  it('settles once even if the sheet reports twice', async () => {
    const decision = confirmSpend({ modelName: 'Model', maxSats: 42 });
    const payload = lastPayload();
    payload.buttons[0].onPress(() => {});
    payload.onDismiss?.();
    await expect(decision).resolves.toBe(true);
  });
});

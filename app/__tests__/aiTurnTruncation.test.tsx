/**
 * @jest-environment node
 *
 * An answer that ran out of budget must say so.
 *
 * Capping `max_tokens` at what a turn is expected to write is what stops the
 * app reserving four times the user's money for every send. That trade is only
 * honest if the case where the cap bites is visible: an answer cut off mid
 * sentence, finalised, cost-stamped and indistinguishable from a finished one
 * is a worse failure than the over-reservation it bought, because the user
 * paid for the part they did not get.
 *
 * `finish_reason` has been validated by the chunk spine the whole time and read
 * by nobody. These pin the vocabulary, the record, and the notice.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { isBudgetTruncation } from '@/features/ai/lib/finalize';
import { dispatchTurn, getTurn, resetTurns } from '@/features/ai/lib/turns';
import { AiMessageBubble } from '@/features/ai/components/AiMessageBubble';
import type { RoutstrMessage } from '@/shared/stores/profile/routstrStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (name: string) => (props: Record<string, unknown>) => {
  const R = jest.requireActual<typeof import('react')>('react');
  return R.createElement(name, props, props.children as React.ReactNode);
};

jest.mock('react-native', () => ({ View: stub('RNView') }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-image', () => ({ Image: stub('ExpoImage') }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    // eslint-disable-next-line no-restricted-syntax -- withAlpha requires a real hex in this theme mock.
    typeof token === 'string' ? '#101010' : token.map(() => '#101010'),
}));
jest.mock('@/shared/lib/popup', () => ({ popup: jest.fn(), staticPopup: jest.fn() }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: stub('Pressable') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: stub('Text') }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: stub('Spinner') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: stub('HStack') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: stub('VStack') }));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: stub('Amount') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: stub('Icon') }));
jest.mock('@/shared/lib/logger', () => {
  const lane: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  lane.child = () => lane;
  return {
    aiLog: lane,
    apiLog: lane,
    storeLog: lane,
    log: lane,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

const MESSAGE_ID = 'msg-1-a';
const answer: RoutstrMessage = {
  id: MESSAGE_ID,
  parentId: 'msg-0-u',
  role: 'assistant',
  content: 'Here is the first half of the answer',
  timestamp: 1,
};

function render(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer;
}

/** An answer that streamed and ran out of completion budget. */
function recordTurnTruncation(messageId: string, truncation: { budgetTokens: number }) {
  dispatchTurn(messageId, { type: 'asked', startedAtMs: 1 });
  dispatchTurn(messageId, { type: 'answered', truncation });
}

const texts = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAllByType('Text' as never).map((n) => String(n.props.children));

afterEach(() => {
  act(() => {
    resetTurns();
  });
});

describe('isBudgetTruncation', () => {
  it('recognises both spellings a node can forward', () => {
    expect(isBudgetTruncation('length')).toBe(true);
    expect(isBudgetTruncation('MAX_TOKENS')).toBe(true);
  });

  it('does not claim a normal finish was our budget', () => {
    // Saying "we cut this off" about an answer the model chose to end would
    // send the user to buy a continuation they do not need.
    for (const reason of ['stop', 'tool_calls', 'content_filter', null, undefined]) {
      expect(isBudgetTruncation(reason)).toBe(false);
    }
  });
});

describe('the truncation record', () => {
  it('remembers the budget that ran out, and forgets on a fresh attempt', () => {
    recordTurnTruncation(MESSAGE_ID, { budgetTokens: 2000 });
    expect(getTurn(MESSAGE_ID)).toEqual({ phase: 'done', truncation: { budgetTokens: 2000 } });
    // A re-driven placeholder must not carry the previous attempt's note.
    dispatchTurn(MESSAGE_ID, { type: 'asked', startedAtMs: 1 });
    expect(getTurn(MESSAGE_ID)).toEqual({ phase: 'asking', startedAtMs: 1 });
  });
});

describe('the bubble for a truncated answer', () => {
  it('names a model switch alongside the saved answer', () => {
    const r = render(
      <AiMessageBubble message={{ ...answer, modelSwitch: { from: 'GPT', to: 'GLM' } }} />
    );
    expect(texts(r)).toContain('Switched from GPT to GLM.');
    expect(texts(r).some((t) => t.includes('Here is the first half of the answer'))).toBe(true);
  });

  it('keeps the answer and says what stopped it', () => {
    recordTurnTruncation(MESSAGE_ID, { budgetTokens: 2000 });
    const r = render(<AiMessageBubble message={answer} onContinue={jest.fn()} />);
    const rendered = texts(r);
    // The content the user paid for is still there — this is a note on an
    // answer, not a pill in place of one.
    expect(rendered.some((t) => t.includes('Here is the first half of the answer'))).toBe(true);
    expect(rendered.some((t) => t.includes('2000-token answer limit'))).toBe(true);
  });

  it('offers to ask for the rest, and reports which turn to continue', () => {
    recordTurnTruncation(MESSAGE_ID, { budgetTokens: 2000 });
    const onContinue = jest.fn();
    const r = render(<AiMessageBubble message={answer} onContinue={onContinue} />);
    act(() => {
      r.root.findByProps({ testID: `ai-message-continue-${MESSAGE_ID}` }).props.onPress();
    });
    expect(onContinue).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it('says nothing on an answer that finished on its own', () => {
    const r = render(<AiMessageBubble message={answer} onContinue={jest.fn()} />);
    expect(texts(r).some((t) => t.includes('answer limit'))).toBe(false);
    expect(texts(r).some((t) => t.includes('Switched from'))).toBe(false);
    expect(r.root.findAllByProps({ testID: `ai-message-continue-${MESSAGE_ID}` })).toHaveLength(0);
  });
});

describe('the bubble for an answer that stopped partway', () => {
  it('shows what had arrived, says it stopped, and offers to ask again', () => {
    dispatchTurn(MESSAGE_ID, { type: 'asked', startedAtMs: 1 });
    dispatchTurn(MESSAGE_ID, { type: 'streamed', text: 'Half an answer', reasoning: '' });
    dispatchTurn(MESSAGE_ID, { type: 'interrupted' });
    const onRetry = jest.fn();
    const r = render(<AiMessageBubble message={{ ...answer, content: '' }} onRetry={onRetry} />);

    expect(texts(r).some((t) => t.includes('Half an answer'))).toBe(true);
    expect(texts(r)).toContain('Stopped before the answer finished.');
    act(() => {
      r.root.findByProps({ testID: `ai-message-retry-${MESSAGE_ID}` }).props.onPress();
    });
    expect(onRetry).toHaveBeenCalledWith(MESSAGE_ID);
    act(() => r.unmount());
  });
});

describe('copying an answer', () => {
  it('says Copied once the clipboard has it, and Failed to copy when the write is refused', async () => {
    const { setStringAsync } = jest.requireMock<{ setStringAsync: jest.Mock }>('expo-clipboard');
    const { popup, staticPopup } = jest.requireMock<{ popup: jest.Mock; staticPopup: jest.Mock }>(
      '@/shared/lib/popup'
    );
    popup.mockClear();
    const r = render(<AiMessageBubble message={answer} />);
    const copy = () =>
      act(async () => {
        await r.root.findAllByProps({ testID: `ai-message-copy-${MESSAGE_ID}` })[0].props.onPress();
      });

    setStringAsync.mockResolvedValueOnce(undefined);
    await copy();
    expect(setStringAsync).toHaveBeenLastCalledWith(answer.content);
    expect(popup).toHaveBeenCalledWith(expect.objectContaining({ message: 'Copied' }));

    popup.mockClear();
    setStringAsync.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await copy();
    expect(popup).not.toHaveBeenCalled();
    expect(staticPopup).toHaveBeenCalledWith('copy-failed');
  });
});

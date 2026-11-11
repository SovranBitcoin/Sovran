/**
 * Where one AI answer stands (`nextTurn`), and how a saved answer with no
 * turn reads (`readAnswer`).
 */
import { nextTurn, readAnswer, type Turn } from '@/features/ai/lib/turns';

const error = { id: 'routstr.interrupted' as const, text: 'x' };
const asking: Turn = { phase: 'asking', startedAtMs: 5 };
const streaming: Turn = { phase: 'streaming', startedAtMs: 5, text: 'hi', reasoning: '' };

describe('an answer moving through its turn', () => {
  it('is asked, streamed and answered, keeping when it started', () => {
    const asked = nextTurn(undefined, { type: 'asked', startedAtMs: 5 });
    expect(asked).toEqual(asking);
    const streamed = nextTurn(asked, { type: 'streamed', text: 'hi', reasoning: '' });
    expect(streamed).toEqual(streaming);
    expect(nextTurn(streamed, { type: 'answered', truncation: { budgetTokens: 9 } })).toEqual({
      phase: 'done',
      truncation: { budgetTokens: 9 },
    });
  });

  it('settles as failed, interrupted, or removed when stopped, only while live', () => {
    for (const live of [asking, streaming]) {
      expect(nextTurn(live, { type: 'failed', error })).toEqual({ phase: 'failed', error });
      expect(nextTurn(live, { type: 'interrupted' })).toEqual({ phase: 'interrupted' });
      expect(nextTurn(live, { type: 'stopped' })).toBeUndefined();
    }
  });

  it('can fail before it is asked (no model to ask)', () => {
    expect(nextTurn(undefined, { type: 'failed', error })).toEqual({ phase: 'failed', error });
  });

  it('ignores a late event once settled, until it is asked again', () => {
    const settled: Turn[] = [
      { phase: 'done', truncation: null },
      { phase: 'failed', error },
      { phase: 'interrupted' },
    ];
    for (const turn of settled) {
      expect(nextTurn(turn, { type: 'streamed', text: 'late', reasoning: '' })).toBe(turn);
      expect(nextTurn(turn, { type: 'answered', truncation: null })).toBe(turn);
      expect(nextTurn(turn, { type: 'failed', error })).toBe(turn);
      expect(nextTurn(turn, { type: 'interrupted' })).toBe(turn);
      expect(nextTurn(turn, { type: 'stopped' })).toBe(turn);
      expect(nextTurn(turn, { type: 'asked', startedAtMs: 7 })).toEqual({
        phase: 'asking',
        startedAtMs: 7,
      });
    }
    expect(nextTurn(undefined, { type: 'streamed', text: 'late', reasoning: '' })).toBeUndefined();
    expect(nextTurn(streaming, { type: 'asked', startedAtMs: 9 })).toBe(streaming);
  });
});

describe('a saved answer with no turn', () => {
  const message = { id: 'a', role: 'assistant' as const, timestamp: 1 };

  it('reads as done when it holds an answer or reasoning', () => {
    expect(readAnswer({ ...message, content: 'yes' }, undefined)).toEqual({
      phase: 'done',
      truncation: null,
    });
    expect(readAnswer({ ...message, content: '', reasoningContent: 'hmm' }, undefined)).toEqual({
      phase: 'done',
      truncation: null,
    });
  });

  it('reads as interrupted when it is empty (closed mid-answer, or by an older build)', () => {
    expect(readAnswer({ ...message, content: '' }, undefined)).toEqual({ phase: 'interrupted' });
  });

  it('reads as its turn while there is one', () => {
    expect(readAnswer({ ...message, content: '' }, streaming)).toBe(streaming);
  });
});

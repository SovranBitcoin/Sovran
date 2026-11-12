/**
 * Where one AI answer stands (`nextTurn`), and how a saved answer with no
 * turn reads (`readAnswer`).
 */
import {
  dispatchTurn,
  getTurn,
  nextTurn,
  readAnswer,
  resetTurns,
  type Turn,
} from '@/features/ai/lib/turns';

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

  it('settles as failed or interrupted, keeping the text that had arrived', () => {
    for (const live of [asking, streaming]) {
      expect(nextTurn(live, { type: 'failed', error })).toEqual({ phase: 'failed', error });
    }
    expect(nextTurn(asking, { type: 'interrupted' })).toEqual({ phase: 'interrupted', text: '' });
    expect(nextTurn(streaming, { type: 'interrupted' })).toEqual({
      phase: 'interrupted',
      text: 'hi',
    });
  });

  it('can fail before it is asked (no model to ask)', () => {
    expect(nextTurn(undefined, { type: 'failed', error })).toEqual({ phase: 'failed', error });
  });

  it('ignores a late event once settled, until it is asked again', () => {
    const settled: Turn[] = [
      { phase: 'done', truncation: null },
      { phase: 'failed', error },
      { phase: 'interrupted', text: 'so far' },
    ];
    for (const turn of settled) {
      expect(nextTurn(turn, { type: 'streamed', text: 'late', reasoning: '' })).toBe(turn);
      expect(nextTurn(turn, { type: 'answered', truncation: null })).toBe(turn);
      expect(nextTurn(turn, { type: 'failed', error })).toBe(turn);
      expect(nextTurn(turn, { type: 'interrupted' })).toBe(turn);
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
    expect(readAnswer({ ...message, content: '' }, undefined)).toEqual({
      phase: 'interrupted',
      text: '',
    });
  });

  it('reads as its turn while there is one', () => {
    expect(readAnswer({ ...message, content: '' }, streaming)).toBe(streaming);
  });
});

describe('which turns are kept', () => {
  beforeEach(() => resetTurns());

  /** One answer asked and settled by `event`. */
  function settle(id: string, event: Parameters<typeof dispatchTurn>[1]) {
    dispatchTurn(id, { type: 'asked', startedAtMs: 1 });
    dispatchTurn(id, event);
  }

  it('drops a finished answer, whose saved message then reads the same', () => {
    settle('a', { type: 'answered', truncation: null });
    expect(getTurn('a')).toBeUndefined();
    expect(
      readAnswer({ id: 'a', role: 'assistant', timestamp: 1, content: 'yes' }, getTurn('a'))
    ).toEqual({
      phase: 'done',
      truncation: null,
    });
  });

  it('keeps a finished answer the budget cut short, since the saved message does not say so', () => {
    settle('a', { type: 'answered', truncation: { budgetTokens: 9 } });
    expect(getTurn('a')).toEqual({ phase: 'done', truncation: { budgetTokens: 9 } });
  });

  it('keeps the 24 latest failed, interrupted or cut-short answers, never a live one', () => {
    dispatchTurn('live', { type: 'asked', startedAtMs: 1 });
    for (let i = 0; i < 30; i++)
      settle(`t${i}`, i % 2 ? { type: 'failed', error } : { type: 'interrupted' });

    expect(getTurn('live')).toEqual({ phase: 'asking', startedAtMs: 1 });
    for (let i = 0; i < 6; i++) expect(getTurn(`t${i}`)).toBeUndefined();
    for (let i = 6; i < 30; i++) expect(getTurn(`t${i}`)).toBeDefined();
    // A dropped one reads from its saved message, as one asked before this run.
    expect(
      readAnswer({ id: 't1', role: 'assistant', timestamp: 1, content: '' }, getTurn('t1'))
    ).toEqual({
      phase: 'interrupted',
      text: '',
    });
  });

  it('counts an answer asked again as the latest', () => {
    for (let i = 0; i < 24; i++) settle(`t${i}`, { type: 'interrupted' });
    settle('t0', { type: 'interrupted' });
    settle('new', { type: 'interrupted' });
    expect(getTurn('t0')).toBeDefined();
    expect(getTurn('t1')).toBeUndefined();
  });
});

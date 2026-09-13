import * as fc from 'fast-check';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { buildVerifyPlan, advanceVerify, type VerifyState } from '@/features/backup/lib/verifyPlan';
import { getBackupDemoPhrase } from '@/features/backup/lib/demoPhrase';

it('covers every position with deterministic, distinct, phrase-preferred choices', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...wordlist), { minLength: 12, maxLength: 12 }),
      fc.integer(),
      (words, seed) => {
        const plan = buildVerifyPlan(words, seed);
        expect(plan.map((entry) => entry.position)).toEqual(
          Array.from({ length: 12 }, (_, i) => i + 1)
        );
        expect(buildVerifyPlan(words, seed)).toEqual(plan);
        for (const [index, entry] of plan.entries()) {
          expect(entry.choices).toHaveLength(3);
          expect(new Set(entry.choices).size).toBe(3);
          expect(entry.choices[entry.answerIndex]).toBe(words[index]);
          if (new Set(words).size >= 3)
            expect(entry.choices.every((word) => words.includes(word))).toBe(true);
          else
            for (const word of entry.choices.filter((word) => !words.includes(word))) {
              expect(word.slice(0, 2)).not.toBe(words[index].slice(0, 2));
            }
        }
      }
    )
  );
});
it.each([Array(12).fill('abandon'), [...Array(11).fill('abandon'), 'about']])(
  'handles repeated words with dissimilar fallback decoys',
  (...words: string[]) => {
    for (const entry of buildVerifyPlan(words, 0)) {
      expect(new Set(entry.choices).size).toBe(3);
      const answer = words[entry.position - 1];
      for (const decoy of entry.choices.filter((word) => !words.includes(word))) {
        expect(wordlist).toContain(decoy);
        expect(decoy.slice(0, 2)).not.toBe(answer.slice(0, 2));
      }
    }
  }
);
it('only completes after twelve correct answers; every wrong choice stays at the current word', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 12, maxLength: 12 }),
      (answerIndices) => {
        let state: VerifyState = { answerIndices, position: 0, missesAtPosition: 0 };
        for (const [position, answer] of answerIndices.entries()) {
          for (const wrong of [0, 1, 2].filter((choice) => choice !== answer)) {
            const result = advanceVerify(state, wrong);
            expect(result.outcome).toBe('wrong');
            expect(result.state.position).toBe(position);
            expect(result.state.missesAtPosition).toBe(state.missesAtPosition + 1);
            state = result.state;
          }
          const result = advanceVerify(state, answer);
          expect(result.outcome).toBe(position === 11 ? 'complete' : 'correct');
          expect(result.state.missesAtPosition).toBe(0);
          state = result.state;
        }
        expect(advanceVerify(state, 0).outcome).not.toBe('complete');
      }
    )
  );
});
it('rejects invalid plans and invalid choice indices', () => {
  expect(buildVerifyPlan(['invalid'], 1)).toEqual([]);
  for (const choice of [-1, 3, NaN, 0.5])
    expect(
      advanceVerify({ answerIndices: Array(12).fill(0), position: 0, missesAtPosition: 0 }, choice)
        .outcome
    ).toBe('wrong');
  expect(advanceVerify({ answerIndices: [0], position: 0, missesAtPosition: 0 }, 0).outcome).toBe(
    'wrong'
  );
});
it('exposes the demo phrase only in development Mock Mode', () => {
  expect(getBackupDemoPhrase(false)).toBeNull();
  expect(getBackupDemoPhrase(true)?.split(' ')).toHaveLength(12);
  const previous = __DEV__;
  try {
    Object.assign(globalThis, { __DEV__: false });
    expect(getBackupDemoPhrase(true)).toBeNull();
  } finally {
    Object.assign(globalThis, { __DEV__: previous });
  }
});

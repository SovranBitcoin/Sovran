import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export interface VerifyQuestion {
  position: number;
  choices: string[];
  answerIndex: number;
}

// This PRNG only arranges choices. It never generates wallet entropy.
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildVerifyPlan(words: readonly string[], seed: number): VerifyQuestion[] {
  if (words.length !== 12 || words.some((word) => !wordlist.includes(word))) return [];
  const hash = sha256(utf8ToBytes(`${words.join(' ')}:${seed}`));
  let cursor = new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint32(0);
  const random = () => {
    cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
    return cursor / 0x100000000;
  };
  const distinct = [...new Set(words)];
  return words.map((answer, index) => {
    const decoys = shuffle(
      distinct.filter((word) => word !== answer),
      random
    ).slice(0, 2);
    if (decoys.length < 2) {
      const fallback = shuffle(
        wordlist.filter(
          (word) =>
            !distinct.includes(word) &&
            [answer, ...decoys].every((other) => other.slice(0, 2) !== word.slice(0, 2))
        ),
        random
      );
      while (decoys.length < 2) {
        const word = fallback.find((candidate) =>
          decoys.every((other) => other.slice(0, 2) !== candidate.slice(0, 2))
        )!;
        decoys.push(word);
      }
    }
    const choices = shuffle([answer, ...decoys], random);
    return { position: index + 1, choices, answerIndex: choices.indexOf(answer) };
  });
}

/** Progress contains indices only, never the phrase or its hash. */
export interface VerifyState {
  answerIndices: readonly number[];
  position: number;
  missesAtPosition: number;
}

export function advanceVerify(
  state: VerifyState,
  choiceIndex: number
): {
  state: VerifyState;
  outcome: 'correct' | 'wrong' | 'complete';
} {
  if (
    state.answerIndices.length !== 12 ||
    state.position < 0 ||
    state.position >= 12 ||
    !Number.isInteger(choiceIndex) ||
    choiceIndex < 0 ||
    choiceIndex > 2 ||
    choiceIndex !== state.answerIndices[state.position]
  ) {
    return { state: { ...state, missesAtPosition: state.missesAtPosition + 1 }, outcome: 'wrong' };
  }
  const next = { ...state, position: state.position + 1, missesAtPosition: 0 };
  return { state: next, outcome: next.position === 12 ? 'complete' : 'correct' };
}

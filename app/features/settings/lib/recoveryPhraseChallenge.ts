import { wordlist } from '@scure/bip39/wordlists/english.js';
import { validateMnemonic } from '@scure/bip39';

export interface RecoveryQuestion {
  position: number;
  answer: string;
  choices: string[];
}
// Randomness chooses quiz positions only; it never generates key material.
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function createRecoveryChallenge(
  mnemonic: string,
  random = Math.random
): RecoveryQuestion[] {
  if (!validateMnemonic(mnemonic, wordlist)) return [];
  const words = mnemonic.split(' ');
  return shuffled(
    words.map((_, index) => index),
    random
  )
    .slice(0, 3)
    .map((index) => ({
      position: index + 1,
      answer: words[index],
      choices: shuffled(
        [
          words[index],
          ...shuffled(
            wordlist.filter((word) => word !== words[index]),
            random
          ).slice(0, 5),
        ],
        random
      ),
    }));
}

/**
 * BIP-39's stretch of a phrase into a 64-byte seed (PBKDF2-SHA512, 2048
 * rounds, salt `mnemonic`), for the integrity check only.
 *
 * It is its own module for two reasons. The check must not share the stretch
 * the app derives with, or a fault there would vouch for itself. And it is the
 * slow step, so tests replace this one module instead of waiting on it.
 */
import { mnemonicToSeedSync } from '@scure/bip39';

/** Set once the native call has failed, so it is not tried again this launch. */
let nativeUnavailable = false;

/**
 * The platform's PBKDF2, off the JS thread. Null when there is none or it
 * failed; the caller decides whether the JS stretch is worth its pause.
 */
export async function stretchPhraseNative(phrase: string): Promise<Uint8Array | null> {
  const subtle = nativeUnavailable ? undefined : globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const encode = (text: string) => new TextEncoder().encode(text.normalize('NFKD'));
    const key = await subtle.importKey('raw', encode(phrase), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: encode('mnemonic'), iterations: 2048, hash: 'SHA-512' },
      key,
      512
    );
    const seed = new Uint8Array(bits);
    if (seed.length === 64) return seed;
  } catch {
    // Unsupported is not an error worth reporting; the JS stretch covers it.
  }
  nativeUnavailable = true;
  return null;
}

/** The reference stretch. Synchronous: it holds the JS thread while it runs. */
export function stretchPhraseJs(phrase: string): Uint8Array {
  return mnemonicToSeedSync(phrase, '');
}

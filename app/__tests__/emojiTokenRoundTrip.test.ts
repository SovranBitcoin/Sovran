/** @jest-environment node */
import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import { defaultDetectors, isWellFormedEcashToken, parsePaymentInput } from 'wallet';

import { CATEGORIES } from '@/shared/lib/popup/popups/emojiData';
import { decode, encode, isEncoded } from '@/shared/lib/third-party/emoji';

/**
 * A token copied "as emoji" and pasted back, with the real codec.
 *
 * Copying hands the picked emoji itself to `encode` (shared/lib/popup/popups/
 * emojiPicker.tsx: the picker's answer is an option whose id is the emoji).
 * Pasting reads the clipboard as the scan source does
 * (features/send/lib/sovranPaymentConfig.ts, `createSovranScanSources`:
 * `isEncoded(rawText) ? decode(rawText, isWellFormedEcashToken) : rawText`) and
 * hands the text to the wallet's input parser.
 */

const TOKEN = getEncodedToken({
  mint: 'https://mint.example',
  unit: 'sat',
  proofs: [
    {
      id: '00ad268c4d1f5826',
      amount: Amount.from(8),
      secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
      C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
    },
  ],
});

const VS16 = '️';
/** Every emoji the picker sheet offers, once (two appear in two categories). */
const PICKER = [...new Set(CATEGORIES.flatMap((category) => category.emojis.map((e) => e.emoji)))];
const plain = PICKER.filter((emoji) => !emoji.includes(VS16));
const withVs16 = PICKER.filter((emoji) => emoji.includes(VS16));

/**
 * The 0.1.3 encoder, copied (app/shared/lib/third-party/emoji.ts at d9ad12c4b):
 * the carrier exactly as picked, then one variation selector per UTF-8 byte.
 * Tokens already sent were copied with this.
 */
function encodeAs013(emoji: string, text: string): string {
  let encoded = emoji;
  for (const byte of new TextEncoder().encode(text)) {
    encoded += String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16);
  }
  return encoded;
}

/** What a paste of the copied text gives the wallet. */
function paste(copied: string) {
  const text = isEncoded(copied) ? decode(copied, isWellFormedEcashToken) : copied;
  return { text, parsed: parsePaymentInput(text, defaultDetectors) };
}

function failuresOf(emojis: string[], copy: (emoji: string) => string) {
  return emojis.filter((emoji) => {
    const { text, parsed } = paste(copy(emoji));
    return text !== TOKEN || parsed.type !== 'payment';
  });
}

describe('a token copied as an emoji', () => {
  it('is a real-looking cashuB token that parses as a payment on its own', () => {
    expect(TOKEN.startsWith('cashuB')).toBe(true);
    expect(parsePaymentInput(TOKEN, defaultDetectors).type).toBe('payment');
  });

  it('offers 1341 emojis, 212 of them carrying U+FE0F', () => {
    // A change to the picker list or to which carriers work shows up here first.
    expect({ offered: PICKER.length, withVs16: withVs16.length }).toEqual({
      offered: 1341,
      withVs16: 212,
    });
  });

  it('round-trips with every emoji the picker offers, and pastes as a payment', () => {
    const failures = failuresOf(PICKER, (emoji) => encode(emoji, TOKEN));
    expect({ tried: PICKER.length, failures }).toEqual({ tried: 1341, failures: [] });
  });

  it('copies without the carrier’s own U+FE0F, so a decoder that stops at the carrier reads it', () => {
    for (const emoji of withVs16) {
      const copied = encode(emoji, TOKEN);
      expect(copied.startsWith(emoji.replaceAll(VS16, ''))).toBe(true);
      expect(copied.includes(VS16)).toBe(false);
      // The decoder as cashu.me and 0.1.3 have it, with no repair.
      expect(decode(copied)).toBe(TOKEN);
    }
  });

  it('pastes a token 0.1.3 copied with any emoji that has U+FE0F', () => {
    const failures = failuresOf(withVs16, (emoji) => encodeAs013(emoji, TOKEN));
    expect({ tried: withVs16.length, failures }).toEqual({ tried: 212, failures: [] });
  });

  it('still pastes a token 0.1.3 copied with any other emoji', () => {
    const failures = failuresOf(plain, (emoji) => encodeAs013(emoji, TOKEN));
    expect({ tried: plain.length, failures }).toEqual({ tried: 1129, failures: [] });
  });

  it('leaves hidden text that is not a token as the decoder reads it today', () => {
    for (const emoji of ['🛡️', '❤️‍🔥', '1️⃣', '🥜']) {
      const old = encodeAs013(emoji, 'hello');
      expect(paste(old).text).toBe(decode(old));
    }
    // A payload that really starts with byte 0x0F.
    for (const copied of [encode('🥜', '\u000Fnot a token'), encode('🛡️', '\u000Fnot a token')]) {
      expect(paste(copied).text).toBe('\u000Fnot a token');
    }
  });

  it('does not repair a carrier around a token with no real mint or unsigned proofs', () => {
    const cashuA = (token: unknown) =>
      `cashuA${Buffer.from(JSON.stringify(token)).toString('base64url')}`;
    const malformed = [
      cashuA({ token: [{ mint: 'not a URL', proofs: [{ amount: 8, secret: 'x' }] }] }),
      cashuA({ token: [{ mint: 'https://mint.example', proofs: [{ amount: 8, secret: 'x' }] }] }),
    ];
    for (const hidden of malformed) {
      const old = encodeAs013('❤️', hidden);
      expect(paste(old).text).toBe(decode(old));
      expect(paste(old).parsed.type).toBe('unknown');
    }
  });

  it('leaves plain text with an ordinary emoji untouched', () => {
    expect(paste('thanks 🥜').text).toBe('thanks 🥜');
    expect(paste(`${TOKEN} 🥜`).text).toBe(`${TOKEN} 🥜`);
  });
});

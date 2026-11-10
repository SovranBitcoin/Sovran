/** @jest-environment node */
import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import { defaultDetectors, parsePaymentInput } from 'wallet';

import { CATEGORIES } from '@/shared/lib/popup/popups/emojiData';
import { decode, encode, isEncoded } from '@/shared/lib/third-party/emoji';

/**
 * A token copied "as emoji" and pasted back, with the real codec.
 *
 * Copying hands the picked emoji itself to `encode` (shared/lib/popup/popups/
 * emojiPicker.tsx: the picker's answer is an option whose id is the emoji).
 * Pasting reads the clipboard as the scan source does
 * (features/send/lib/sovranPaymentConfig.ts, `createSovranScanSources`:
 * `isEncoded(rawText) ? decode(rawText) : rawText`) and hands the text to the
 * wallet's input parser.
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

/** What a paste of the copied text gives the wallet. */
function paste(copied: string) {
  const text = isEncoded(copied) ? decode(copied) : copied;
  return { text, parsed: parsePaymentInput(text, defaultDetectors) };
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

  it('round-trips with every emoji that has no U+FE0F, and pastes as a payment', () => {
    const failures = plain.filter((emoji) => {
      const { text, parsed } = paste(encode(emoji, TOKEN));
      return text !== TOKEN || parsed.type !== 'payment';
    });
    expect({ tried: plain.length, failures }).toEqual({ tried: 1129, failures: [] });
  });

  it('does not round-trip with any emoji that has U+FE0F', () => {
    const outcomes = withVs16.map((emoji) => {
      const { text, parsed } = paste(encode(emoji, TOKEN));
      return {
        emoji,
        roundTrips: text === TOKEN,
        startsWithU000F: text.startsWith('\u000F'),
        type: parsed.type,
      };
    });
    // QUIRK: `decode` reads the carrier's own U+FE0F as byte 0x0F, so the pasted
    // text starts with U+000F, the parser sees no token, and a bearer token sent
    // this way cannot be pasted back. Same at 0.1.3.
    expect(outcomes.filter((each) => each.roundTrips)).toEqual([]);
    expect(outcomes.filter((each) => !each.startsWithU000F)).toEqual([]);
    expect(outcomes.filter((each) => each.type !== 'unknown')).toEqual([]);
    expect(outcomes).toHaveLength(212);
  });
});

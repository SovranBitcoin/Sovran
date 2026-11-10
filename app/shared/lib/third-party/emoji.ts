// Variation selectors block https://unicode.org/charts/nameslist/n_FE00.html
// VS1..=VS16
const VARIATION_SELECTOR_START = 0xfe00;
const VARIATION_SELECTOR_END = 0xfe0f;

// Variation selectors supplement https://unicode.org/charts/nameslist/n_E0100.html
// VS17..=VS256
const VARIATION_SELECTOR_SUPPLEMENT_START = 0xe0100;
const VARIATION_SELECTOR_SUPPLEMENT_END = 0xe01ef;

function toVariationSelector(byte: number): string | null {
  if (byte >= 0 && byte < 16) {
    return String.fromCodePoint(VARIATION_SELECTOR_START + byte);
  } else if (byte >= 16 && byte < 256) {
    return String.fromCodePoint(VARIATION_SELECTOR_SUPPLEMENT_START + byte - 16);
  } else {
    return null;
  }
}

function fromVariationSelector(codePoint: number): number | null {
  if (codePoint >= VARIATION_SELECTOR_START && codePoint <= VARIATION_SELECTOR_END) {
    return codePoint - VARIATION_SELECTOR_START;
  } else if (
    codePoint >= VARIATION_SELECTOR_SUPPLEMENT_START &&
    codePoint <= VARIATION_SELECTOR_SUPPLEMENT_END
  ) {
    return codePoint - VARIATION_SELECTOR_SUPPLEMENT_START + 16;
  } else {
    return null;
  }
}

// VS16, the emoji presentation selector many picker emojis carry. Left in the
// carrier, a decoder reads it as byte 0x0F; inside a ZWJ or keycap sequence it
// also ends the run before the payload starts.
const EMOJI_PRESENTATION_SELECTOR = String.fromCodePoint(VARIATION_SELECTOR_END);

export function encode(emoji: string, text: string): string {
  // convert the string to utf-8 bytes
  const bytes = new TextEncoder().encode(text);
  // The carrier keeps no selector of its own, so the payload's selectors are
  // the first run any decoder of this scheme meets.
  let encoded = emoji.split(EMOJI_PRESENTATION_SELECTOR).join('');

  for (const byte of bytes) {
    encoded += toVariationSelector(byte);
  }

  return encoded;
}

function decodeBytes(text: string, skipCarrierSelectors: boolean): Uint8Array {
  let decoded = [];
  const chars = Array.from(text);

  for (const char of chars) {
    const codePoint = char.codePointAt(0)!;
    // Before the payload starts, a VS16 belongs to the carrier emoji.
    if (skipCarrierSelectors && decoded.length === 0 && codePoint === VARIATION_SELECTOR_END) {
      continue;
    }
    const byte = fromVariationSelector(codePoint);

    if (byte === null && decoded.length > 0) {
      break;
    } else if (byte === null) {
      continue;
    }

    decoded.push(byte);
  }

  return new Uint8Array(decoded);
}

/**
 * Read the text hidden after the carrier emoji.
 *
 * With `isToken`, a result that is not a token is read once more without the
 * carrier emoji's own VS16 selectors, which the 0.1.3 encoder left in front of
 * the payload (a leading 0x0F, or a run cut short inside a ZWJ or keycap
 * sequence). That reading is used only when `isToken` accepts it whole;
 * otherwise the first reading stands.
 */
export function decode(text: string, isToken?: (decoded: string) => boolean): string {
  const decoded = new TextDecoder().decode(decodeBytes(text, false));
  if (!isToken || isToken(decoded)) return decoded;
  const repaired = new TextDecoder().decode(decodeBytes(text, true));
  return repaired !== decoded && isToken(repaired) ? repaired : decoded;
}

export function isEncoded(text: string): boolean {
  if (!text || text.length <= 1) {
    return false;
  }

  // Constants from the original code
  const VARIATION_SELECTOR_START = 0xfe00;
  const VARIATION_SELECTOR_END = 0xfe0f;
  const VARIATION_SELECTOR_SUPPLEMENT_START = 0xe0100;
  const VARIATION_SELECTOR_SUPPLEMENT_END = 0xe01ef;

  // Look at each character after the first one (which would be the emoji)
  const chars = Array.from(text);

  // If there's at least one valid variation selector, consider it encoded
  let hasVariationSelector = false;

  // Skip the first character (potential emoji) and check the rest
  for (let i = 1; i < chars.length; i++) {
    const codePoint = chars[i].codePointAt(0)!;

    // Check if the character is a variation selector
    if (
      (codePoint >= VARIATION_SELECTOR_START && codePoint <= VARIATION_SELECTOR_END) ||
      (codePoint >= VARIATION_SELECTOR_SUPPLEMENT_START &&
        codePoint <= VARIATION_SELECTOR_SUPPLEMENT_END)
    ) {
      hasVariationSelector = true;
      break;
    }
  }

  return hasVariationSelector;
}

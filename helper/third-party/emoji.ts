// Variation selectors block https://unicode.org/charts/nameslist/n_FE00.html
// VS1..=VS16
const VARIATION_SELECTOR_START = 0xfe00;
const VARIATION_SELECTOR_END = 0xfe0f;

// Variation selectors supplement https://unicode.org/charts/nameslist/n_E0100.html
// VS17..=VS256
const VARIATION_SELECTOR_SUPPLEMENT_START = 0xe0100;
const VARIATION_SELECTOR_SUPPLEMENT_END = 0xe01ef;

export function toVariationSelector(byte: number): string | null {
  if (byte >= 0 && byte < 16) {
    return String.fromCodePoint(VARIATION_SELECTOR_START + byte);
  } else if (byte >= 16 && byte < 256) {
    return String.fromCodePoint(VARIATION_SELECTOR_SUPPLEMENT_START + byte - 16);
  } else {
    return null;
  }
}

export function fromVariationSelector(codePoint: number): number | null {
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

export function encode(emoji: string, text: string): string {
  // convert the string to utf-8 bytes
  const bytes = new TextEncoder().encode(text);
  let encoded = emoji;

  for (const byte of bytes) {
    encoded += toVariationSelector(byte);
  }

  return encoded;
}

export function decode(text: string): string {
  let decoded = [];
  const chars = Array.from(text);

  for (const char of chars) {
    const byte = fromVariationSelector(char.codePointAt(0)!);

    if (byte === null && decoded.length > 0) {
      break;
    } else if (byte === null) {
      continue;
    }

    decoded.push(byte);
  }

  let decodedArray = new Uint8Array(decoded);
  return new TextDecoder().decode(decodedArray);
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

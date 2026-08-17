/**
 * USB HID keyboard usages (page 0x07) for the simulator driver's text input.
 * serve-sim injects hardware-keyboard events (IndigoHIDMessageForKeyboardArbitrary),
 * so typing works regardless of the software keyboard's plane, layout, or the
 * QuickPath onboarding tip covering it. US layout only — the ephemeral e2e
 * simulators always boot with the default US hardware layout.
 */
interface HidKeystroke {
  usage: number;
  shift: boolean;
}

export const LEFT_SHIFT_USAGE = 0xe1;
/** HID usage for Backspace — used to clear the focus-probe digit. */
export const BACKSPACE_USAGE = 0x2a;

const DIGIT_USAGES: Record<string, number> = {
  '1': 0x1e,
  '2': 0x1f,
  '3': 0x20,
  '4': 0x21,
  '5': 0x22,
  '6': 0x23,
  '7': 0x24,
  '8': 0x25,
  '9': 0x26,
  '0': 0x27,
};

const PLAIN_USAGES: Record<string, number> = {
  ...DIGIT_USAGES,
  '\n': 0x28,
  ' ': 0x2c,
  '-': 0x2d,
  '=': 0x2e,
  '[': 0x2f,
  ']': 0x30,
  '\\': 0x31,
  ';': 0x33,
  "'": 0x34,
  '`': 0x35,
  ',': 0x36,
  '.': 0x37,
  '/': 0x38,
};

const SHIFTED_USAGES: Record<string, number> = {
  '!': DIGIT_USAGES['1']!,
  '@': DIGIT_USAGES['2']!,
  '#': DIGIT_USAGES['3']!,
  $: DIGIT_USAGES['4']!,
  '%': DIGIT_USAGES['5']!,
  '^': DIGIT_USAGES['6']!,
  '&': DIGIT_USAGES['7']!,
  '*': DIGIT_USAGES['8']!,
  '(': DIGIT_USAGES['9']!,
  ')': DIGIT_USAGES['0']!,
  _: PLAIN_USAGES['-']!,
  '+': PLAIN_USAGES['=']!,
  '{': PLAIN_USAGES['[']!,
  '}': PLAIN_USAGES[']']!,
  '|': PLAIN_USAGES['\\']!,
  ':': PLAIN_USAGES[';']!,
  '"': PLAIN_USAGES["'"]!,
  '~': PLAIN_USAGES['`']!,
  '<': PLAIN_USAGES[',']!,
  '>': PLAIN_USAGES['.']!,
  '?': PLAIN_USAGES['/']!,
};

export function hidKeystrokeFor(char: string): HidKeystroke {
  if (char >= 'a' && char <= 'z') {
    return { usage: 0x04 + (char.charCodeAt(0) - 97), shift: false };
  }
  if (char >= 'A' && char <= 'Z') {
    return { usage: 0x04 + (char.charCodeAt(0) - 65), shift: true };
  }
  const plain = PLAIN_USAGES[char];
  if (plain !== undefined) return { usage: plain, shift: false };
  const shifted = SHIFTED_USAGES[char];
  if (shifted !== undefined) return { usage: shifted, shift: true };
  throw new Error(
    `text input contains a character with no US-layout HID mapping: ${JSON.stringify(char)}`
  );
}

export function hidKeystrokesFor(text: string): HidKeystroke[] {
  return [...text].map(hidKeystrokeFor);
}

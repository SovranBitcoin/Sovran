/**
 * Text as the key presses of a hardware keyboard (US layout): for each
 * character, the key's HID usage and whether Shift is held. A character the
 * layout has no key for is refused, since it would otherwise be typed as
 * nothing and the step would fail somewhere later for no visible reason.
 */
export const SHIFT_KEY = 0xe1;

// In key order from usage 0x04. \u0000 holds the place of a key this layout does not have.
const PLAIN = "abcdefghijklmnopqrstuvwxyz1234567890\n\u001b\b\t -=[]\\\u0000;'`,./";
const SHIFTED =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()\u0000\u0000\u0000\u0000\u0000_+{}|\u0000:"~<>?';

interface KeyPress {
  usage: number;
  shift: boolean;
}

export function keyPresses(text: string): KeyPress[] {
  return [...text].map((character) => {
    if (character === '\u0000') throw new Error('No key types a null character.');
    const plain = PLAIN.indexOf(character);
    if (plain !== -1) return { usage: 0x04 + plain, shift: false };
    const shifted = SHIFTED.indexOf(character);
    if (shifted !== -1) return { usage: 0x04 + shifted, shift: true };
    throw new Error(`No key types ${JSON.stringify(character)} on the simulator's keyboard.`);
  });
}

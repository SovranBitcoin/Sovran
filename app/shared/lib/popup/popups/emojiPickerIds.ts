export function emojiCodepointKey(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)?.toString(16) ?? 'unknown')
    .join('-');
}

export function emojiPickerOptionTestID(emoji: string): string {
  return `emoji-picker-option-${emojiCodepointKey(emoji)}`;
}

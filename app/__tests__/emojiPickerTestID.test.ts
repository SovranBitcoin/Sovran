import { emojiPickerOptionTestID } from '@/shared/lib/popup/popups/emojiPickerIds';

describe('emoji picker option IDs', () => {
  it.each([
    ['😀', 'emoji-picker-option-1f600'],
    ['❤️', 'emoji-picker-option-2764-fe0f'],
    ['👍🏽', 'emoji-picker-option-1f44d-1f3fd'],
  ])('derives %s from Unicode code points', (emoji, expected) => {
    expect(emojiPickerOptionTestID(emoji)).toBe(expected);
  });
});

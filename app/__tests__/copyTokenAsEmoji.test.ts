/**
 * @jest-environment node
 *
 * Copying a token as an emoji: the token is encoded into the emoji picked in
 * the emoji sheet, and the confirmation waits until the sheet has gone.
 */

import * as Clipboard from 'expo-clipboard';

import { copyTokenAsEmoji } from '@/shared/lib/popup/popups/emojiPicker';
import { copyPopup } from '@/shared/lib/popup/popups/copy';
import type { PickerResult } from '@/shared/lib/picker/types';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/shared/lib/popup/popups/copy', () => ({ copyPopup: jest.fn() }));
jest.mock('@/shared/lib/third-party/emoji', () => ({
  encode: (emoji: string, token: string) => `${emoji}<${token}>`,
}));
jest.mock('@/shared/ui/primitives/AnimatedEmoji', () => ({ AnimatedEmoji: () => null }));
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { log: { ...entry, child: () => entry } };
});

let answer: (result: PickerResult) => void = () => {};
let close: () => void = () => {};
jest.mock('@/shared/lib/picker/openEmojiPicker', () => ({
  openEmojiPicker: () => ({
    result: new Promise<PickerResult>((resolve) => (answer = resolve)),
    closed: new Promise<void>((resolve) => (close = resolve)),
    update: jest.fn(),
  }),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => jest.clearAllMocks());

describe('copyTokenAsEmoji', () => {
  it('copies the token inside the picked emoji, and confirms once the sheet has gone', async () => {
    const done = copyTokenAsEmoji('cashuBtoken');
    answer({ kind: 'option', id: '🥜' });
    await flush();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('🥜<cashuBtoken>');
    expect(copyPopup).not.toHaveBeenCalled();

    close();
    await done;
    expect(copyPopup).toHaveBeenCalledWith('token', expect.anything());
  });

  it('copies nothing when the sheet is dismissed', async () => {
    const done = copyTokenAsEmoji('cashuBtoken');
    answer({ kind: 'dismissed' });
    close();
    await done;
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    expect(copyPopup).not.toHaveBeenCalled();
  });
});

/**
 * Copy a Cashu token hidden inside an emoji: the person picks the emoji in the
 * emoji sheet, and the token is copied encoded into it.
 *
 * Usage:
 *   import { copyTokenAsEmoji } from '@/shared/lib/popup';
 *   void copyTokenAsEmoji(getEncodedTokenV4(myToken));
 */

import * as Clipboard from 'expo-clipboard';

import { log } from '@/shared/lib/logger';
import { openEmojiPicker } from '@/shared/lib/picker/openEmojiPicker';
import { encode } from '@/shared/lib/third-party/emoji';
import { AnimatedEmoji } from '@/shared/ui/primitives/AnimatedEmoji';

import { copyPopup } from './copy';

const emojiLog = log.child({ module: 'emojiPicker' });

export async function copyTokenAsEmoji(token: string): Promise<void> {
  emojiLog.info('emojiPicker.invoke', { tokenLen: token.length });
  // The token stays here, with the opener: the sheet only answers which
  // emoji, so it never holds or shows the bearer value.
  const picker = openEmojiPicker();
  const result = await picker.result;
  if (result.kind !== 'option') return;
  await Clipboard.setStringAsync(encode(result.id, token));
  // The confirmation is a toast, which paints beneath a system sheet.
  await picker.closed;
  copyPopup('token', { icon: <AnimatedEmoji emoji={result.id} size={28} /> });
}

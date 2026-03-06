import { showActionSheet } from '../bridge';
import type { ActionSheetPayloads } from '../actionSheetTypes';

export function profileSwitcherPopup(payload: ActionSheetPayloads['profile-switcher']): void {
  showActionSheet('profile-switcher', payload);
}

export function emojiPickerPopup(payload: ActionSheetPayloads['emoji-picker']): void {
  showActionSheet('emoji-picker', payload);
}

export function buttonHandlerPopup(payload: ActionSheetPayloads['button-handler']): void {
  showActionSheet('button-handler', payload);
}

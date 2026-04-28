import { popup } from '../engine';
import type { PopupOverrides, TextOverrides } from './types';

export function testSheetPopup(overrides?: PopupOverrides): void {
  popup({
    message: 'Test Sheet',
    text: 'If you see this, the popup sheet system is working.',
    icon: 'icon:mdi:check-circle',
    type: 'success',
    variant: 'sheet',
    buttons: [{ text: 'Close', onPress: () => {} }],
    ...overrides,
  });
}

export function devModePopup(enabled: boolean): void {
  popup({
    message: enabled ? 'Developer mode enabled' : 'Developer mode disabled',
    icon: 'icon:material-symbols:report-rounded',
    type: 'success',
  });
}

export function deeplinkFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to process link',
    icon: 'icon:lucide:link',
    type: 'error',
    ...overrides,
  });
}

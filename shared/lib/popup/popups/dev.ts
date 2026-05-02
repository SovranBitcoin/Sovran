import { makeStaticPopup, makeParamPopup } from './factory';

export const testSheetPopup = makeStaticPopup({
  message: 'Test Sheet',
  text: 'If you see this, the popup sheet system is working.',
  icon: 'icon:mdi:check-circle',
  type: 'success',
  variant: 'sheet',
  buttons: [{ text: 'Close', onPress: () => {} }],
});

export const devModePopup = makeParamPopup<boolean>((enabled) => ({
  message: enabled ? 'Developer mode enabled' : 'Developer mode disabled',
  icon: 'icon:material-symbols:report-rounded',
  type: 'success',
}));

export const deeplinkFailedPopup = makeStaticPopup({
  message: 'Failed to process link',
  icon: 'icon:lucide:link',
  type: 'error',
});

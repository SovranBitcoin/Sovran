import { makeStaticPopup } from './factory';

const KEY_ICON = 'icon:solar:key-bold';

export const keyGeneratedPopup = makeStaticPopup({
  message: 'New key generated',
  icon: KEY_ICON,
  type: 'success',
});

export const keyGenerateFailedPopup = makeStaticPopup({
  message: 'Failed to generate key',
  icon: KEY_ICON,
  type: 'error',
});

export const keysLoadFailedPopup = makeStaticPopup({
  message: 'Failed to load keys',
  icon: KEY_ICON,
  type: 'error',
});

export const keyImportedPopup = makeStaticPopup({
  message: 'Key imported successfully',
  icon: KEY_ICON,
  type: 'success',
});

export const keyImportFailedPopup = makeStaticPopup({
  message: 'Failed to import key',
  icon: KEY_ICON,
  type: 'error',
});

export const invalidKeyFormatPopup = makeStaticPopup({
  message: 'Invalid Key Format',
  text: 'Enter nsec or 64-character hex key.',
  icon: KEY_ICON,
  type: 'error',
});

export const passcodeNotMatchPopup = makeStaticPopup({
  message: 'Passcode Not Match',
  text: 'The passcode does not match. Please try again.',
  icon: 'icon:mdi:shield',
  type: 'error',
});

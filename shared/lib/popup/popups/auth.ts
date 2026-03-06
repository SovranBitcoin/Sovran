import { popup } from '../engine';
import type { BaseOverrides, TextOverrides } from './types';

export function keyGeneratedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'New key generated',
    type: 'success',
    icon: 'icon:solar:key-bold',
    ...overrides,
  });
}

export function keyGenerateFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to generate key',
    icon: 'icon:mdi:key-alert',
    type: 'error',
    ...overrides,
  });
}

export function keysLoadFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to load keys',
    icon: 'icon:mdi:key-alert',
    type: 'error',
    ...overrides,
  });
}

export function keyImportedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Key imported successfully',
    type: 'success',
    icon: 'icon:solar:key-bold',
    ...overrides,
  });
}

export function keyImportFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to import key',
    icon: 'icon:mdi:key-remove',
    type: 'error',
    ...overrides,
  });
}

export function invalidKeyFormatPopup(): void {
  popup({
    message: 'Invalid Key Format',
    text: 'Enter nsec or 64-character hex key.',
    icon: 'icon:mdi:key-remove',
    type: 'error',
  });
}

export function passcodeNotMatchPopup(): void {
  popup({
    message: 'Passcode Not Match',
    text: 'The passcode does not match. Please try again.',
    icon: 'icon:mdi:lock-alert',
    type: 'error',
  });
}

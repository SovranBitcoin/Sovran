import { popup } from '../engine';
import type { BaseOverrides } from './types';

export function cameraPermissionPopup(
  status: 'granted' | 'denied' | 'blocked',
  overrides?: BaseOverrides
): void {
  if (status === 'granted') {
    popup({
      message: 'Camera Permission Granted',
      text: 'Camera access has been granted.',
      icon: 'icon:mdi:camera',
      type: 'success',
      ...overrides,
    });
  } else if (status === 'denied') {
    popup({
      message: 'Camera Permission Denied',
      text: 'Camera access is denied. Please enable it in your device settings.',
      icon: 'icon:mdi:camera',
      type: 'error',
      ...overrides,
    });
  } else {
    popup({
      message: 'Camera Permission Blocked',
      text: 'Camera access is blocked. Please enable it in your device settings.',
      icon: 'icon:mdi:camera',
      buttons: [{ text: 'Open Settings', page: 'settings' }],
      type: 'error',
      ...overrides,
    });
  }
}

export function noQrCodeFoundPopup(): void {
  popup({ message: 'No QR code found in image', icon: 'icon:mdi:qrcode', type: 'info' });
}

export function qrScanFailedPopup(): void {
  popup({
    message: 'Failed to scan QR code from image',
    icon: 'icon:mdi:qrcode',
    type: 'error',
  });
}

import { makeStaticPopup, makeParamPopup } from './factory';

const CAMERA_ICON = 'icon:mdi:camera';
const QR_ICON = 'icon:mdi:qrcode';

export const cameraPermissionPopup = makeParamPopup<'granted' | 'denied' | 'blocked'>((status) => {
  if (status === 'granted') {
    return {
      message: 'Camera Permission Granted',
      text: 'Camera access has been granted.',
      icon: CAMERA_ICON,
      type: 'success',
    };
  }
  if (status === 'denied') {
    return {
      message: 'Camera Permission Denied',
      text: 'Camera access is denied. Please enable it in your device settings.',
      icon: CAMERA_ICON,
      type: 'error',
    };
  }
  return {
    message: 'Camera Permission Blocked',
    text: 'Camera access is blocked. Please enable it in your device settings.',
    icon: CAMERA_ICON,
    buttons: [{ text: 'Open Settings', page: 'settings' }],
    type: 'error',
  };
});

export const noQrCodeFoundPopup = makeStaticPopup({
  message: 'No QR code found in image',
  icon: QR_ICON,
  type: 'info',
});

export const qrScanFailedPopup = makeStaticPopup({
  message: 'Failed to scan QR code from image',
  icon: QR_ICON,
  type: 'error',
});

/** Props shared by every camera action-row variant. */
export interface CameraActionButtonsProps {
  onPaste: () => void | Promise<void>;
  /** Omit to hide the gallery button (signer-pair mode cannot decode images). */
  onGallery?: () => void | Promise<void>;
  onToggleFlashlight: () => void;
  /** `null` until the camera reports ready; treated as off. */
  flashlightOn: boolean | null;
}

/** Names and testIDs for the three actions, identical across variants. */
export const CAMERA_ACTIONS = {
  paste: { testID: 'camera-paste', label: 'Paste from clipboard' },
  gallery: { testID: 'camera-gallery', label: 'Scan from photo library' },
  flashlight: {
    testID: 'camera-flashlight',
    label: 'Flashlight',
    labelOn: 'Flashlight, on',
    labelOff: 'Flashlight, off',
  },
} as const;

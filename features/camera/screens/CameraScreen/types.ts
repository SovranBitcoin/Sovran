export interface ScanningData {
  data: string;
  type?: string;
}

export interface CameraScreenShared {
  foreground: string;
  insets: { bottom: number; top: number; left: number; right: number };
  progress: number;
  flashlightOn: boolean | null;
  loading: boolean;
  hasPermission: boolean;
  requestPermission: () => void;
  handleScan: (data: { data?: string }) => void;
  handleCameraReady: () => void;
  handleClipboardPress: () => void;
  handleGalleryPress: () => void;
  toggleFlashlight: () => void;
}

export interface ScanningData {
  data: string;
  type?: string;
}

export interface CameraScreenProps {
  scanLocked?: boolean;
}

export interface CameraScreenShared {
  foreground: string;
  insets: { bottom: number; top: number; left: number; right: number };
  progress: number;
  flashlightOn: boolean | null;
  loading: boolean;
  hasPermission: boolean;
  scanLocked: boolean;
  handleScan: (data: { data?: string }) => void;
  handleCameraReady: () => void;
  handleClipboardPress: () => void;
  handleGalleryPress: () => void;
  toggleFlashlight: () => void;
}

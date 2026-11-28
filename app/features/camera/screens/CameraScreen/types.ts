import type { CameraPermissionView } from '@/features/camera/hooks/useHandleCameraPermission';

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
  permissionView: CameraPermissionView;
  requestPermission: () => void;
  handleScan: (data: { data?: string }) => void;
  handleCameraReady: () => void;
  handleClipboardPress: () => void;
  handleGalleryPress: () => void;
  toggleFlashlight: () => void;
}

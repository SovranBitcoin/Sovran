import { useState, useCallback, useEffect, useRef } from 'react';
import { Dimensions, AppState } from 'react-native';
import { useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { debugLog } from '@/shared/lib/debugLog';
import { noQrCodeFoundPopup, qrScanFailedPopup } from '@/shared/lib/popup';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaste } from '@/shared/hooks/usePaste';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

const { width: screenWidth } = Dimensions.get('window');
export const scanBoxSize = screenWidth * 0.8;

export interface ScanningData {
  data: string;
  /**
   * Optional source hint for scans.
   * Common values: 'paste', 'deeplink', 'qr'.
   */
  type?: string;
}

export interface CameraScreenProps {
  onScan: (
    data: ScanningData
  ) => Promise<void | { urInProgress: boolean; progress?: number; lockedPending?: boolean }>;
  onReset?: () => void;
  scanLocked?: boolean;
  /** Called once on mount with an `unlock` function that resets the processing lock. */
  onRegisterUnlock?: (unlock: () => void) => void;
}

export interface CameraScreenShared {
  foreground: string;
  insets: { bottom: number; top: number; left: number; right: number };
  progress: number;
  flashlightOn: boolean | null;
  loading: boolean;
  hasPermission: boolean;
  scanLocked: boolean;
  handleScan: (data: ScanningData) => Promise<void>;
  handleCameraReady: () => Promise<void>;
  handleClipboardPress: () => Promise<void>;
  handleGalleryPress: () => Promise<void>;
  toggleFlashlight: () => void;
}

export function useCameraScreen({
  onScan,
  onReset,
  scanLocked = false,
  onRegisterUnlock,
}: CameraScreenProps): CameraScreenShared {
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState<number>(0);
  const [flashlightOn, setFlashlightOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasPermission] = useCameraPermissions();
  const [isFocused, setIsFocused] = useState<boolean>(true);
  const appStateRef = useRef<string>(AppState.currentState);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      setProgress(0);
      setLoading(false);
      isProcessingRef.current = false;
      onReset?.();

      return () => {
        setIsFocused(false);
      };
    }, [onReset])
  );

  const isProcessingRef = useRef<boolean>(false);

  const unlock = useCallback(() => {
    isProcessingRef.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    onRegisterUnlock?.(unlock);
  }, [onRegisterUnlock, unlock]);

  const handleScan = useCallback(
    async (data: ScanningData) => {
      // #region agent log
      debugLog({
        location: 'useCameraScreen.ts:handleScan',
        message: 'camera handleScan before',
        phase: 'before',
        data: { dataLen: data?.data?.length, type: data?.type },
      });
      // #endregion
      if (scanLocked) return;

      const isUrCode = data.data.toLowerCase().startsWith('ur:');

      if (appStateRef.current !== 'active' || !isFocused) return;

      if (!isUrCode && isProcessingRef.current) return;

      isProcessingRef.current = true;
      setLoading(true);
      try {
        const result = await onScan(data);
        // #region agent log
        debugLog({
          location: 'useCameraScreen.ts:handleScan',
          message: 'camera handleScan after onScan',
          phase: 'after',
          data: {
            urInProgress:
              result && typeof result === 'object' && 'urInProgress' in result
                ? (result as any).urInProgress
                : undefined,
          },
        });
        // #endregion
        const urInProgress =
          result && typeof result === 'object' && 'urInProgress' in result
            ? result.urInProgress
            : false;

        if (
          result &&
          typeof result === 'object' &&
          'progress' in result &&
          typeof result.progress === 'number'
        ) {
          setProgress(result.progress);
        }

        const lockedPending =
          result && typeof result === 'object' && 'lockedPending' in result
            ? result.lockedPending
            : false;

        if (!urInProgress && !lockedPending) {
          setLoading(false);
          setProgress(0);
          isProcessingRef.current = false;
        }
      } catch {
        setLoading(false);
        setProgress(0);
        isProcessingRef.current = false;
      }
    },
    [onScan, isFocused, scanLocked]
  );

  const toggleFlashlight = useCallback((): void => {
    setFlashlightOn((prev) => !prev);
  }, []);

  const handleCameraReady = useCallback(async (): Promise<void> => {
    try {
      setTimeout(() => {
        setFlashlightOn(false);
      }, 1000);
    } catch {
      // Silent error handling
    }
  }, []);

  const handleGalleryPress = useCallback(async (): Promise<void> => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const scannedCodes = await scanFromURLAsync(result.assets[0].uri, ['qr']);

      if (scannedCodes.length === 0) {
        noQrCodeFoundPopup();
        return;
      }

      const scanning: ScanningData = { data: scannedCodes[0].data, type: 'qr' };
      await handleScan(scanning);
    } catch {
      qrScanFailedPopup();
    }
  }, [handleScan]);

  const { handlePaste: handleClipboardPress } = usePaste({
    onPaste: async (text) => {
      const scanning: ScanningData = { data: text, type: 'paste' };
      await handleScan(scanning);
    },
  });

  return {
    foreground,
    insets,
    progress,
    flashlightOn,
    loading,
    hasPermission: !!hasPermission?.granted,
    scanLocked,
    handleScan,
    handleCameraReady,
    handleClipboardPress,
    handleGalleryPress,
    toggleFlashlight,
  };
}

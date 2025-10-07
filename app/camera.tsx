import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Dimensions, AppState } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { Text } from 'components/ui/Text';
import { Button } from 'components/ui/Button';
import { useSelector } from 'react-redux';
import * as Clipboard from 'expo-clipboard';
import { showMessage } from 'helper/popup/popups';
import Icon from 'assets/icons';
import { View, HStack } from 'components/ui/View';
import { useProcessPaymentString } from '@/hooks/useProcessPaymentString';

// Screen dimensions
const { width: screenWidth } = Dimensions.get('window');
const scanBoxSize = screenWidth * 0.8;

interface ScanningData {
  data: string;
  type?: string;
}

/**
 * Camera component for QR code scanning
 */
const Camera: React.FC = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const { getPrimaryColor } = useTheme();
  const [progress, setProgress] = useState<number>(0);
  const [flashlightOn, setFlashlightOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasPermission] = useCameraPermissions();
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const [isFocused, setIsFocused] = useState<boolean>(true);
  const appStateRef = useRef<string>(AppState.currentState);

  const { processPaymentString, reset } = useProcessPaymentString({
    unit,
    selectedMint,
    isFocused,
    onProgress: setProgress,
    onLoading: setLoading,
    onScanned: () => {}, // We'll handle this in the hook
  });

  // Monitor app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  // Reset state when component comes into focus
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      reset();

      return () => {
        setIsFocused(false);
      };
    }, [reset])
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
      // Silent error handling - consider logging in production
    }
  }, []);

  const handleGalleryPress = useCallback(async (): Promise<void> => {
    showMessage('feature_coming_soon', {}, { emoji: '📸' });
  }, []);

  const handleClosePress = useCallback((): void => {
    router.back();
  }, []);

  const handleClipboardPress = useCallback(async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;

    const scanning: ScanningData = { data: text };
    await processPaymentString(scanning);
  }, [processPaymentString]);

  // Return empty container if no camera permissions
  if (!hasPermission?.granted) {
    return <View className="relative flex-1 bg-black" />;
  }

  return (
    <View className="relative flex-1 bg-black">
      <CameraView
        mute
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          top: 0,
        }}
        facing="back"
        enableTorch={flashlightOn ?? false}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onCameraReady={handleCameraReady}
        onBarcodeScanned={processPaymentString}
      />

      {/* Close button in top left */}
      <View className="absolute left-6 top-12 z-10">
        <Button
          onPress={handleClosePress}
          icon={<Icon name="material-symbols:close-rounded" color={getPrimaryColor('0')} />}
          blur
        />
      </View>

      {/* Scanning overlay with white corners and progress text */}
      <View
        className="absolute left-1/2 top-1/2"
        style={{
          width: scanBoxSize,
          height: scanBoxSize,
          transform: [{ translateX: -scanBoxSize / 2 }, { translateY: -scanBoxSize / 2 }],
        }}>
        {/* Top-left corner */}
        <View className="absolute left-0 top-0 h-[30px] w-[30px] border-l-4 border-t-4 border-white shadow-sm shadow-black" />

        {/* Top-right corner */}
        <View
          className="absolute right-0 top-0 h-[30px] w-[30px] shadow-sm"
          style={{
            borderTopWidth: 4,
            borderRightWidth: 4,
            borderColor: 'white',
            shadowColor: 'black',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.2,
            shadowRadius: 1,
            elevation: 2,
          }}
        />

        {/* Bottom-left corner */}
        <View
          className="absolute bottom-0 left-0 h-[30px] w-[30px] shadow-sm"
          style={{
            borderBottomWidth: 4,
            borderLeftWidth: 4,
            borderColor: 'white',
            shadowColor: 'black',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.2,
            shadowRadius: 1,
            elevation: 2,
          }}
        />

        {/* Bottom-right corner */}
        <View
          className="absolute bottom-0 right-0 h-[30px] w-[30px] shadow-sm"
          style={{
            borderBottomWidth: 4,
            borderRightWidth: 4,
            borderColor: 'white',
            shadowColor: 'black',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.2,
            shadowRadius: 1,
            elevation: 2,
          }}
        />

        {/* Progress text */}
        <View className="absolute bottom-0 self-center rounded-lg bg-black/50 p-2">
          {progress > 0 ? (
            <Text className="text-primary-0" style={{ fontSize: 16 }}>
              Progress: {Math.round(progress * 100)}%
            </Text>
          ) : loading ? (
            <Text className="text-primary-0" style={{ fontSize: 16 }}>
              Loading...
            </Text>
          ) : (
            <Text className="text-primary-0" style={{ fontSize: 16 }}>
              Scanning...
            </Text>
          )}
        </View>
      </View>

      {/* Bottom buttons container */}
      <HStack justify="space-between" className="absolute bottom-24 left-0 right-0 w-full px-8">
        <Button
          onPress={handleClipboardPress}
          icon={<Icon name="lets-icons:copy" color={getPrimaryColor('0')} />}
          blur
        />
        <Button
          onPress={handleGalleryPress}
          icon={<Icon name="proicons:photo" color={getPrimaryColor('0')} />}
          blur
        />
        <Button
          onPress={toggleFlashlight}
          icon={
            !flashlightOn ? (
              <Icon name="mdi:lightbulb-on-outline" color={getPrimaryColor('0')} />
            ) : (
              <Icon name="mdi:lightbulb-on" color={getPrimaryColor('0')} />
            )
          }
          blur
        />
      </HStack>
    </View>
  );
};

export default Camera;

import React, { useEffect, useState, useCallback } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from 'expo-router';
import { greys } from 'helper/colors';
import { URDecoder } from '@gandlaf21/bc-ur';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import * as Clipboard from 'expo-clipboard';
import { showMessage } from 'helper/popup/popups';
import Icon from 'assets/icons';
import { barcodeHandler } from 'helper/payment-handler/handlers';
import { View } from 'components/common/View';

// Screen dimensions
const { width: screenWidth } = Dimensions.get('window');
const scanBoxSize = screenWidth * 0.8;

// Type definitions
type BlurTint = 'light' | 'dark' | 'default';

interface ScanningData {
  data: string;
  type?: string;
}

interface BlurredCircleButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  tint?: BlurTint;
}

/**
 * BlurredCircleButton - A reusable button component with blur effect
 */
const BlurredCircleButton: React.FC<BlurredCircleButtonProps> = ({
  onPress,
  children,
  style,
  intensity = 75,
  tint = 'dark',
}) => {
  return (
    <View blur blurIntensity={intensity} blurTint={tint} style={[styles.blurContainer, style]}>
      <TouchableOpacity className="m-auto items-center rounded-lg " onPress={onPress}>
        {children}
      </TouchableOpacity>
    </View>
  );
};

/**
 * Camera component for QR code scanning
 */
const Camera: React.FC = () => {
  const theme = useSelector(memoizedGetTheme);
  const [scanned, setScanned] = useState<boolean>(false);
  const [urDecoder, setUrDecoder] = useState<URDecoder>(new URDecoder());
  const [progress, setProgress] = useState<number>(0);
  const [flashlightOn, setFlashlightOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const navigation = useNavigation();
  const { unit } = useTypedRoute<'camera'>();
  const [hasPermission] = useCameraPermissions();
  const selectedMint = useSelector(memoizedGetSelectedMint);

  // Reset state when component comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setScanned(false);
      setLoading(false);
      setProgress(0);
      setUrDecoder(new URDecoder());
    });
    return unsubscribe;
  }, [navigation]);

  const toggleFlashlight = useCallback((): void => {
    setFlashlightOn((prev) => !prev);
  }, []);

  const handleClipboardPress = useCallback(async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;

    const scanning: ScanningData = { data: text };
    setLoading(true);
    const res = await barcodeHandler({
      scanning,
      navigation,
      urDecoder,
      unit,
      selectedMint,
      setProgress,
      setLoading,
      setScanned,
    });
    if (res.isErr()) {
      showMessage(res.error.message, {}, { emoji: '🚨' });
    }
  }, [navigation, urDecoder, unit, selectedMint]);

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
    navigation.goBack();
  }, [navigation]);

  const handleBarcodeScanned = useCallback(
    async (scanning: ScanningData): Promise<void> => {
      if (!navigation.isFocused()) {
        return;
      }

      if (!scanned || scanning.data.startsWith('ur:')) {
        setLoading(true);
        const res = await barcodeHandler({
          scanning,
          navigation,
          urDecoder,
          unit,
          selectedMint,
          setProgress,
          setLoading,
          setScanned,
        });
        if (res.isErr()) {
          showMessage(res.error.message, {}, { emoji: '🚨' });
        }
      }
    },
    [navigation, scanned, urDecoder, unit, selectedMint]
  );

  // Return empty container if no camera permissions
  if (!hasPermission?.granted) {
    return <View className="relative flex-1 bg-black" />;
  }

  return (
    <View className="relative flex-1 bg-black">
      <CameraView
        mute
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={flashlightOn ?? false}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onCameraReady={handleCameraReady}
        onBarcodeScanned={handleBarcodeScanned}
      />

      {/* Close button in top left */}
      <View className="absolute left-6 top-12 z-10">
        <BlurredCircleButton onPress={handleClosePress}>
          <Icon name="material-symbols:close-rounded" color={greys(theme)[0]} />
        </BlurredCircleButton>
      </View>

      {/* Scanning overlay with white corners and progress text */}
      <View style={styles.scanBoxContainer}>
        <View style={styles.scanBoxTopLeft} />
        <View style={styles.scanBoxTopRight} />
        <View style={styles.scanBoxBottomLeft} />
        <View style={styles.scanBoxBottomRight} />
        <View className="absolute bottom-0 self-center rounded-lg bg-black/50 p-2">
          {progress > 0 ? (
            <Text style={{ color: greys(theme)[0], fontSize: 16 }}>
              Progress: {Math.round(progress * 100)}%
            </Text>
          ) : loading ? (
            <Text style={{ color: greys(theme)[0], fontSize: 16 }}>Loading...</Text>
          ) : (
            <Text style={{ color: greys(theme)[0], fontSize: 16 }}>Scanning...</Text>
          )}
        </View>
      </View>

      {/* Bottom buttons container */}
      <View className="absolute bottom-24 left-0 right-0 flex-row items-center justify-between px-8">
        <BlurredCircleButton onPress={handleClipboardPress}>
          <Icon name="lets-icons:copy" color={greys(theme)[0]} />
        </BlurredCircleButton>
        <BlurredCircleButton onPress={handleGalleryPress}>
          <Icon name="proicons:photo" color={greys(theme)[0]} />
        </BlurredCircleButton>
        <BlurredCircleButton onPress={toggleFlashlight}>
          {!flashlightOn ? (
            <Icon name="mdi:lightbulb-on-outline" color={greys(theme)[0]} />
          ) : (
            <Icon name="mdi:lightbulb-on" color={greys(theme)[0]} />
          )}
        </BlurredCircleButton>
      </View>
    </View>
  );
};

// Styles that couldn't be migrated to tailwind
const styles = StyleSheet.create({
  blurContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
  },
  scanBoxContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: scanBoxSize,
    height: scanBoxSize,
    transform: [{ translateX: -scanBoxSize / 2 }, { translateY: -scanBoxSize / 2 }],
  },
  scanBoxTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 30,
    height: 30,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: 'white', // Using white directly since we don't need theming here for visibility
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  scanBoxTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 30,
    height: 30,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: 'white',
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  scanBoxBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: 'white',
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  scanBoxBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: 'white',
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
});

export default Camera;

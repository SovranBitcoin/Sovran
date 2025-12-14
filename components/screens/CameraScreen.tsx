/**
 * @fileoverview Shared Camera screen component
 *
 * This module provides the core camera UI for QR code scanning.
 * Payment processing and navigation routing are handled via callbacks.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Dimensions, AppState } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { Button } from 'components/ui/Button';
import { popup } from '@/helper/popup';
import Icon from 'assets/icons';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: screenWidth } = Dimensions.get('window');
const scanBoxSize = screenWidth * 0.8;

export interface ScanningData {
  data: string;
  type?: string;
}

interface CameraScreenProps {
  onScan: (data: ScanningData) => Promise<void | { urInProgress: boolean; progress?: number }>;
  onReset?: () => void;
  showCustomCloseButton?: boolean;
  onClose?: () => void;
}

export function CameraScreen({
  onScan,
  onReset,
  showCustomCloseButton = false,
  onClose,
}: CameraScreenProps) {
  const { getPrimaryColor } = useTheme();
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

  const handleScan = useCallback(
    async (data: ScanningData) => {
      // For UR codes, allow processing even when isProcessingRef is true
      // to accumulate multiple parts
      const isUrCode = data.data.toLowerCase().startsWith('ur:');

      if (appStateRef.current !== 'active' || !isFocused) {
        return;
      }

      // For non-UR codes, skip if already processing
      if (!isUrCode && isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      setLoading(true);
      try {
        const result = await onScan(data);
        // Only reset loading state if UR is not in progress
        // result may be undefined for older implementations
        const urInProgress =
          result && typeof result === 'object' && 'urInProgress' in result
            ? result.urInProgress
            : false;

        // Update progress if available
        if (
          result &&
          typeof result === 'object' &&
          'progress' in result &&
          typeof result.progress === 'number'
        ) {
          setProgress(result.progress);
        }

        if (!urInProgress) {
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
    [onScan, isFocused]
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
    popup({ message: 'feature_coming_soon', emoji: '📸', type: 'info' });
  }, []);

  const handleClipboardPress = useCallback(async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;

    const scanning: ScanningData = { data: text, type: 'paste' };
    await handleScan(scanning);
  }, [handleScan]);

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
        onBarcodeScanned={handleScan}
      />

      {/* Custom close button - only shown for standalone camera */}
      {showCustomCloseButton && onClose && (
        <View className="absolute left-6 top-12 z-10">
          <Button
            onPress={onClose}
            icon={<Icon name="material-symbols:close-rounded" color={getPrimaryColor('0')} />}
            blur
          />
        </View>
      )}

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
            <Text className="text-primary-0" size={16}>
              Progress: {Math.round(progress * 100)}%
            </Text>
          ) : loading ? (
            <Text className="text-primary-0" size={16}>
              Loading...
            </Text>
          ) : (
            <Text className="text-primary-0" size={16}>
              Scanning...
            </Text>
          )}
        </View>
      </View>

      {/* Bottom buttons */}
      <HStack
        justify="space-between"
        style={{ paddingBottom: showCustomCloseButton ? 24 : insets.bottom + 24 }}
        className="absolute bottom-0 left-0 right-0 w-full px-8">
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
}

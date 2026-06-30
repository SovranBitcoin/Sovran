import React from 'react';
import { useWindowDimensions } from 'react-native';
import { CameraView } from 'expo-camera';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import type { CameraScreenShared } from './types';
import { Log } from '@/shared/lib/logger';

interface CameraLayoutProps extends CameraScreenShared {
  children: React.ReactNode;
}

export function CameraLayout({
  insets,
  progress,
  flashlightOn,
  loading,
  hasPermission,
  requestPermission,
  handleScan,
  handleCameraReady,
  children,
}: CameraLayoutProps): React.ReactElement {
  const { width } = useWindowDimensions();
  const scanBoxSize = width * 0.8;

  if (!hasPermission) {
    return (
      <View className="relative flex-1 items-center justify-center bg-black px-8">
        <Text className="text-foreground mb-2 text-center" size={20} weight="semibold">
          Camera permission required
        </Text>
        <Text className="text-foreground/70 mb-6 text-center" size={14}>
          Sovran needs camera access to scan QR codes for payments.
        </Text>
        <Pressable
          onPress={requestPermission}
          className="bg-foreground rounded-full px-6 py-3"
          accessibilityRole="button"
          accessibilityLabel="Grant camera permission">
          <Text className="text-background" size={16} weight="semibold">
            Grant access
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Log name="CameraLayout">
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

        <View
          className="absolute left-1/2 top-1/2"
          style={{
            width: scanBoxSize,
            height: scanBoxSize,
            transform: [{ translateX: -scanBoxSize / 2 }, { translateY: -scanBoxSize / 2 }],
          }}>
          <View
            className="absolute left-0 top-0 h-[30px] w-[30px]"
            style={{
              borderLeftWidth: 4,
              borderTopWidth: 4,
              borderColor: 'white',
              shadowColor: 'black',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.2,
              shadowRadius: 1,
              elevation: 2,
            }}
          />
          <View
            className="absolute right-0 top-0 h-[30px] w-[30px]"
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
          <View
            className="absolute bottom-0 left-0 h-[30px] w-[30px]"
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
          <View
            className="absolute bottom-0 right-0 h-[30px] w-[30px]"
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

          <View className="absolute bottom-0 self-center rounded-lg bg-black/50 p-2">
            {progress > 0 ? (
              <Text className="text-foreground" size={16}>
                Progress: {Math.round(progress * 100)}%
              </Text>
            ) : loading ? (
              <Text className="text-foreground" size={16}>
                Loading...
              </Text>
            ) : (
              <Text className="text-foreground" size={16}>
                Scanning...
              </Text>
            )}
          </View>
        </View>

        <HStack
          justify="space-between"
          style={{ paddingBottom: insets.bottom + 24 }}
          className="absolute bottom-0 left-0 right-0 w-full px-8">
          {children}
        </HStack>
      </View>
    </Log>
  );
}

import React from 'react';
import { CameraView } from 'expo-camera';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { scanBoxSize, type CameraScreenShared } from './useCameraScreen';

interface CameraLayoutProps extends CameraScreenShared {
  children: React.ReactNode;
}

export function CameraLayout({
  insets,
  progress,
  flashlightOn,
  loading,
  hasPermission,
  scanLocked,
  handleScan,
  handleCameraReady,
  children,
}: CameraLayoutProps): React.ReactElement {
  if (!hasPermission) {
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
        onBarcodeScanned={scanLocked ? undefined : handleScan}
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
  );
}

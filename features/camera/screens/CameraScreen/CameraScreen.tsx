/**
 * @fileoverview Camera screen — scan QR, paste, gallery. Uses machine.scan directly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import Icon from 'assets/icons';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Button } from '@/shared/ui/primitives/Button';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

import { CameraLayout } from './CameraLayout';
import type { CameraScreenProps, ScanningData } from './types';

export type { CameraScreenProps, ScanningData } from './types';

const ParamsSchema = z.object({
  unit: z.string().max(16).optional(),
});

function applyScanResult(
  result: { urInProgress?: boolean; progress?: number; lockedPending?: boolean } | undefined,
  setProgress: (n: number) => void,
  setLoading: (b: boolean) => void,
  isProcessingRef: React.MutableRefObject<boolean>
) {
  const urInProgress = result?.urInProgress ?? false;
  const lockedPending = result?.lockedPending ?? false;
  if (typeof result?.progress === 'number') setProgress(result.progress);
  if (!urInProgress && !lockedPending) {
    setLoading(false);
    setProgress(0);
    isProcessingRef.current = false;
  }
}

export function CameraScreen({ scanLocked = false }: CameraScreenProps) {
  useLifecycleLogger('CameraScreen');
  const params = useRouteParams(ParamsSchema, { where: 'camera' });
  const unit = params?.unit;
  const selectedMint = useMintStore((state) => state.selectedMint);
  const walletContext = useWalletContextWithOverride(selectedMint);
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState(0);
  const [flashlightOn, setFlashlightOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasPermission] = useCameraPermissions();
  const [isFocused, setIsFocused] = useState(true);
  const appStateRef = useRef(AppState.currentState);
  const isProcessingRef = useRef(false);
  const unlockRef = useRef<() => void>(() => {});

  const unlock = useCallback(() => {
    isProcessingRef.current = false;
    setLoading(false);
  }, []);
  unlockRef.current = unlock;

  const onOptionDismiss = useCallback(() => unlockRef.current?.(), []);

  const machine = usePaymentFlowMachine({
    walletContext,
    unit: unit || 'sat',
    onOptionDismiss,
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      appStateRef.current = s;
    });
    return () => sub?.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      setProgress(0);
      setLoading(false);
      isProcessingRef.current = false;
      machine.reset();
      return () => setIsFocused(false);
    }, [machine])
  );

  const lastScanRef = useRef<{ data: string; t: number }>({ data: '', t: 0 });

  const handleScan = useCallback(
    async (data: ScanningData) => {
      if (scanLocked) return;
      const isUr = data.data.toLowerCase().startsWith('ur:');
      if (appStateRef.current !== 'active' || !isFocused) return;
      if (!isUr && isProcessingRef.current) return;

      // Debounce: skip identical scans within 500ms
      const now = Date.now();
      if (data.data === lastScanRef.current.data && now - lastScanRef.current.t < 500) return;
      lastScanRef.current = { data: data.data, t: now };

      log.info('camera.scan.detected', {
        type: data.type ?? 'qr',
        isUr,
        dataLength: data.data.length,
      });
      isProcessingRef.current = true;
      setLoading(true);
      try {
        const result = await machine.scan?.(data.data, { source: data.type ?? 'qr' });
        applyScanResult(result, setProgress, setLoading, isProcessingRef);
      } catch (err) {
        log.error('camera.scan.failed', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        setLoading(false);
        setProgress(0);
        isProcessingRef.current = false;
      }
    },
    [machine, isFocused, scanLocked]
  );

  const handleBarcodeScanned = useCallback(
    (result: { data?: string }) => {
      if (result?.data) handleScan({ data: result.data, type: 'qr' });
    },
    [handleScan]
  );

  const handleClipboardPress = useCallback(async () => {
    if (scanLocked) return;
    log.info('camera.scan.clipboard');
    isProcessingRef.current = true;
    setLoading(true);
    try {
      const result = await machine.scan?.();
      applyScanResult(result, setProgress, setLoading, isProcessingRef);
    } catch (err) {
      log.error('camera.scan.clipboard_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      setLoading(false);
      setProgress(0);
      isProcessingRef.current = false;
    }
  }, [machine, scanLocked]);

  const handleGalleryPress = useCallback(async () => {
    if (scanLocked) return;
    log.info('camera.scan.gallery');
    isProcessingRef.current = true;
    setLoading(true);
    try {
      const result = await machine.scan?.(undefined, { source: 'gallery' });
      applyScanResult(result, setProgress, setLoading, isProcessingRef);
    } catch (err) {
      log.error('camera.scan.gallery_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      setLoading(false);
      setProgress(0);
      isProcessingRef.current = false;
    }
  }, [machine, scanLocked]);

  const handleCameraReady = useCallback(() => {
    setTimeout(() => setFlashlightOn(false), 1000);
  }, []);

  const toggleFlashlight = useCallback(() => {
    setFlashlightOn((p) => !p);
  }, []);

  const shared = {
    foreground,
    insets,
    progress,
    flashlightOn,
    loading,
    hasPermission: !!hasPermission?.granted,
    scanLocked,
    handleScan: handleBarcodeScanned,
    handleCameraReady,
    handleClipboardPress,
    handleGalleryPress,
    toggleFlashlight,
  };

  const iosButtons = (
    <>
      <Host style={{ height: 52, width: 52 }} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            frame({ height: 52, width: 52 }),
            glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive: true } }),
          ]}
          onPress={handleClipboardPress}>
          <SwiftUIHStack
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
            <SwiftUIImage systemName="doc.on.clipboard" size={22} color="white" />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
      <Host style={{ height: 52, width: 52 }} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            frame({ height: 52, width: 52 }),
            glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive: true } }),
          ]}
          onPress={handleGalleryPress}>
          <SwiftUIHStack
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
            <SwiftUIImage systemName="photo" size={22} color="white" />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
      <Host style={{ height: 52, width: 52 }} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            frame({ height: 52, width: 52 }),
            glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive: true } }),
          ]}
          onPress={toggleFlashlight}>
          <SwiftUIHStack
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
            <SwiftUIImage
              systemName={flashlightOn ? 'flashlight.on.fill' : 'flashlight.off.fill'}
              size={22}
              color="white"
            />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    </>
  );

  const androidButtons = (
    <>
      <Button
        onPress={handleClipboardPress}
        icon={<Icon name="lets-icons:copy" color={foreground} />}
        blur
      />
      <Button
        onPress={handleGalleryPress}
        icon={<Icon name="proicons:photo" color={foreground} />}
        blur
      />
      <Button
        onPress={toggleFlashlight}
        icon={
          !flashlightOn ? (
            <Icon name="mdi:lightbulb-on-outline" color={foreground} />
          ) : (
            <Icon name="mdi:lightbulb-on" color={foreground} />
          )
        }
        blur
      />
    </>
  );

  return (
    <Log name="CameraScreen">
      <CameraLayout {...shared}>{Platform.OS === 'ios' ? iosButtons : androidButtons}</CameraLayout>
    </Log>
  );
}

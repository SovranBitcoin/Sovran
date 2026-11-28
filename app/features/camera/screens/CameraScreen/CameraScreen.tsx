/**
 * @fileoverview Camera screen — scan QR, paste, gallery. Uses machine.scan directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { usePaymentFlowMachine } from 'wallet/react';
import { useCameraPermissionGate } from '../../hooks/useHandleCameraPermission';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useWalletContextWithOverride } from '@/runtime/WalletProjection';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

import { CameraActionButtons } from './CameraActionButtons';
import { CameraLayout } from './CameraLayout';
import type { ScanningData } from './types';

/**
 * Canonical schema for /camera deep-link params. StandaloneCameraScreen
 * extends with `action`. Tightening `unit` to a short lowercase token shape
 * rejects malformed deep links at the route boundary instead of silently
 * propagating into machine state.
 */
export const cameraRouteParamsSchema = z.object({
  unit: z
    .string()
    .regex(/^[a-z]{2,8}$/, 'unit must be a short lowercase token')
    .optional(),
});

interface ScanOutcome {
  urInProgress?: boolean;
  progress?: number;
  lockedPending?: boolean;
}

/**
 * One scan attempt: its outcome, or `null` once a failure is logged. Module
 * scope because the try/catch (value blocks inside it) bails the React
 * Compiler when it lives in a render-scoped function.
 */
async function attemptScan(
  failureEvent: string,
  scan: () => Promise<ScanOutcome | undefined> | undefined
): Promise<ScanOutcome | null> {
  try {
    return (await scan()) ?? {};
  } catch (err) {
    log.error(failureEvent, {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return null;
  }
}

export function CameraScreen() {
  useLifecycleLogger('CameraScreen');
  const params = useRouteParams(cameraRouteParamsSchema, { where: 'camera' });
  const unit = params?.unit;
  const selectedMint = useMintStore((state) => state.selectedMint);
  const walletContext = useWalletContextWithOverride(selectedMint);
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState(0);
  const [flashlightOn, setFlashlightOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const { view: permissionView, requestPermission } = useCameraPermissionGate();
  const [isFocused, setIsFocused] = useState(true);
  const appStateRef = useRef(AppState.currentState);
  const isProcessingRef = useRef(false);

  const onOptionDismiss = () => {
    isProcessingRef.current = false;
    setLoading(false);
  };

  // `unit` param (when present) is a deliberate flow override; absent, the
  // provider's getUnit supplies the live active unit — never default 'sat'
  // here, an explicit binding would clobber the app unit for flow resets.
  const machine = usePaymentFlowMachine({
    walletContext,
    ...(unit ? { unit } : {}),
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

  // Auto-disengage the flashlight one second after the camera reports ready.
  // Effect-scoped so unmounting before the timer fires cancels the late
  // setState (and pinned closure that prevents GC of the prior screen).
  useEffect(() => {
    if (!cameraReady) return;
    const id = setTimeout(() => setFlashlightOn(false), 1000);
    return () => clearTimeout(id);
  }, [cameraReady]);

  const lastScanRef = useRef<{ data: string; t: number }>({ data: '', t: 0 });

  /** Common gate for every scan source. iOS can deliver taps during the
   * inactive→background transition; AppState/isFocused must be live. */
  const shouldAcceptScan = () => appStateRef.current === 'active' && isFocused;

  /**
   * Every entry point (live barcode, paste, gallery) runs through here, so the
   * busy flags the overlay reads are always unwound when a scan fails or ends;
   * otherwise the screen stays stuck mid-scan with no way back. A multi-frame
   * UR or a locked token waiting on a choice stays busy.
   */
  const runScan = async (
    failureEvent: string,
    scan: () => Promise<ScanOutcome | undefined> | undefined
  ) => {
    isProcessingRef.current = true;
    setLoading(true);
    const outcome = await attemptScan(failureEvent, scan);
    if (typeof outcome?.progress === 'number') setProgress(outcome.progress);
    if (outcome?.urInProgress || outcome?.lockedPending) return;
    setLoading(false);
    setProgress(0);
    isProcessingRef.current = false;
  };

  const handleScan = async (data: ScanningData) => {
    const isUr = data.data.toLowerCase().startsWith('ur:');
    if (!shouldAcceptScan()) return;
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
    await runScan('camera.scan.failed', () =>
      machine.scan?.(data.data, { source: data.type ?? 'qr' })
    );
  };

  const handleBarcodeScanned = (result: { data?: string }) => {
    if (result?.data) void handleScan({ data: result.data, type: 'qr' });
  };

  const handleClipboardPress = async () => {
    if (!shouldAcceptScan()) return;
    log.info('camera.scan.clipboard');
    // machine.scan() with no args reads the clipboard itself.
    await runScan('camera.scan.clipboard_failed', () => machine.scan?.());
  };

  const handleGalleryPress = async () => {
    if (!shouldAcceptScan()) return;
    log.info('camera.scan.gallery');
    await runScan('camera.scan.gallery_failed', () =>
      machine.scan?.(undefined, { source: 'gallery' })
    );
  };

  const handleCameraReady = () => {
    setCameraReady(true);
  };

  const toggleFlashlight = () => {
    setFlashlightOn((p) => !p);
  };

  const shared = {
    foreground,
    insets,
    progress,
    flashlightOn,
    loading,
    permissionView,
    requestPermission,
    handleScan: handleBarcodeScanned,
    handleCameraReady,
    handleClipboardPress,
    handleGalleryPress,
    toggleFlashlight,
  };

  return (
    <Log name="CameraScreen">
      <CameraLayout {...shared}>
        <CameraActionButtons
          onPaste={handleClipboardPress}
          onGallery={handleGalleryPress}
          onToggleFlashlight={toggleFlashlight}
          flashlightOn={flashlightOn}
        />
      </CameraLayout>
    </Log>
  );
}

/**
 * @fileoverview Camera screen — scan QR, paste, gallery. Uses machine.scan directly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
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
import { usePaymentFlowMachine } from 'wallet/react';
import { useHandleCameraPermission } from '../../hooks/useHandleCameraPermission';
import {
  openPairingFromUri,
  PAIRING_ERROR_BUNKER,
  PAIRING_ERROR_INVALID_LINK,
  PAIRING_ERROR_INVALID_QR,
  PAIRING_ERROR_TITLE,
} from '@/features/nostrSigner';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCapabilities } from '@/shared/ui/capability';
import { Button } from '@/shared/ui/primitives/Button';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { popup } from '@/shared/lib/popup';

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

/**
 * NIP-46 pairing URIs are intercepted BEFORE the payment machine sees the
 * scan (same pattern as the `ur:` prefix special-case in handleScan).
 * Case-insensitive per the Layer-4 plan; the matched value embeds a pairing
 * bearer secret and must never be logged.
 */
const NIP46_SCHEME_RE = /^(?:nostrconnect|bunker):\/\//i;

/** Identical signer scans re-deliver every few hundred ms while the QR stays
 * in frame — throttle longer than the generic 500ms payment debounce so the
 * error toast doesn't stack and the connect sheet isn't re-opened mid-review. */
const SIGNER_RESCAN_WINDOW_MS = 2500;

interface CameraScreenProps {
  /**
   * Signer-pair mode (`/camera?action=signer-pair`, set by
   * StandaloneCameraScreen): the scanner ONLY accepts NIP-46 pairing URIs.
   * Non-matching scans show the pairing error toast — never the payment flow.
   */
  signerPairOnly?: boolean;
}

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

export function CameraScreen({ signerPairOnly = false }: CameraScreenProps = {}) {
  useLifecycleLogger('CameraScreen');
  const params = useRouteParams(cameraRouteParamsSchema, { where: 'camera' });
  const unit = params?.unit;
  const selectedMint = useMintStore((state) => state.selectedMint);
  const walletContext = useWalletContextWithOverride(selectedMint);
  const foreground = useThemeColor('foreground');
  const { liquidGlass } = useCapabilities();
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState(0);
  const [flashlightOn, setFlashlightOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const { permission, handlePermission } = useHandleCameraPermission();
  const hasPermission = !!permission?.granted;
  const [isFocused, setIsFocused] = useState(true);
  const appStateRef = useRef(AppState.currentState);
  const isProcessingRef = useRef(false);

  const onOptionDismiss = useCallback(() => {
    isProcessingRef.current = false;
    setLoading(false);
  }, []);

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
  const lastSignerScanRef = useRef<{ data: string; t: number }>({ data: '', t: 0 });

  /** Common gate for every scan source. iOS can deliver taps during the
   * inactive→background transition; AppState/isFocused must be live. */
  const shouldAcceptScan = useCallback(
    () => appStateRef.current === 'active' && isFocused,
    [isFocused]
  );

  /**
   * NIP-46 pairing entry. Hands the raw value to the shared
   * openPairingFromUri dispatch (hot flag + engine pairing + connect sheet);
   * failures surface as the plan's error toast. The value embeds a pairing
   * bearer secret — never logged.
   */
  const handleSignerScan = useCallback((raw: string, invalidBody: string) => {
    const now = Date.now();
    if (
      raw === lastSignerScanRef.current.data &&
      now - lastSignerScanRef.current.t < SIGNER_RESCAN_WINDOW_MS
    ) {
      return;
    }
    lastSignerScanRef.current = { data: raw, t: now };
    log.info('camera.scan.nip46_intercept', { dataLength: raw.length });
    const opened = openPairingFromUri(raw);
    if (opened.isErr()) {
      popup({
        message: PAIRING_ERROR_TITLE,
        text: opened.error.type === 'bunker-unsupported' ? PAIRING_ERROR_BUNKER : invalidBody,
        type: 'error',
      });
    }
  }, []);

  const handleScan = useCallback(
    async (data: ScanningData) => {
      const isUr = data.data.toLowerCase().startsWith('ur:');
      if (!shouldAcceptScan()) return;
      if (!isUr && isProcessingRef.current) return;

      // Debounce: skip identical scans within 500ms
      const now = Date.now();
      if (data.data === lastScanRef.current.data && now - lastScanRef.current.t < 500) return;
      lastScanRef.current = { data: data.data, t: now };

      // NIP-46 pairing intercept — BEFORE the payment machine sees the value.
      // In signer-pair mode EVERY scan routes here: no payment fallback.
      if (NIP46_SCHEME_RE.test(data.data.trim()) || signerPairOnly) {
        handleSignerScan(data.data.trim(), PAIRING_ERROR_INVALID_QR);
        return;
      }

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
    [handleSignerScan, machine, shouldAcceptScan, signerPairOnly]
  );

  const handleBarcodeScanned = useCallback(
    (result: { data?: string }) => {
      if (result?.data) void handleScan({ data: result.data, type: 'qr' });
    },
    [handleScan]
  );

  const handleClipboardPress = useCallback(async () => {
    if (!shouldAcceptScan()) return;
    log.info('camera.scan.clipboard');
    // Clipboard paste honors the same NIP-46 intercept as live scans — a
    // copied nostrconnect:// link must never reach the payment machine
    // (which would reject it as "Unsupported input"). The read here is
    // check-only for the payment path: machine.scan() with no args reads
    // the clipboard itself. In signer-pair mode EVERY paste routes to the
    // signer path: no payment fallback.
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (NIP46_SCHEME_RE.test(text) || signerPairOnly) {
      handleSignerScan(text, PAIRING_ERROR_INVALID_LINK);
      return;
    }
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
  }, [handleSignerScan, machine, shouldAcceptScan, signerPairOnly]);

  const handleGalleryPress = useCallback(async () => {
    if (!shouldAcceptScan()) return;
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
  }, [machine, shouldAcceptScan]);

  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
  }, []);

  const toggleFlashlight = useCallback(() => {
    setFlashlightOn((p) => !p);
  }, []);

  const requestPermission = useCallback(() => {
    void handlePermission();
  }, [handlePermission]);

  const shared = {
    foreground,
    insets,
    progress,
    flashlightOn,
    loading,
    hasPermission,
    requestPermission,
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
      {/* Gallery decodes inside the payment machine — no pre-machine hook
          exists, so signer-pair mode hides it instead of half-supporting it. */}
      {!signerPairOnly ? (
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
      ) : null}
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
      {/* Same gallery rationale as iOS above. */}
      {!signerPairOnly ? (
        <Button
          onPress={handleGalleryPress}
          icon={<Icon name="proicons:photo" color={foreground} />}
          blur
        />
      ) : null}
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
      <CameraLayout {...shared}>
        {Platform.OS === 'ios' && liquidGlass ? iosButtons : androidButtons}
      </CameraLayout>
    </Log>
  );
}

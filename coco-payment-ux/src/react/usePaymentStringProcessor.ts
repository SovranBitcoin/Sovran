// ---------------------------------------------------------------------------
// usePaymentStringProcessor — scan/paste/NFC input processing
//
// Wraps machine.execute() with optional UR (animated QR) assembly.
// Platform-specific concerns (haptics, navigation, UR decoder library)
// are injected via config callbacks and factories.
//
// Usage:
//   const { processPaymentString, reset } = usePaymentStringProcessor({
//     walletContext,
//     unit: 'sat',
//     createURDecoder: () => new URDecoder(),
//     onReceiveUR: (decoded) => navigateToReceiveToken(decoded),
//     onProgress: (p) => { haptics(p); setProgress(p); },
//   });
//
//   // On scan:
//   await processPaymentString({ data: qrData });
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from 'react';

import type { WalletContext } from '../types';
import { usePaymentFlowMachine } from './PaymentFlowProvider';

// ---------------------------------------------------------------------------
// UR decoder interface (matches @gandlaf21/bc-ur URDecoder shape)
// ---------------------------------------------------------------------------

export interface URDecoderLike {
  receivePart(part: string): void;
  getProgress(): number;
  isComplete(): boolean;
  isSuccess(): boolean;
  resultUR(): { decodeCBOR(): Uint8Array };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanData {
  data: string;
  type?: string;
}

export interface ProcessResult {
  urInProgress: boolean;
  progress?: number;
  lockedPending?: boolean;
}

export interface UsePaymentStringProcessorConfig {
  /** Current wallet context for the machine. */
  walletContext: WalletContext;
  /** Current unit (e.g. 'sat'). */
  unit: string;
  /** Whether the scanner/input is active. When false, input is ignored. */
  isFocused?: boolean;
  /**
   * Factory that creates a URDecoder instance. If omitted, UR codes
   * are passed through as regular input (not assembled).
   */
  createURDecoder?: () => URDecoderLike;
  /** Called when a complete UR code is decoded into a string. */
  onReceiveUR?: (decodedString: string) => void;
  /** Called when UR assembly progress changes (0–1). */
  onProgress?: (progress: number) => void;
  /** Called when processing starts/ends. */
  onLoading?: (loading: boolean) => void;
  /** Called when a scan is registered (even if still assembling). */
  onScanned?: (scanned: boolean) => void;
  /** Called when the camera should be unlocked (e.g. after option dismiss). */
  onUnlockCamera?: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaymentStringProcessor({
  walletContext,
  unit,
  isFocused = true,
  createURDecoder,
  onReceiveUR,
  onProgress,
  onLoading,
  onScanned,
  onUnlockCamera,
}: UsePaymentStringProcessorConfig) {
  const [urDecoder, setUrDecoder] = useState<URDecoderLike | null>(
    () => createURDecoder?.() ?? null
  );
  const processedRef = useRef(false);

  // Bind the machine with option-dismiss handling that resets the process lock.
  const machine = usePaymentFlowMachine({
    walletContext,
    unit,
    onOptionDismiss: () => {
      onLoading?.(false);
      onUnlockCamera?.();
      processedRef.current = false;
    },
  });

  const processPaymentString = useCallback(
    async (scanning: ScanData): Promise<ProcessResult> => {
      if (!isFocused) {
        return { urInProgress: false };
      }

      onLoading?.(true);
      onScanned?.(true);

      // UR code assembly
      const isUR = scanning.data.startsWith('ur:') || scanning.data.startsWith('UR:');
      if (isUR && urDecoder) {
        const prevProgress = urDecoder.getProgress();
        urDecoder.receivePart(scanning.data);
        const nextProgress = urDecoder.getProgress();

        if (nextProgress !== prevProgress) {
          onProgress?.(nextProgress);
        }

        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          const decoded = urDecoder.resultUR().decodeCBOR();
          const decodedString = new TextDecoder().decode(decoded);
          onLoading?.(false);
          onReceiveUR?.(decodedString);
          return { urInProgress: false };
        }

        return { urInProgress: true, progress: nextProgress };
      }

      // Standard payment string — deduplicate
      if (processedRef.current) {
        return { urInProgress: false };
      }

      processedRef.current = true;
      await machine.execute(scanning.data);
      const state = machine.inspect();

      if (state.status !== 'needsInput' || state.code !== 'OPTION_SELECTION_REQUIRED') {
        onLoading?.(false);
        onProgress?.(0);
        processedRef.current = false;
      }

      return {
        urInProgress: false,
        lockedPending: state.status === 'needsInput' && state.code === 'OPTION_SELECTION_REQUIRED',
      };
    },
    [isFocused, onLoading, onScanned, urDecoder, onProgress, machine, onReceiveUR]
  );

  const reset = useCallback(() => {
    machine.reset();
    processedRef.current = false;
    if (createURDecoder) {
      setUrDecoder(createURDecoder());
    }
    onProgress?.(0);
    onLoading?.(false);
  }, [machine, createURDecoder, onProgress, onLoading]);

  return { processPaymentString, reset };
}

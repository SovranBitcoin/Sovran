import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { log } from '@/shared/lib/logger';

// Module scope: the try/catch (with throw + timing) cannot be lowered by the
// React Compiler — inside the component's effect it made the whole component
// skip compilation. Encoding is synchronous, so the effect just applies the
// returned result.
function encodeUrParts(
  address: string,
  fragmentSize: number,
  needsAnimation: boolean
): { ok: true; parts: string[] } | { ok: false; message: string } {
  const encodeStart = performance.now();
  try {
    // `UR.from` does the string -> Buffer conversion with bc-ur's own bundled
    // `buffer`, so the payload never depends on whichever library happened to
    // install a `Buffer` global first.
    const ur = UR.from(address);
    const encoder = new UREncoder(ur, fragmentSize, 0);
    const encodedParts = encoder.encodeWhole();

    if (encodedParts.length === 0) {
      throw new Error('UR encoding produced no parts');
    }

    const duration = Math.round(performance.now() - encodeStart);
    log.info('ui.qrcode.ur_encoded', {
      inputLength: address.length,
      partCount: encodedParts.length,
      fragmentSize,
      firstPartLength: encodedParts[0].length,
      duration_ms: duration,
    });

    return { ok: true, parts: encodedParts };
  } catch (error) {
    log.error('ui.qrcode.encode_failed', {
      error,
      addressLength: address.length,
      needsAnimation,
    });
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to encode QR data',
    };
  }
}

type Encoding = {
  address: string;
  fragmentSize: number;
  result: ReturnType<typeof encodeUrParts>;
};
const EMPTY_PARTS: string[] = [];

/** Payload-bound UR frames. A prop change hides old fragments in the same
 * render, before the encoding effect runs. Only a visible foreground route
 * spends JS time regenerating QR matrices at the selected frame rate. */
export function useAnimatedQrFrames({
  address,
  animated,
  fragmentSize,
  intervalMs,
}: {
  address: string;
  animated: boolean;
  fragmentSize: number;
  intervalMs: number;
}) {
  const [encoding, setEncoding] = useState<Encoding | null>(null);
  const [index, setIndex] = useState(0);
  const current =
    animated && address && encoding?.address === address && encoding.fragmentSize === fragmentSize
      ? encoding.result
      : null;
  const parts = current?.ok ? current.parts : EMPTY_PARTS;
  const encodingError = current && !current.ok ? current.message : null;

  useEffect(() => {
    setIndex(0);
    if (!animated || !address) {
      setEncoding(null);
      return;
    }
    setEncoding({ address, fragmentSize, result: encodeUrParts(address, fragmentSize, animated) });
  }, [address, animated, fragmentSize]);

  useFocusEffect(
    useCallback(() => {
      if (!animated || parts.length < 2) return;
      let timer: ReturnType<typeof setInterval> | undefined;
      let windowFocused = true;
      let appState = AppState.currentState;
      const stop = () => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      };
      const sync = () => {
        stop();
        if (appState === 'active' && windowFocused) {
          timer = setInterval(
            () => setIndex((previous) => (previous + 1) % parts.length),
            intervalMs
          );
        }
      };
      const change = AppState.addEventListener('change', (state) => {
        appState = state;
        sync();
      });
      // Native iOS AppState does not support appStateFocusChange. Android
      // emits it when the notification shade opens without an app-state change.
      const blur =
        Platform.OS === 'android'
          ? AppState.addEventListener('blur', () => {
              windowFocused = false;
              sync();
            })
          : undefined;
      const focus =
        Platform.OS === 'android'
          ? AppState.addEventListener('focus', () => {
              windowFocused = true;
              sync();
            })
          : undefined;
      sync();
      return () => {
        stop();
        change.remove();
        blur?.remove();
        focus?.remove();
      };
    }, [animated, parts, intervalMs])
  );

  return {
    parts,
    index,
    encodingError,
    encodingPending: animated && !!address && !current,
    qrData: animated ? (parts.length > 0 ? parts[index % parts.length] : undefined) : address,
  };
}

/**
 * Whether this device has NFC hardware. Defaults to `true` (no flash-hide on
 * NFC-capable devices) and flips to `false` once the cached check resolves —
 * used to hide NFC affordances on hardware that can never use them. Enabled
 * state (user toggle) is deliberately NOT part of this: a disabled adapter is
 * recoverable, so those surfaces stay visible and surface the
 * 'NFC is turned off' popup instead.
 */
import { useEffect, useState } from 'react';
import { isNfcSupported } from './status';

let supportedPromise: Promise<boolean> | null = null;
let resolvedSupported: boolean | null = null;

function getSupported(): Promise<boolean> {
  supportedPromise ??= isNfcSupported().then((supported) => {
    resolvedSupported = supported;
    return supported;
  });
  return supportedPromise;
}

/**
 * Start the hardware check at launch, so the first surface that asks already
 * has the answer: resolved on mount, a device without NFC never draws the row
 * it would then remove, shifting everything under it. Idempotent.
 */
export function preloadNfcSupported(): void {
  void getSupported();
}

export function useNfcSupported(): boolean {
  const [supported, setSupported] = useState(resolvedSupported ?? true);

  useEffect(() => {
    let mounted = true;
    void getSupported().then((value) => {
      if (mounted) setSupported(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return supported;
}

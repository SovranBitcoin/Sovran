import { Platform } from 'react-native';

/**
 * Fail-closed gate for the e2e clipboard bridge. Android only: iOS drives the
 * clipboard directly via `simctl pbcopy/pbpaste`, and the emulator's
 * `cmd clipboard` shell command is unimplemented, so the Android harness
 * delivers/reads clipboard content through a host-written file that this
 * bridge reflects into the real system clipboard. Reuses the universal owned-
 * Metro e2e signal (EXPO_PUBLIC_E2E_STATE_MIRROR, set on every e2e session);
 * production always wins and an ordinary dev session never has the flag.
 *
 * Static property access only — babel-preset-expo inlines EXPO_PUBLIC_* at
 * transform time, so the env read must stay a literal member expression.
 */
export function isE2EClipboardBridgeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return (
    __DEV__ &&
    Platform.OS === 'android' &&
    typeof process.env.EXPO_PUBLIC_E2E_STATE_MIRROR === 'string' &&
    process.env.EXPO_PUBLIC_E2E_STATE_MIRROR.length > 0
  );
}

export const CLIPBOARD_SET_REL = 'e2e/clipboard-set.json' as const;
export const CLIPBOARD_ACK_REL = 'e2e/clipboard-ack.json' as const;
export const CLIPBOARD_GET_REL = 'e2e/clipboard-get.json' as const;
// Liveness heartbeat: the io loop rewrites this every few ticks so the host can
// tell, on a set() timeout, whether the loop is even alive and what it last did
// — turning an opaque "not acked" into a self-diagnosing failure.
export const CLIPBOARD_STATUS_REL = 'e2e/clipboard-io-status.json' as const;

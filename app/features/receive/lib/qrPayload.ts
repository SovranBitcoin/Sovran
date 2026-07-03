import type { CopyTarget } from '@/shared/lib/popup';

/**
 * The primary payment string a receive tab is currently displaying — what the
 * footer Copy button on the QR display copies. Each tab reports its own
 * (offer / address / creq / BIP-321 URI) via `onQrPayload` as it resolves;
 * `null` while the rail has nothing copyable (loading / unsupported).
 */
export interface ReceiveQrPayload {
  value: string;
  copyTarget: CopyTarget;
}

export type OnReceiveQrPayload = (payload: ReceiveQrPayload | null) => void;

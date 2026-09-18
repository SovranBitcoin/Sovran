import type { CopyTarget } from '@/shared/lib/popup';

/** Shared threshold for QR rendering and request-size feedback. */
export const ANIMATE_THRESHOLD = 500;

/**
 * Typical encoded length per copy target, measured from real payloads: a
 * bech32m address (`bc1p…`, 62), a mint-issued BOLT 12 offer (~140), a NUT-18
 * creq carrying a couple of mints (~200), an npub.cash address (~72). The QR
 * placeholder derives its module density from this so the junk pattern lands
 * in the same QR version bucket as the code about to replace it — a 60-char
 * address is a 33×33 code, a 400-char unified URI is 77×77, and a placeholder
 * at the wrong density visibly "pops" when the real code swaps in.
 */
const QR_PAYLOAD_LENGTH_ESTIMATES: Partial<Record<CopyTarget, number>> = {
  address: 62,
  bolt12Offer: 140,
  paymentRequest: 200,
  lightningInvoice: 260,
  token: 600,
  lud16: 72,
  npub: 63,
  nip05: 40,
  mintUrl: 40,
  publicKey: 66,
  p2pk: 66,
};
const DEFAULT_QR_PAYLOAD_LENGTH = 200;

/** BIP-321 wrapper cost around each rail: `bitcoin:` + `?lno=` + `&creq=`. */
const BIP321_SCHEME_LENGTH = 'bitcoin:'.length;
const BIP321_LNO_KEY_LENGTH = '?lno='.length;
const BIP321_CREQ_KEY_LENGTH = '&creq='.length;

/** Expected length of the unified `bitcoin:` URI composed from the rails the
 * user has switched on — the sum of each included rail plus its query key. */
export function estimateBip321Length(rails: readonly { id: string; state: string }[]): number {
  const included = (id: string) =>
    rails.some((rail) => rail.id === id && rail.state === 'included');
  let length = BIP321_SCHEME_LENGTH;
  if (included('onchain')) length += QR_PAYLOAD_LENGTH_ESTIMATES.address ?? 0;
  if (included('bolt12'))
    length += BIP321_LNO_KEY_LENGTH + (QR_PAYLOAD_LENGTH_ESTIMATES.bolt12Offer ?? 0);
  if (included('creq'))
    length += BIP321_CREQ_KEY_LENGTH + (QR_PAYLOAD_LENGTH_ESTIMATES.paymentRequest ?? 0);
  return length;
}

/** Last real payload length rendered per target this session — the best
 * predictor for the next placeholder, since standing requests are reused
 * across visits. In-memory only: lengths are not user data. */
const rememberedQrPayloadLengths = new Map<CopyTarget, number>();

export function rememberQrPayloadLength(target: CopyTarget, length: number): void {
  if (length > 0) rememberedQrPayloadLengths.set(target, length);
}

/** The length a QR placeholder should mimic for `target`: the last real
 * payload if one rendered this session, else `fallback`, else the per-target
 * estimate. */
export function expectedQrPayloadLength(target: CopyTarget, fallback?: number): number {
  return (
    rememberedQrPayloadLengths.get(target) ??
    fallback ??
    QR_PAYLOAD_LENGTH_ESTIMATES[target] ??
    DEFAULT_QR_PAYLOAD_LENGTH
  );
}

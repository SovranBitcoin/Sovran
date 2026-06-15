/**
 * Whether the in-flight NFC scan cycle was started by the AMBIENT listener
 * (wallet-screen focus loop) rather than an explicit user press. Ambient
 * cycles re-arm every ~30s, so per-cycle failure popups (NFC off, timeout)
 * must stay quiet — the press path keeps them.
 *
 * Module-level flag (not machine plumbing): colada's scan sources take no
 * arguments, and the ambient hook brackets each machine.scan call.
 */
import { paymentLog } from '@/shared/lib/logger';

let ambientCycle = false;

export function setAmbientNfcCycle(value: boolean): void {
  ambientCycle = value;
  paymentLog.debug('nfc.ambient_cycle.set', { value });
}

export function isAmbientNfcCycle(): boolean {
  paymentLog.debug('nfc.ambient_cycle.get', { value: ambientCycle });
  return ambientCycle;
}

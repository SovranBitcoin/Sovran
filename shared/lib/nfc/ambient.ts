/**
 * Whether the in-flight NFC scan cycle was started by the AMBIENT listener
 * (wallet-screen focus loop) rather than an explicit user press. Ambient
 * cycles re-arm every ~30s, so per-cycle failure popups (NFC off, timeout)
 * must stay quiet — the press path keeps them.
 *
 * Module-level flag (not machine plumbing): colada's scan sources take no
 * arguments, and the ambient hook brackets each machine.scan call.
 */
let ambientCycle = false;

export function setAmbientNfcCycle(value: boolean): void {
  ambientCycle = value;
}

export function isAmbientNfcCycle(): boolean {
  return ambientCycle;
}

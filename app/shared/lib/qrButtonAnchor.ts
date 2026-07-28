import { useSyncExternalStore } from 'react';

// Holds the QR button's screen rect so the boot splash overlay can morph
// into it on first paint. Module-level state + subscribe APIs — the QRButton
// publishes its measured rect after layout, the splash gate reads it.
//
// Also tracks whether the boot morph has completed, so the QRButton can stay
// invisible until the splash overlay has finished morphing into its position
// (making it look like the splash *became* the button).

export type QRButtonAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
};

let currentAnchor: QRButtonAnchor | null = null;
const anchorListeners = new Set<(anchor: QRButtonAnchor | null) => void>();

// QRButton registers a "remeasure now" callback on mount. The boot splash
// gate calls it just before kicking off the morph so we use the freshest
// position (after every above-the-button row has settled), not the stale
// one captured on the very first onLayout pass.
let remeasureCallback: (() => void) | null = null;

export function registerQRButtonRemeasure(cb: () => void): () => void {
  remeasureCallback = cb;
  return () => {
    if (remeasureCallback === cb) remeasureCallback = null;
  };
}

export function requestQRButtonRemeasure(): void {
  remeasureCallback?.();
}

let bootMorphCompleted = false;
const morphListeners = new Set<() => void>();

// Flips to `true` the moment the splash overlay begins its morph (or fade)
// out — i.e., when the user is about to see the destination screen. The
// destination screen subscribes via `useBootSplashHandoff()` to time its
// own entrance animation (zoom-in, fade, etc.) so it plays *while* the
// splash is retreating, instead of completing behind the still-opaque
// splash and being invisible to the user.
let bootSplashHandoff = false;
const handoffListeners = new Set<() => void>();
const ANCHOR_EPSILON = 0.5;

export function setQRButtonAnchor(anchor: QRButtonAnchor | null): void {
  // Dedupe identical publishes — QRButton publishes from both the worklet
  // (UI thread) and measureInWindow (JS thread) for reliability, so the
  // same rect can arrive twice. No-op when nothing changed to avoid
  // notifying subscribers and forcing re-renders.
  if (anchorsEqual(currentAnchor, anchor)) return;
  currentAnchor = anchor;
  anchorListeners.forEach((cb) => cb(anchor));
}

function anchorsEqual(a: QRButtonAnchor | null, b: QRButtonAnchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    nearlyEqual(a.x, b.x) &&
    nearlyEqual(a.y, b.y) &&
    nearlyEqual(a.width, b.width) &&
    nearlyEqual(a.height, b.height) &&
    nearlyEqual(a.borderRadius, b.borderRadius)
  );
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= ANCHOR_EPSILON;
}

// Subscribe to boot-morph-completion transitions. Used by the wallet's
// QRButton (to fade in only after the morph finishes) and by Phase 2 work
// that wants to start as soon as the morph settles.
export function subscribeBootMorphCompleted(cb: (completed: boolean) => void): () => void {
  const wrapped = () => cb(bootMorphCompleted);
  morphListeners.add(wrapped);
  return () => {
    morphListeners.delete(wrapped);
  };
}

export function getQRButtonAnchor(): QRButtonAnchor | null {
  return currentAnchor;
}

export function subscribeQRButtonAnchor(cb: (anchor: QRButtonAnchor | null) => void): () => void {
  anchorListeners.add(cb);
  return () => {
    anchorListeners.delete(cb);
  };
}

export function setBootMorphCompleted(completed: boolean): void {
  if (bootMorphCompleted === completed) return;
  bootMorphCompleted = completed;
  morphListeners.forEach((cb) => cb());
}

export function getBootMorphCompleted(): boolean {
  return bootMorphCompleted;
}

function subscribeMorph(cb: () => void): () => void {
  morphListeners.add(cb);
  return () => {
    morphListeners.delete(cb);
  };
}

export function useBootMorphCompleted(): boolean {
  return useSyncExternalStore(subscribeMorph, getBootMorphCompleted, getBootMorphCompleted);
}

export function setBootSplashHandoff(handoff: boolean): void {
  if (bootSplashHandoff === handoff) return;
  bootSplashHandoff = handoff;
  handoffListeners.forEach((cb) => cb());
}

export function getBootSplashHandoff(): boolean {
  return bootSplashHandoff;
}

function subscribeHandoff(cb: () => void): () => void {
  handoffListeners.add(cb);
  return () => {
    handoffListeners.delete(cb);
  };
}

export function useBootSplashHandoff(): boolean {
  return useSyncExternalStore(subscribeHandoff, getBootSplashHandoff, getBootSplashHandoff);
}

// Whether the wallet tab is the focused tab. Tri-state: `null` = unknown (the
// wallet screen isn't mounted — cold boot before first mount, onboarding, or
// mid-profile-switch remount), `true`/`false` = the mounted wallet screen's
// focus. Published by useWalletTabFocusPublisher; the boot splash gate
// subscribes so it can fast-forward the morph overlay when the user switches
// tabs mid-boot instead of ghosting the QR look-alike over feed/notifications.
let walletTabFocused: boolean | null = null;
const focusListeners = new Set<() => void>();

export function setWalletTabFocused(focused: boolean | null): void {
  if (walletTabFocused === focused) return;
  walletTabFocused = focused;
  focusListeners.forEach((cb) => cb());
}

export function getWalletTabFocused(): boolean | null {
  return walletTabFocused;
}

export function subscribeWalletTabFocused(cb: () => void): () => void {
  focusListeners.add(cb);
  return () => {
    focusListeners.delete(cb);
  };
}

// Fast-forward policy for the boot morph overlay, pure so it can be unit
// tested. Keep the overlay unless the wallet tab is definitively blurred
// (`focused !== false` covers onboarding / pre-mount / profile switch, where
// there is no wallet tab to be blurred from). The anchor guard disambiguates
// a real tab switch from a profile-switch remount: on remount the
// WalletScreen's blur cleanup fires, but QRButton's child cleanup nulls the
// anchor FIRST (React runs child cleanups before parents), so a null anchor
// marks that blur as an unmount echo — the replayed morph must survive it.
export function shouldFastForwardBootOverlay(
  focused: boolean | null,
  anchor: QRButtonAnchor | null
): boolean {
  return focused === false && anchor !== null;
}

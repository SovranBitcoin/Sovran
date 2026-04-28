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
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.borderRadius === b.borderRadius
  );
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

export function subscribeQRButtonAnchor(
  cb: (anchor: QRButtonAnchor | null) => void
): () => void {
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

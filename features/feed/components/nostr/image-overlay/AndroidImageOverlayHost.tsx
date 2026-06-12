/**
 * AndroidImageOverlayHost: same-window mount point for the feed media lightbox.
 *
 * WHY THIS EXISTS: on Android the overlay used to render inside a transparent
 * RN Modal, which is a SEPARATE native window. Thumbnail source rects are
 * measured with measureInWindow in main-surface coordinates (Fabric
 * shadow-tree math), so the open/dismiss morph animated in a different
 * coordinate space and landed offset from the feed thumbnail. Hosting the
 * overlay element in the root view hierarchy (mounted in app/_layout.tsx)
 * makes measureInWindow rects and overlay coordinates identical by
 * construction. It also removes the Modal mount latency that ate the first
 * frames of the open morph and caused a teardown flash on close.
 *
 * The store is a tiny module-level external store (useSyncExternalStore, no
 * zustand): AnimatedImageOverlay registers its already-context-bound element
 * here while a media url is active, so the hosted element does NOT need the
 * overlay contexts re-provided.
 */

import React, { type ReactNode, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { zIndex } from '@/shared/styles/tokens';

type AndroidOverlayEntry = { ownerKey: string; node: ReactNode };

let currentEntry: AndroidOverlayEntry | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AndroidOverlayEntry | null {
  return currentEntry;
}

/** Register (or replace) the hosted overlay element for the given owner. */
export function setAndroidOverlayNode(ownerKey: string, node: ReactNode): void {
  currentEntry = { ownerKey, node };
  emit();
}

/**
 * Clear the hosted overlay element, but only when ownerKey matches the
 * current registration — so one feed's teardown can't clobber another
 * feed's freshly registered overlay.
 */
export function clearAndroidOverlayNode(ownerKey: string): void {
  if (currentEntry?.ownerKey !== ownerKey) return;
  currentEntry = null;
  emit();
}

/**
 * Renders the registered overlay element in the main window. Mounted once in
 * app/_layout.tsx just before <PopupHost /> so popups triggered from inside
 * the lightbox stack above it. Returns null on iOS (which uses same-window
 * FullWindowOverlay directly) and when nothing is registered.
 */
export function AndroidImageOverlayHost(): React.ReactElement | null {
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (Platform.OS !== 'android' || entry == null) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.host]} pointerEvents="box-none">
      {entry.node}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    zIndex: zIndex.overlay,
  },
});

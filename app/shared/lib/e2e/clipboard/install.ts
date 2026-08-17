/**
 * Side-effect installer for the Android e2e clipboard bridge, imported from
 * app/index.js. Fail-closed: without the harness-owned e2e Metro env (or on
 * iOS / in production / on web) this does nothing.
 */
import { isE2EClipboardBridgeEnabled } from './enabled';
import { startE2EClipboardIo } from './io';

function installE2EClipboardBridge(): void {
  if (!isE2EClipboardBridgeEnabled()) return;
  startE2EClipboardIo();
}

installE2EClipboardBridge();

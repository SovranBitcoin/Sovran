/**
 * Debug session logging — sends events to the debug ingest server.
 * Used for tracing coco-payment-ux flows, button presses, pastes, scans.
 * Wraps fetch in try/catch so it never throws.
 */

const DEBUG_ENDPOINT =
  'https://nonfarm-madie-unenhanced.ngrok-free.dev/ingest/ce075d2d-89ca-4ed1-9c00-ab62c19adc09';
const SESSION_ID = '3a3711';

export interface DebugLogPayload {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  phase?: 'before' | 'after' | 'entry' | 'exit';
}

export function debugLog(payload: DebugLogPayload): void {
  try {
    fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': SESSION_ID,
      },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        ...payload,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch {
    // Never throw
  }
}

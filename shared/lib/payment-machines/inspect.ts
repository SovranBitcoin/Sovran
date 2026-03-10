import type { InspectionEvent } from 'xstate';

import { debugLog } from '@/shared/lib/debugSession';

/**
 * Creates an XState inspect callback that logs events and state transitions
 * to the console and to the debug endpoint. Only active in __DEV__ builds.
 */
export function createMachineInspector(machineId: string) {
  return (inspectionEvent: InspectionEvent) => {
    if (!__DEV__) return;

    // #region agent log
    if (inspectionEvent.type === '@xstate.event') {
      const evt = (inspectionEvent as any).event;
      console.log(`[${machineId}] event: ${evt?.type}`, evt);
      debugLog({
        location: `inspect.ts:${machineId}`,
        message: `machine event: ${evt?.type}`,
        data: { machineId, eventType: evt?.type, event: evt },
        hypothesisId: 'machine',
      });
    }

    if (inspectionEvent.type === '@xstate.snapshot') {
      const snap = (inspectionEvent as any).snapshot;
      const ctx = snap?.context;
      const contextSummary = ctx
        ? {
            amount: ctx.amount,
            mintUrl: ctx.mintUrl,
            error: ctx.error,
            state: snap?.value,
          }
        : undefined;
      console.log(
        `[${machineId}] -> ${JSON.stringify(snap?.value)}`,
        contextSummary,
      );
      debugLog({
        location: `inspect.ts:${machineId}`,
        message: `machine snapshot: ${JSON.stringify(snap?.value)}`,
        data: { machineId, state: snap?.value, context: contextSummary },
        hypothesisId: 'machine',
      });
    }
    // #endregion
  };
}

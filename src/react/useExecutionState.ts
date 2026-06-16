import { useEffect, useRef, useSyncExternalStore } from "react";

import { logger } from "../logger";
import type { ExecutionState, PaymentMachine } from "../machine/types";

export function useExecutionState(machine: PaymentMachine): ExecutionState {
  const state = useSyncExternalStore(
    machine.subscribe,
    machine.inspect,
    machine.inspect,
  );
  const previousKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${state.status}:${state.code}:${state.step}:${state.isExecuting ? "executing" : "idle"}`;
    if (previousKeyRef.current === key) return;
    previousKeyRef.current = key;
    logger.debug("react.executionState.changed", {
      status: state.status,
      code: state.code,
      step: state.step,
      isExecuting: state.isExecuting,
      isExecutable: state.isExecutable,
      detailKeys: state.details ? Object.keys(state.details).sort() : [],
    });
  }, [state]);

  return state;
}

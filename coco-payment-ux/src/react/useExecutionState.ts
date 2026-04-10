import { useSyncExternalStore } from 'react';

import type { ExecutionState, PaymentMachine } from '../machine/types';

export function useExecutionState(machine: PaymentMachine): ExecutionState {
  return useSyncExternalStore(machine.subscribe, machine.inspect, machine.inspect);
}

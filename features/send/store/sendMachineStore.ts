import { create } from 'zustand';
import { createActor, type SnapshotFrom } from 'xstate';

import { sendMachine } from '../machine/sendMachine';
import type { SendMachineEvent } from '../machine/sendMachine.types';

type SendMachineSnapshot = SnapshotFrom<typeof sendMachine>;

interface SendMachineStore {
  snapshot: SendMachineSnapshot;
  send: (event: SendMachineEvent) => void;
  /** Stop the current actor and start a fresh one */
  reset: () => void;
}

function createAndStartActor(
  set: (partial: Partial<SendMachineStore>) => void,
  input?: {
    mintUrl?: string | null;
    amountSat?: number;
    denomination?: 'sat' | 'fiat';
    fiatAmount?: number | null;
  }
) {
  const actor = createActor(sendMachine, { input: input ?? {} });
  actor.subscribe((snapshot) => {
    set({ snapshot });
  });
  actor.start();
  return actor;
}

export const useSendMachineStore = create<SendMachineStore>()((set, get) => {
  let actor = createAndStartActor(set, {});

  return {
    snapshot: actor.getSnapshot(),

    send: (event: SendMachineEvent) => {
      actor.send(event);
    },

    reset: () => {
      actor.stop();
      actor = createAndStartActor(set, {});
      set({
        snapshot: actor.getSnapshot(),
        send: (event: SendMachineEvent) => actor.send(event),
      });
    },
  };
});

import { fromPromise } from 'xstate';

import { sendController } from '../controller/SendController';

import type {
  CheckBalanceOutput,
  CheckConnectivityOutput,
  ExecuteSendOutput,
  OfflineResolutionResult,
  Denomination,
} from './sendMachine.types';

// ---------------------------------------------------------------------------
// Balance check
// ---------------------------------------------------------------------------

export const checkBalanceActor = fromPromise(
  async ({ input }: { input: { mintUrl: string } }): Promise<CheckBalanceOutput> => {
    return sendController.checkBalance(input.mintUrl);
  }
);

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

export const checkConnectivityActor = fromPromise(async (): Promise<CheckConnectivityOutput> => {
  return sendController.checkConnectivity();
});

// ---------------------------------------------------------------------------
// Execute ecash send (used by both online and offline paths)
// ---------------------------------------------------------------------------

export const executeSendActor = fromPromise(
  async ({ input }: { input: { mintUrl: string; amount: number } }): Promise<ExecuteSendOutput> => {
    return sendController.executeSend(input.mintUrl, input.amount);
  }
);

// ---------------------------------------------------------------------------
// Offline coin resolution
// ---------------------------------------------------------------------------

export const resolveOfflineActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      mintUrl: string;
      amountSat: number;
      denomination: Denomination;
      fiatAmount: number | null;
    };
  }): Promise<OfflineResolutionResult> => {
    const btcPrice = sendController.getBtcPrice();
    return sendController.resolveOffline(
      input.mintUrl,
      input.amountSat,
      input.denomination,
      input.fiatAmount,
      btcPrice
    );
  }
);

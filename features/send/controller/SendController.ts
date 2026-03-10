import * as Network from 'expo-network';
import { getEncodedToken } from '@cashu/cashu-ts';
import type { Manager } from 'coco-cashu-core';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import {
  getOfflineSendSuggestions,
  getOfflineFiatSendSuggestions,
  type OfflineSendSuggestions,
  type OfflineFiatSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';

import type {
  CheckBalanceOutput,
  CheckConnectivityOutput,
  ExecuteSendOutput,
  OfflineResolutionResult,
  Denomination,
} from '../machine/sendMachine.types';

type ProofService = {
  getReadyProofs: (mintUrl: string) => Promise<{ amount: number }[]>;
  selectProofsToSend: (
    mintUrl: string,
    amount: number,
    includeFees: boolean
  ) => Promise<{ amount: number }[]>;
};

/**
 * Bridge between the send state machine and the wallet system.
 *
 * The machine never imports app modules directly — all wallet access goes
 * through this controller. Actors call controller methods; the machine only
 * sees typed inputs and outputs.
 */
class SendController {
  private forceOffline = false;

  getManager(): Manager {
    return CocoManager.getInstance();
  }

  private getProofService(): ProofService {
    return (this.getManager() as any).proofService;
  }

  async checkBalance(mintUrl: string): Promise<CheckBalanceOutput> {
    const manager = this.getManager();
    const balances = await manager.wallet.getBalances();
    return { balance: balances[mintUrl] ?? 0 };
  }

  async checkConnectivity(): Promise<CheckConnectivityOutput> {
    if (this.forceOffline || useSettingsStore.getState().mockOffline) {
      return { isOnline: false };
    }
    try {
      const state = await Network.getNetworkStateAsync();
      const isOnline = state.isConnected !== false && state.isInternetReachable !== false;
      return { isOnline };
    } catch {
      return { isOnline: false };
    }
  }

  async executeSend(mintUrl: string, amount: number): Promise<ExecuteSendOutput> {
    const manager = this.getManager();
    const prepared = await manager.send.prepareSend(mintUrl, amount);
    const { token } = await manager.send.executePreparedSend(prepared.id);
    const encodedToken = getEncodedToken(token as any);

    let historyEntryJson: string | null = null;
    try {
      const history = await manager.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'send' && (h as any).operationId === prepared.id
      );
      if (entry) {
        historyEntryJson = JSON.stringify(entry);
      }
    } catch {
      // Non-critical: SendTokenScreen can still work with operationId alone
    }

    return { token: encodedToken, operationId: prepared.id, historyEntryJson };
  }

  async resolveOffline(
    mintUrl: string,
    amountSat: number,
    denomination: Denomination,
    fiatAmount: number | null,
    btcPrice: number | null
  ): Promise<OfflineResolutionResult> {
    const proofService = this.getProofService();

    if (denomination === 'fiat' && fiatAmount != null && btcPrice != null) {
      const fiatMinorUnit = Math.round((amountSat / 100_000_000) * btcPrice * 100);
      const suggestions = await getOfflineFiatSendSuggestions(
        proofService,
        mintUrl,
        amountSat,
        fiatMinorUnit,
        btcPrice
      );

      if (suggestions.autoSelectAmount != null) {
        return { type: 'fiat-range', amount: suggestions.autoSelectAmount };
      }

      return {
        type: 'impossible',
        suggestions: null,
        fiatSuggestions: suggestions,
      };
    }

    const suggestions = await getOfflineSendSuggestions(proofService, mintUrl, amountSat);

    if (suggestions.isRequestedAmountSendableOffline) {
      return { type: 'exact', amount: amountSat };
    }

    return {
      type: 'impossible',
      suggestions,
      fiatSuggestions: null,
    };
  }

  getBtcPrice(currency?: string): number | null {
    return usePricelistStore.getState().getBtcPrice(currency as any);
  }

  getSelectedMint(pubkey: string): string | undefined {
    return useMintStore.getState().getSelectedMint(pubkey);
  }

  setForceOffline(value: boolean): void {
    this.forceOffline = value;
  }

  getForceOffline(): boolean {
    return this.forceOffline;
  }
}

export const sendController = new SendController();

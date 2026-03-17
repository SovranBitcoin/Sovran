import type { MintHistoryEntry, SendHistoryEntry, Manager } from 'coco-cashu-core';

import { buildMintAvailability, type MachineOperations, type WalletContext } from 'coco-payment-ux';

import { buildMintListItems } from '@/shared/lib/buildMintListItems';

interface CreateSovranOperationsConfig {
  managerRef: React.MutableRefObject<Manager>;
  walletContextRef: React.MutableRefObject<WalletContext | null>;
}

export function createSovranOperations({
  managerRef,
  walletContextRef,
}: CreateSovranOperationsConfig): MachineOperations {
  return {
    executeSend: async (mintUrl, amount) => {
      const mgr = managerRef.current;
      await mgr.wallet.send(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'send' && (h as SendHistoryEntry).mintUrl === mintUrl
      ) as SendHistoryEntry | undefined;
      if (!entry) throw new Error('Send history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    executeMintQuote: async (mintUrl, amount, _unit) => {
      const mgr = managerRef.current;
      const mintQuote = await mgr.quotes.createMintQuote(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'mint' && (h as MintHistoryEntry).quoteId === mintQuote.quote
      ) as MintHistoryEntry | undefined;
      if (!entry) throw new Error('Mint quote history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (stepData) => {
      const mgr = managerRef.current;
      const [allTrustedMints, balances] = await Promise.all([
        mgr.mint.getAllTrustedMints(),
        mgr.wallet.getBalances(),
      ]);
      const availability = allTrustedMints.map((mint) =>
        buildMintAvailability({
          mintUrl: mint.mintUrl,
          balance: balances[mint.mintUrl] ?? 0,
          supportedMintUrls: stepData.supportedMintUrls,
          amount: stepData.amount,
          destination: stepData.destination,
        })
      );
      const offlineCheck =
        (stepData.destination === 'sendEcash' || stepData.destination === 'paymentRequest') &&
        stepData.amount
          ? {
              amount: stepData.amount,
              proofAmounts: walletContextRef.current?.proofAmounts ?? {},
            }
          : undefined;
      return buildMintListItems(allTrustedMints, availability, offlineCheck);
    },
  };
}

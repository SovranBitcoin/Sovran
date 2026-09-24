import { actionMenuPopup } from '@/shared/lib/popup';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

import { AFFORD_BUFFER, requiredReserveSatsFromPricing } from './format';
import type { LineupEntry } from '@/shared/lib/routstr/lineup';

/**
 * What one message could cost, before it costs it.
 *
 * Paying per request means handing the node a token worth its admission gate
 * and taking the unspent remainder back. The gate — not the expected cost — is
 * what leaves the wallet, and on a frontier model that is thousands of sats
 * against a message that will actually cost a fraction of one. The number is
 * only briefly out of the user's hands, but it is their number, so it is shown
 * before it goes rather than reported afterwards.
 */
export function maxSpendSats(entry: LineupEntry | null, imageCount = 0): number {
  const reserve = requiredReserveSatsFromPricing(entry?.satsPricing ?? null, imageCount);
  return Math.max(1, Math.ceil((reserve ?? 1) * AFFORD_BUFFER));
}

/**
 * Resolve to `true` when the send may proceed.
 *
 * Dismissing the sheet is a decline: a spend must be chosen, never defaulted
 * into by tapping away. "Always allow" turns the prompt off for good — it is
 * an explicit choice, which is exactly the bar for skipping it in future.
 */
export function confirmSpend(params: { modelName: string; maxSats: number }): Promise<boolean> {
  if (!useRoutstrStore.getState().confirmSpend) return Promise.resolve(true);

  const { modelName, maxSats } = params;
  return new Promise<boolean>((resolve) => {
    let decided = false;
    const settle = (allow: boolean) => {
      if (decided) return;
      decided = true;
      resolve(allow);
    };

    actionMenuPopup({
      title: `Send to ${modelName}?`,
      buttons: [
        {
          text: `Send · up to ${maxSats} sats`,
          description:
            'The provider holds this amount while it answers and returns whatever it does not use.',
          icon: 'fluent:wallet-20-filled',
          testID: 'ai-spend-confirm',
          onPress: (close: () => void) => {
            settle(true);
            close();
          },
        },
        {
          text: 'Always allow',
          description: 'Stop asking before each message. You can turn this back on in settings.',
          icon: 'mdi:check',
          testID: 'ai-spend-always',
          onPress: (close: () => void) => {
            useRoutstrStore.getState().setConfirmSpend(false);
            settle(true);
            close();
          },
        },
      ],
      onDismiss: () => settle(false),
    });
  });
}

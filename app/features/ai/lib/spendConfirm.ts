import { actionMenuPopup } from '@/shared/lib/popup';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

/**
 * Resolve to `true` when the send may proceed.
 *
 * Dismissing the sheet is a decline: a spend must be chosen, never defaulted
 * into by tapping away.
 *
 * There is deliberately no "always allow" escape hatch. It existed, and it was
 * a one-way door: the only thing that could set `confirmSpend` back to `true`
 * was a settings toggle that was never built, so a single tap silently opted
 * the user out of every future spend prompt with no way back. Until that
 * setting exists, the prompt is unconditional — see the `confirmSpend`
 * migration in `routstrStore` for how the users who already tapped it are
 * brought back.
 *
 * `reserveSats` is the amount that will leave the wallet, computed the way the
 * node computes it (`features/ai/lib/reserve.ts`) from the message actually
 * being sent. It used to be a typical-case estimate wearing an "up to", which
 * is how a sheet came to offer "up to 10 sats" for a send that minted 307. The
 * hedge is gone with the estimate: when we know the figure we state it, and
 * when we do not we say that instead of dressing a guess up as a ceiling.
 */
export function confirmSpend(params: {
  modelName: string;
  reserveSats: number;
  /** False when the model carries no usable pricing and `reserveSats` is the
   *  typical-turn fallback rather than the node's actual gate. */
  reserveKnown: boolean;
}): Promise<boolean> {
  if (!useRoutstrStore.getState().confirmSpend) return Promise.resolve(true);

  const { modelName, reserveSats, reserveKnown } = params;
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
          text: reserveKnown ? `Send · ${reserveSats} sats` : `Send · roughly ${reserveSats} sats`,
          description: reserveKnown
            ? `${modelName} holds this amount while it answers and returns whatever it does not use.`
            : `${modelName} has no published price here, so this is an estimate — it could hold more.`,
          icon: 'fluent:wallet-20-filled',
          testID: 'ai-spend-confirm',
          onPress: (close: () => void) => {
            settle(true);
            close();
          },
        },
      ],
      onDismiss: () => settle(false),
    });
  });
}

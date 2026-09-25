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
      ],
      onDismiss: () => settle(false),
    });
  });
}

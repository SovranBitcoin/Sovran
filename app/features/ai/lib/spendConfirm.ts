import { actionMenuPopup } from '@/shared/lib/popup';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

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

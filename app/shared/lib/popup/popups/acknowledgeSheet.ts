import { actionMenuSheet } from './actionMenuSheet';

interface AcknowledgeNotice {
  title: string;
  testID: string;
  description: string;
  icon: string;
}

/**
 * A one-button notice, resolved once — on the button or on dismiss. For a
 * fact the user has to be told and cannot act on from here. It rides the sheet
 * lane so it shows above a route modal, which the menu lane does not.
 */
export function acknowledgeSheet(notice: AcknowledgeNotice): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    actionMenuSheet({
      title: notice.title,
      buttons: [
        {
          testID: notice.testID,
          text: 'OK',
          description: notice.description,
          icon: notice.icon,
          variant: 'secondary',
          onPress: (close) => {
            settle();
            close();
          },
        },
      ],
      onDismiss: () => settle(),
    });
  });
}

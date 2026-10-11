import { profileRemovalCopy as copy } from 'copy/onboarding';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
import type { ProfileSwitcherAction } from '../actionSheetTypes';
import { actionMenuPopup, replaceActionMenuPopup } from './actionMenu';

/** Separate imported-key acknowledgement, never inferred from the first confirmation. */
export function confirmProfileRemoval(
  profile: ProfileEntry,
  request: (action: ProfileSwitcherAction) => void
): void {
  const imported = profile.source === 'imported';
  const cancel = {
    text: copy.cancel,
    accessibilityLabel: copy.cancel,
    testID: 'profile-remove-cancel',
    onPress: (close: () => void) => close(),
  };
  const remove = (importedKeyConfirmed: boolean) =>
    request({ type: 'remove', accountIndex: profile.accountIndex, importedKeyConfirmed });
  replaceActionMenuPopup({
    title: copy.title,
    buttons: [
      {
        text: copy.remove,
        accessibilityLabel: copy.remove,
        description: imported ? copy.imported : copy.derived,
        variant: 'dangerous',
        testID: 'profile-remove-confirm',
        keepOpen: imported,
        onPress: () => {
          if (!imported) {
            remove(false);
            return;
          }
          replaceActionMenuPopup({
            title: copy.importedTitle,
            buttons: [
              {
                text: copy.deleteKey,
                accessibilityLabel: copy.deleteKey,
                description: copy.importedConsequence,
                variant: 'dangerous',
                testID: 'profile-remove-key-confirm',
                onPress: () => remove(true),
              },
              cancel,
            ],
          });
        },
      },
      cancel,
    ],
  });
}

/** Says why a profile is still listed after a removal was asked for. */
export function showProfileNotRemoved(reason: string): void {
  actionMenuPopup({
    title: 'Profile not removed',
    buttons: [
      {
        text: 'Close',
        description: reason,
        testID: 'profile-remove-result-close',
        accessibilityLabel: 'Close removal result',
        onPress: (close) => close(),
      },
    ],
  });
}

import { ActionMenuHost } from './popup/ActionMenuHost';
import { deleteAllProfiles } from '@/shared/lib/profile/profileSessionOrchestrator';
import { useState } from 'react';
import { Screen } from '@/shared/ui/composed/Screen';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Button } from '@/shared/ui/primitives/Button';
import { actionMenuPopup } from '@/shared/lib/popup';
import { openMnemonicRecovery, openNsecRecovery } from '@/shared/lib/profile/keyRecovery';

/** Also rendered at the key-provider boundary: downstream providers need usable keys. */
export function KeyRecoveryScreen({ locked = true }: { locked?: boolean }) {
  const [failed, setFailed] = useState(false);
  const startFresh = () =>
    actionMenuPopup({
      title: 'Start fresh?',
      buttons: [
        {
          text: 'Continue',
          testID: 'secure-fresh-confirm',
          keepOpen: true,
          description:
            'This removes all local accounts and wallet data. Keep your recovery phrase.',
          onPress: () =>
            actionMenuPopup({
              title: 'Delete local data and start fresh?',
              buttons: [
                {
                  text: 'Delete and start fresh',
                  variant: 'dangerous',
                  testID: 'secure-fresh-delete',
                  onPress: async () => {
                    setFailed(!(await deleteAllProfiles()));
                  },
                },
              ],
            }),
        },
      ],
    });
  return (
    <>
      <Screen name={locked ? 'SecureLocked' : 'ProfileKeysUnavailable'} safeArea>
        <VStack testID={locked ? 'secure-locked-screen' : 'profile-keys-error'} className="gap-5">
          <Text size={24} bold>
            {locked
              ? "Stored keys can't be unlocked on this device"
              : 'Your saved account needs its key'}
          </Text>
          <Text>
            {locked
              ? 'A backup may have restored the app without the keys needed to unlock it.'
              : 'Re-import the Nostr private key that matches this account to continue.'}
          </Text>
          <Button
            testID={locked ? 'secure-locked-import' : 'profile-keys-reimport'}
            text={locked ? 'Enter recovery phrase' : 'Re-import'}
            onPress={locked ? openMnemonicRecovery : openNsecRecovery}
          />
          {locked && (
            <Button
              testID="secure-locked-fresh"
              text="Start fresh"
              variant="secondary"
              onPress={startFresh}
            />
          )}
          {failed && <Text>Reset could not finish. Try again before continuing.</Text>}
        </VStack>
      </Screen>
      <ActionMenuHost />
    </>
  );
}

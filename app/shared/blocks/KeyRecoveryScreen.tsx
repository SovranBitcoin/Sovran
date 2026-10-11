import { ActionMenuHost } from './popup/ActionMenuHost';
import { deleteAllProfiles } from '@/shared/lib/profile/profileSessionOrchestrator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Button } from '@/shared/ui/primitives/Button';
import { actionMenuPopup } from '@/shared/lib/popup';
import { openMnemonicRecovery, openNsecRecovery } from '@/shared/lib/profile/keyRecovery';

/** Only restart once the stored root can be read; never unlock on an absent read. */
async function retryKeyAccess(locked: boolean): Promise<boolean> {
  try {
    if (locked && (await retrieveMnemonic()) === null) return false;
    return restartApp();
  } catch {
    return false;
  }
}

/** Asks twice before `onDelete`, which removes every account on the device. */
export function confirmStartFresh(onDelete: () => void | Promise<void>): void {
  actionMenuPopup({
    title: 'Start fresh?',
    buttons: [
      {
        text: 'Continue',
        testID: 'secure-fresh-confirm',
        keepOpen: true,
        description: 'This removes all local accounts and wallet data. Keep your recovery phrase.',
        onPress: () =>
          actionMenuPopup({
            title: 'Delete local data and start fresh?',
            buttons: [
              {
                text: 'Delete and start fresh',
                variant: 'dangerous',
                testID: 'secure-fresh-delete',
                onPress: onDelete,
              },
            ],
          }),
      },
    ],
  });
}

/** Also rendered at the key-provider boundary: downstream providers need usable keys. */
export function KeyRecoveryScreen({ locked = true }: { locked?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const retrying = useRef(false);
  const imported = useProfileStore(
    (state) =>
      state.profiles.find((profile) => profile.accountIndex === state.activeAccountIndex)
        ?.source === 'imported'
  );
  const recoverPhrase = locked || !imported;
  const retry = useCallback(async () => {
    if (retrying.current) return;
    retrying.current = true;
    // Boot consumers must reload together, without resuming against old caches.
    setRetryFailed(!(await retryKeyAccess(locked)));
    retrying.current = false;
  }, [locked]);
  useEffect(() => {
    if (!locked) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void retry();
    });
    return () => subscription.remove();
  }, [locked, retry]);
  return (
    <>
      <KeyRecoveryView
        locked={locked}
        imported={imported}
        retryFailed={retryFailed}
        resetFailed={failed}
        onRetry={retry}
        onRecover={recoverPhrase ? openMnemonicRecovery : openNsecRecovery}
        onStartFresh={() =>
          confirmStartFresh(async () => {
            setFailed(!(await deleteAllProfiles()));
          })
        }
      />
      <ActionMenuHost />
    </>
  );
}

/**
 * The screen as drawn, from props alone. `KeyRecoveryScreen` supplies the
 * account and the real actions; the design system supplies samples.
 */
export function KeyRecoveryView({
  locked,
  imported,
  retryFailed,
  resetFailed,
  onRetry,
  onRecover,
  onStartFresh,
}: {
  locked: boolean;
  /** The account's key was imported, not made from the recovery phrase. */
  imported: boolean;
  retryFailed: boolean;
  resetFailed: boolean;
  onRetry: () => void;
  onRecover: () => void;
  onStartFresh: () => void;
}) {
  const recoverPhrase = locked || !imported;
  return (
    <Screen name={locked ? 'SecureLocked' : 'ProfileKeysUnavailable'} safeArea>
      <VStack testID={locked ? 'secure-locked-screen' : 'profile-keys-error'} className="gap-5">
        <Text size={24} bold>
          {locked
            ? "Stored keys can't be unlocked on this device"
            : 'Your saved account needs its key'}
        </Text>
        <Text>
          {locked
            ? 'Unlock your device and retry. If the keys remain unavailable, recover with your phrase.'
            : imported
              ? 'Re-import the Nostr private key that matches this account to continue.'
              : 'Retry key setup, or enter the recovery phrase for this account.'}
        </Text>
        <Button
          testID="key-recovery-retry"
          accessibilityLabel="Retry key access"
          text="Retry"
          onPress={onRetry}
        />
        {retryFailed && <Text>Keys are still unavailable. Unlock your device and try again.</Text>}
        <Button
          testID={
            locked
              ? 'secure-locked-import'
              : recoverPhrase
                ? 'profile-keys-recover-phrase'
                : 'profile-keys-reimport'
          }
          text={recoverPhrase ? 'Enter recovery phrase' : 'Re-import'}
          onPress={onRecover}
        />
        {locked && (
          <Button
            testID="secure-locked-fresh"
            text="Start fresh"
            variant="secondary"
            onPress={onStartFresh}
          />
        )}
        {resetFailed && <Text>Reset could not finish. Try again before continuing.</Text>}
      </VStack>
    </Screen>
  );
}

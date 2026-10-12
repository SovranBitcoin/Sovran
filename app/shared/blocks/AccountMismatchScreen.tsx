import { accountMismatchCopy as copy } from 'copy/onboarding';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

import { SettingsProfileRecoveryScreen } from '@/features/settings/screens/SettingsProfileRecoveryScreen';
import { legalDocuments } from '@/shared/lib/legal/legalDocuments';
import { dismissIntegrityFailure } from '@/shared/lib/nostr/accountIntegrity';
import type { AccountIntegrityResult } from '@/shared/lib/nostr/derivationIntegrity';
import { openMnemonicRecovery } from '@/shared/lib/profile/keyRecovery';
import { useShownInsteadOfWallet } from '@/shared/lib/qrButtonAnchor';
import { switchToExistingProfile } from '@/shared/lib/profile/profileSessionOrchestrator';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import { ActionMenuHost } from './popup/ActionMenuHost';

const nameOf = (profile: Pick<ProfileEntry, 'accountIndex' | 'cachedDisplayName'>) =>
  profile.cachedDisplayName || `Profile ${profile.accountIndex}`;

/**
 * The critical stop for an account whose saved identity does not follow from
 * the recovery phrase, or from its imported key (`derivationIntegrity.ts`).
 *
 * It repairs nothing and offers no way on into that account's wallet: a person
 * can keep a copy of what the device holds, copy a code for support, switch to
 * an account that passes, or enter the phrase the account was made with.
 *
 * `stopped` is true when the mismatched account is the active one, so nothing
 * below the key provider is mounted. When it is another account (found by the
 * background check, or by a refused switch) the screen covers the running app
 * and can be closed.
 */
export function AccountMismatchScreen({
  failure,
  stopped,
}: {
  failure: AccountIntegrityResult;
  stopped: boolean;
}) {
  const profiles = useProfileStore((state) => state.profiles);
  const [showRecovery, setShowRecovery] = useState(false);
  const [copied, setCopied] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  // A stopped account is shown in place of the app, so the boot splash must not wait for the wallet home.
  useShownInsteadOfWallet(stopped);
  const code = failure.diagnosticCode ?? '';

  if (showRecovery) return <SettingsProfileRecoveryScreen onBack={() => setShowRecovery(false)} />;

  const switchTo = async (accountIndex: number) => {
    if (switching) return;
    setSwitching(true);
    setSwitchFailed(false);
    // The target is checked the same way before anything changes; a second
    // mismatch refuses the switch and this account stays the active one.
    const switched = await switchToExistingProfile({ accountIndex, fromStoppedAccount: true });
    setSwitchFailed(!switched);
    setSwitching(false);
  };

  return (
    <>
      <AccountMismatchView
        failure={failure}
        stopped={stopped}
        profiles={profiles}
        copied={copied}
        switchFailed={switchFailed}
        onViewRecovery={() => setShowRecovery(true)}
        onCopyCode={async () => {
          await Clipboard.setStringAsync(code);
          setCopied(true);
        }}
        onSwitch={(accountIndex) => void switchTo(accountIndex)}
        onEnterPhrase={openMnemonicRecovery}
        onDismiss={() => dismissIntegrityFailure(failure.accountIndex)}
      />
      {/* The running app has its own host; only a stopped account needs one. */}
      {stopped && <ActionMenuHost />}
    </>
  );
}

/**
 * The screen as drawn, from props alone: it reads no store and changes
 * nothing. `AccountMismatchScreen` supplies the saved accounts and the real
 * actions; the design system supplies samples.
 */
export function AccountMismatchView({
  failure,
  stopped,
  profiles,
  copied,
  switchFailed,
  onViewRecovery,
  onCopyCode,
  onSwitch,
  onEnterPhrase,
  onDismiss,
}: {
  failure: AccountIntegrityResult;
  stopped: boolean;
  profiles: readonly Pick<ProfileEntry, 'accountIndex' | 'cachedDisplayName'>[];
  copied: boolean;
  switchFailed: boolean;
  onViewRecovery: () => void;
  onCopyCode: () => void;
  onSwitch: (accountIndex: number) => void;
  onEnterPhrase: () => void;
  onDismiss: () => void;
}) {
  const mismatched = profiles.find((profile) => profile.accountIndex === failure.accountIndex);
  const name = nameOf(mismatched ?? failure);
  const code = failure.diagnosticCode ?? '';
  const others = profiles.filter((profile) => profile.accountIndex !== failure.accountIndex);

  return (
    <Screen name="AccountMismatch" safeArea>
      {/* Can sit where no header has been laid out, so it clears the status
          bar by its own padding, as the startup failure screens do. */}
      <VStack testID="account-mismatch-screen" className="gap-5 pt-16">
        <Text size={24} bold>
          {copy.title}
        </Text>
        <Text testID="account-mismatch-found">
          {(failure.source === 'imported' ? copy.foundImported : copy.foundDerived).replace(
            '{profile}',
            name
          )}
        </Text>
        <Text>{copy.unchanged}</Text>
        <Text>{copy.risk}</Text>

        <Text bold>{copy.actions}</Text>
        <Button
          testID="account-mismatch-view-recovery"
          accessibilityLabel={copy.view}
          text={copy.view}
          onPress={onViewRecovery}
        />
        <Text>{copy.viewHint}</Text>

        <Text testID="account-mismatch-code" selectable>
          {code}
        </Text>
        <Button
          testID="account-mismatch-copy-code"
          accessibilityLabel={copy.copyCode}
          text={copied ? copy.codeCopied : copy.copyCode}
          variant="secondary"
          onPress={onCopyCode}
        />
        <Text>{copy.codeHint}</Text>
        <Text>{copy.contact.replace('{email}', legalDocuments.operator.email)}</Text>

        {stopped &&
          others.map((profile) => (
            <Button
              key={profile.accountIndex}
              testID={`account-mismatch-switch-${profile.accountIndex}`}
              accessibilityLabel={copy.switchTo.replace('{profile}', nameOf(profile))}
              text={copy.switchTo.replace('{profile}', nameOf(profile))}
              variant="secondary"
              onPress={() => onSwitch(profile.accountIndex)}
            />
          ))}
        {switchFailed && <Text testID="account-mismatch-switch-failed">{copy.switchFailed}</Text>}

        {stopped && failure.source === 'derived' && (
          <>
            <Button
              testID="account-mismatch-enter-phrase"
              accessibilityLabel={copy.enterPhrase}
              text={copy.enterPhrase}
              variant="secondary"
              onPress={onEnterPhrase}
            />
            <Text>{copy.enterPhraseHint}</Text>
          </>
        )}

        {!stopped && (
          <Button
            testID="account-mismatch-dismiss"
            accessibilityLabel={copy.keepUsing}
            text={copy.keepUsing}
            variant="secondary"
            onPress={onDismiss}
          />
        )}
      </VStack>
    </Screen>
  );
}

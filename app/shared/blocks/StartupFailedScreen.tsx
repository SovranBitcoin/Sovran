import { Screen } from '@/shared/ui/composed/Screen';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Button } from '@/shared/ui/primitives/Button';

const COPY = {
  storage: {
    screen: 'StorageUpdateFailed',
    testID: 'storage-update',
    title: "The update couldn't finish",
    body: 'Your wallet and accounts are untouched. Sovran needs to finish updating its saved data before it can open. Try again, or close and reopen the app.',
    retryLabel: 'Retry the update',
  },
  wallet: {
    screen: 'WalletOpenFailed',
    testID: 'wallet-open',
    title: "Your wallet couldn't be opened",
    body: 'Nothing has been changed or removed. Try again, or close and reopen the app. Your recovery phrase can restore the wallet if this keeps happening.',
    retryLabel: 'Retry opening the wallet',
  },
} as const;

/**
 * Shown when a blocking startup step fails and can be tried again: a storage
 * migration (`GlobalMigrationGate`) or opening the wallet (`CocoProvider`).
 * It can be rendered above the account providers, so nothing here may read a
 * store.
 */
export function StartupFailedScreen({
  step,
  onRetry,
}: {
  step: keyof typeof COPY;
  onRetry: () => void;
}) {
  const copy = COPY[step];
  return (
    <Screen name={copy.screen} safeArea>
      {/* Above the navigator there is no header and, on Android, no top inset
          yet, so the content clears the status bar by its own padding. */}
      <VStack testID={`${copy.testID}-failed-screen`} className="gap-5 pt-16">
        <Text size={24} bold>
          {copy.title}
        </Text>
        <Text>{copy.body}</Text>
        <Button
          testID={`${copy.testID}-retry`}
          accessibilityLabel={copy.retryLabel}
          text="Retry"
          onPress={onRetry}
        />
      </VStack>
    </Screen>
  );
}

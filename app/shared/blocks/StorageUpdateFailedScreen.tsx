import { Screen } from '@/shared/ui/composed/Screen';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Button } from '@/shared/ui/primitives/Button';

/**
 * Shown by `GlobalMigrationGate` when a startup storage migration fails.
 * Rendered above the account providers: nothing here may read a store.
 */
export function StorageUpdateFailedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen name="StorageUpdateFailed" safeArea>
      {/* Above the navigator there is no header and, on Android, no top inset
          yet, so the content clears the status bar by its own padding. */}
      <VStack testID="storage-update-failed-screen" className="gap-5 pt-16">
        <Text size={24} bold>
          {"The update couldn't finish"}
        </Text>
        <Text>
          Your wallet and accounts are untouched. Sovran needs to finish updating its saved data
          before it can open. Try again, or close and reopen the app.
        </Text>
        <Button
          testID="storage-update-retry"
          accessibilityLabel="Retry the update"
          text="Retry"
          onPress={onRetry}
        />
      </VStack>
    </Screen>
  );
}

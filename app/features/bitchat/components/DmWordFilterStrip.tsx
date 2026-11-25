import { ChatStatusStrip } from '@/features/bitchat/components/BluetoothNotice';
import { useFeedIgnoreStore } from '@/shared/stores/profile/ignoreStore';
import { Button } from '@/shared/ui/primitives/Button';

/**
 * Says, above a Nostr DM thread, that the account's DM word filter is hiding
 * messages, and turns it off in place. The Settings page that set the filter
 * is gone, so an account upgraded with it on needs this to reach it at all.
 * Turning it off keeps the saved words.
 */
export function DmWordFilterStrip() {
  const enabled = useFeedIgnoreStore((s) => s.dmFilterEnabled);
  const hasWords = useFeedIgnoreStore((s) => s.dmFilterWords.length > 0);
  const setEnabled = useFeedIgnoreStore((s) => s.setDmFilterEnabled);
  if (!enabled || !hasWords) return null;
  return (
    <ChatStatusStrip
      icon="majesticons:eye-off"
      text="Your word filter hides messages with words you chose."
      action={
        <Button
          text="Turn off"
          variant="secondary"
          size="compact"
          testID="dm-word-filter-off"
          accessibilityLabel="Turn off word filter"
          onPress={() => setEnabled(false)}
        />
      }
    />
  );
}

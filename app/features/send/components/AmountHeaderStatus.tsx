import { View } from '@/shared/ui/primitives/View/View';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';

interface AmountHeaderStatusProps {
  /** Omit when the payment is not ecash and there is nothing to lock. */
  lock?: { locked: boolean; label: string; onPress: () => void };
  /**
   * Whether this amount can be sent with no network: `true` when the wallet
   * already holds proofs that make it exactly, `false` when the mint has to
   * swap first, `null` while that is still being worked out.
   */
  canSendOffline: boolean | null;
}

const STATUS_ICON_SIZE = 18;

/**
 * The amount screen's header status: whether the ecash will be locked, and
 * whether it can leave without a network. Two facts that decide who can take
 * the money and whether the send can happen at all, so they sit in the bar of
 * every ecash amount screen rather than as a badge under the number.
 */
export function AmountHeaderStatus({ lock, canSendOffline }: AmountHeaderStatusProps) {
  // A lock is made by a swap at the mint, so a locked send needs the network
  // whatever proofs the wallet holds.
  const offline = lock?.locked ? false : canSendOffline;
  return (
    <View className="flex-row items-center gap-2">
      {lock ? (
        <ScreenHeaderAction
          testID="amount-header-lock"
          icon={lock.locked ? 'mdi:lock-outline' : 'mdi:lock-open-variant-outline'}
          size={STATUS_ICON_SIZE}
          accessibilityLabel={lock.label}
          onPress={lock.onPress}
        />
      ) : null}
      <View className={offline === null ? 'opacity-30' : undefined}>
        <ScreenHeaderAction
          testID="amount-header-sendability"
          icon={offline === true ? 'mdi:airplane' : 'mdi:wifi'}
          size={STATUS_ICON_SIZE}
          accessibilityLabel={
            offline === true
              ? 'Offline send available'
              : offline === false
                ? 'Network required'
                : 'Checking offline send availability'
          }
        />
      </View>
    </View>
  );
}

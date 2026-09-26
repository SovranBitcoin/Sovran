import React from 'react';

import BalancePill from '@/shared/ui/composed/BalancePill';
import { Log } from '@/shared/lib/logger';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { PresenceDot } from '@/shared/ui/primitives/PresenceDot';
import { View } from '@/shared/ui/primitives/View/View';
import { useMintLiveness } from '@/features/mint/hooks/useMintLiveness';
import { useMintSelector, type MintSelectorProps } from './useMintSelector';

/**
 * Wallet header pill — thin shim over the generic `<BalancePill />`. Owns
 * mint-specific data (icon URL, mint name, balance from `useMintSelector`)
 * and delegates the platform-aware liquid-glass / blur-card chrome to the
 * shared component. The AI tab mounts the same `BalancePill` with a wallet
 * icon + "Balance" + Routstr sats, so visual parity is structural rather
 * than copy-pasted.
 */
export default function MintSelector(props: MintSelectorProps): React.ReactElement {
  const shared = useMintSelector(props);
  const liveness = useMintLiveness(shared.mintUrl);

  return (
    <Log name="MintSelector">
      <BalancePill
        testID={props.testID}
        title={shared.mintName}
        balance={shared.balance}
        unit={shared.unit}
        isLoading={shared.isLoading}
        iconNode={
          // The same dot the mint rows carry, so the header answers "is my
          // mint up?" without opening the selector. Feedback, never a gate.
          <View className="relative">
            <MintIcon
              iconUrl={shared.mintIconUrl}
              name={shared.mintName}
              size={32}
              isLoading={shared.isLoading}
            />
            {!shared.isLoading ? (
              <PresenceDot presence={liveness === 'unknown' ? null : liveness} size={32} />
            ) : null}
          </View>
        }
        loadingTitlePlaceholder="Mint Name"
        onPress={shared.onRequestMintList}
        width={shared.dimensions.buttonWidth}
        height={props.height}
        contentHeight={props.contentHeight}
      />
    </Log>
  );
}

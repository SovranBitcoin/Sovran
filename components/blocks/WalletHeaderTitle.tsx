import React from 'react';
import { Dimensions } from 'react-native';
import { View } from 'components/ui/View';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

/**
 * A self-contained header title component for the wallet screen.
 * Uses stores/contexts internally so it can work as a headerTitle component.
 */
export default function WalletHeaderTitle() {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const setSelectedMint = useMintStore((state) => state.setSelectedMint);

  const handleMintSelected = React.useCallback(
    async (mint: { id: string; unit: string }) => {
      if (!pubkey) {
        if (__DEV__) {
          console.warn('WalletHeaderTitle: No pubkey available, cannot set selected mint');
        }
        return;
      }
      setSelectedMint(pubkey, mint.id);
    },
    [pubkey, setSelectedMint]
  );

  // Calculate width to fit between header buttons
  const headerWidth = Dimensions.get('window').width - 124 - 16;

  return (
    <View className="pointer-events-box-none" style={{ width: headerWidth }}>
      <MintBalanceDisplay
        unit="sat"
        onMintSelected={handleMintSelected}
        requireBalance={false}
        updateSelectedMint={true}
        showAddMintsButton={true}
        showDetailsButton={true}
      />
    </View>
  );
}

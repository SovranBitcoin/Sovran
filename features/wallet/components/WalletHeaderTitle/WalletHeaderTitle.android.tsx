import React from 'react';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { View } from '@/shared/ui/primitives/View/View';
import { useWalletHeaderTitle, type WalletHeaderTitleProps } from './useWalletHeaderTitle';

export default function WalletHeaderTitle(props: WalletHeaderTitleProps): React.ReactElement {
  const { dimensions, mintDisplayProps, style } = useWalletHeaderTitle(props);

  return (
    <View
      style={{
        width: dimensions.fallbackWidth,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        ...(style || {}),
      }}>
      <MintBalanceDisplay {...mintDisplayProps} style={{ width: '100%' }} />
    </View>
  );
}

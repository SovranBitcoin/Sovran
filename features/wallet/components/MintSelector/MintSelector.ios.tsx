import React from 'react';
import { StyleSheet } from 'react-native';

import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { MintSelectorLiquid } from './MintSelector.liquid';
import { useMintSelector, type MintSelectorProps } from './useMintSelector';

export default function MintSelector(props: MintSelectorProps): React.ReactElement {
  const shared = useMintSelector(props);
  const muted = useThemeColor('muted');

  if (supportsLiquidGlass()) {
    return <MintSelectorLiquid {...shared} />;
  }

  const borderColor = opacity(muted, 0.3);

  return (
    <View style={[styles.card, { borderColor }]}>
      <BlurCardFrame accentColor={muted}>
        <PressableFeedback
          animation={false}
          onPress={shared.onRequestMintList}
          style={[styles.pressable, { width: shared.dimensions.buttonWidth, padding: 8 }]}>
          <MintBalanceDisplay
            mintName={shared.mintName}
            mintIconUrl={shared.mintIconUrl}
            balance={shared.balance}
            isLoading={shared.isLoading}
            unit={shared.unit}
            contentWidth={shared.dimensions.contentWidth}
            contentHeight={shared.dimensions.contentHeight}
            style={styles.fullWidth}
          />
          <PressableFeedback.Ripple />
        </PressableFeedback>
      </BlurCardFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 20,
  },
  fullWidth: {
    width: '100%',
  },
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
});

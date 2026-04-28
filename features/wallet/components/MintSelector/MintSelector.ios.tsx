import React from 'react';
import { StyleSheet } from 'react-native';

import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { Log } from '@/shared/lib/logger';
import { MintSelectorLiquid } from './MintSelector.liquid';
import { useMintSelector, type MintSelectorProps } from './useMintSelector';

export default function MintSelector(props: MintSelectorProps): React.ReactElement {
  const shared = useMintSelector(props);
  const muted = useThemeColor('muted');

  if (supportsLiquidGlass()) {
    return <MintSelectorLiquid {...shared} />;
  }

  const borderColor = opacity(muted, 0.3);

  // Match the glass variant's height (`HEADER_LAYOUT.BUTTON_HEIGHT` = 54pt)
  // so the wallet header doesn't reflow when "Mock no-glass" is toggled.
  const cardHeight = HEADER_LAYOUT.BUTTON_HEIGHT;
  const cardContentHeight = shared.dimensions.contentHeight;
  const verticalPadding = (cardHeight - cardContentHeight) / 2;
  // Full-pill capsule, matching the SwiftUI `buttonStyle('glass')` default
  // shape on the liquid variant.
  const cardRadius = cardHeight / 2;

  return (
    <Log name="MintSelector">
      <View style={[styles.card, { borderColor, height: cardHeight, borderRadius: cardRadius }]}>
        <BlurCardFrame accentColor={muted}>
          <PressableFeedback
            animation={false}
            onPress={shared.onRequestMintList}
            style={[
              styles.pressable,
              {
                width: shared.dimensions.buttonWidth,
                height: cardHeight,
                borderRadius: cardRadius,
                paddingVertical: verticalPadding,
                paddingHorizontal: 8,
              },
            ]}>
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
    </Log>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 20,
    justifyContent: 'center',
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

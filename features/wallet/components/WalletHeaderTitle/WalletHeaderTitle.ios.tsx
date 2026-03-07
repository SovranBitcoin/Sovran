import React from 'react';
import { StyleSheet } from 'react-native';

import { router } from 'expo-router';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { WalletHeaderTitleLiquid } from './WalletHeaderTitle.liquid';
import { useWalletHeaderTitle, type WalletHeaderTitleProps } from './useWalletHeaderTitle';

export default function WalletHeaderTitle(props: WalletHeaderTitleProps): React.ReactElement {
  const { dimensions, mintDisplayProps, style, ...liquidProps } = useWalletHeaderTitle(props);
  const muted = useThemeColor('muted');

  if (supportsLiquidGlass()) {
    return (
      <WalletHeaderTitleLiquid
        {...liquidProps}
        dimensions={dimensions}
        mintDisplayProps={mintDisplayProps}
        style={style}
      />
    );
  }

  const borderColor = opacity(muted, 0.3);

  return (
    <View style={[styles.card, { borderColor }]}>
      <BlurCardFrame accentColor={muted}>
        <PressableFeedback
          animation={false}
          onPress={() => router.navigate(mintDisplayProps.linkHref)}
          style={[
            styles.pressable,
            {
              width: dimensions.fallbackWidth,
            },
            style,
          ]}>
          <MintBalanceDisplay {...mintDisplayProps} variant="plain" style={styles.fullWidth} />
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

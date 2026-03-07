import React from 'react';
import { Host, Button as SwiftUIButton, ContextMenu, HStack } from '@expo/ui/swift-ui';
import { buttonStyle, frame, padding, glassEffect } from '@expo/ui/swift-ui/modifiers';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { View } from '@/shared/ui/primitives/View/View';
import { formatBalance, type WalletHeaderTitleShared } from './useWalletHeaderTitle';

export function WalletHeaderTitleLiquid({
  topMints,
  handleQuickSelectMint,
  handleShowAllMints,
  handleAddMint,
  dimensions,
  mintDisplayProps,
  showAddMintsButton,
  liquidGlass,
  style,
}: WalletHeaderTitleShared): React.ReactElement {
  const buttonModifiers = [
    buttonStyle('glass'),
    frame({ height: 50, width: dimensions.buttonWidth, alignment: 'center' }),
    ...(liquidGlass ? [] : [glassEffect({ shape: 'capsule' })]),
  ];

  return (
    <View
      style={{
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        width: dimensions.buttonWidth,
        height: typeof dimensions.styleHeight === 'number' ? dimensions.styleHeight : undefined,
        ...style,
      }}>
      <Host style={{ zIndex: 10, height: 50, width: dimensions.buttonWidth }} matchContents>
        <ContextMenu>
          <ContextMenu.Items>
            {topMints.map((mint) => (
              <SwiftUIButton
                key={mint.mintUrl}
                systemImage="building.columns"
                label={`${mint.displayName} (${formatBalance(mint.balance)})`}
                onPress={() => handleQuickSelectMint(mint.mintUrl)}
              />
            ))}
            <SwiftUIButton
              systemImage="list.bullet.rectangle"
              label="Show all mints"
              onPress={handleShowAllMints}
            />
            {showAddMintsButton && (
              <SwiftUIButton systemImage="plus.circle" label="Add Mint" onPress={handleAddMint} />
            )}
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <HStack
              modifiers={
                liquidGlass || typeof dimensions.buttonWidth === 'number'
                  ? []
                  : [padding({ horizontal: 64 })]
              }>
              <SwiftUIButton modifiers={buttonModifiers}>
                <MintBalanceDisplay {...mintDisplayProps} />
              </SwiftUIButton>
            </HStack>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
}

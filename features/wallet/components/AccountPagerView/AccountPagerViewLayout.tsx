import React from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';

import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Account } from '../Account';
import { BUTTON_H, QR_SIZE, type AccountPagerViewShared } from './useAccountPagerView';
import { Log, walletLog } from '@/shared/lib/logger';

const RECEIVE_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.down.left' : undefined;
const SEND_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.up.right' : undefined;

export function AccountPagerViewLayout({
  shared,
}: {
  shared: AccountPagerViewShared;
}): React.ReactElement {
  const {
    accounts,
    account,
    pagerHeight,
    swiperRef,
    onPageSelected,
    handleReceive,
    handleScanQR,
    handleSend,
  } = shared;

  return (
    <Log name="AccountPagerViewLayout">
      <View className="w-full" style={{ height: pagerHeight }}>
        <Swiper
          containerStyle={{ height: pagerHeight }}
          controlsEnabled={false}
          loop
          infinite
          from={0}
          ref={swiperRef}
          minDistanceForAction={0.1}
          onIndexChanged={onPageSelected}
          controlsProps={{ dotsTouchable: true, dotsPos: 'top' }}>
          {accounts.map((acc, index) => (
            <VStack key={`${acc.unit}-${index}`} align="center" justify="center" className="flex-1">
              <Account accounts={accounts} account={acc} pagerHeight={pagerHeight} />
            </VStack>
          ))}
        </Swiper>
      </View>

      {/*
       * Secondary action row — sits above the primary Receive/QR/Send capsule row.
       * Hosts [Split Bill] [Swap] [Soon]. The last slot is the only inert
       * placeholder (0.4 opacity, no press feedback) — reserved for a future
       * quick-action (BIP353 handle, scheduled payments, etc.).
       *
       * Icons:
       *   `mdi:silverware-fork-knife` is the universal restaurant glyph and
       *   reads as "bill/check" better than abstract "split" icons in our
       *   registered monicon set (see .monicon/icons.js).
       *   `mdi:swap-horizontal` → "Swap" → navigates to the mint-flow
       *   `distribution` screen, whose title is "Balance split" (see
       *   `app/(mint-flow)/_layout.tsx:27`). Same destination
       *   `HealthModalScreen.handleAction` routes to for `openBalanceSplit`.
       *   `tabler:dots` for the single remaining placeholder.
       */}
      <HStack justify="space-around" style={{ marginTop: 4, paddingHorizontal: 32 }}>
        <CircleActionButton
          icon="mdi:silverware-fork-knife"
          systemIcon="fork.knife"
          label="Split Bill"
          testID="wallet-split-bill"
          onPress={() => {
            walletLog.info('wallet.split_bill.tap');
            router.push('/(user-flow)/splitBill/amount' as any);
          }}
        />
        <CircleActionButton
          icon="mdi:swap-horizontal"
          systemIcon="arrow.left.arrow.right"
          label="Swap"
          testID="wallet-swap"
          onPress={() => {
            walletLog.info('wallet.swap.tap', { unit: account.unit });
            router.navigate({
              pathname: '/(mint-flow)/distribution',
              params: { unit: account.unit },
            });
          }}
        />
        <CircleActionButton
          icon="tabler:dots"
          systemIcon="ellipsis"
          label="Soon"
          disabled
          testID="wallet-action-placeholder-1"
        />
      </HStack>

      <View
        className="relative w-full justify-center px-3"
        style={{ marginTop: 8, height: Math.max(QR_SIZE, BUTTON_H) }}>
        <View className="flex-row gap-3">
          <View testID="wallet-receive" className="flex-1">
            <CapsuleButton
              label="Receive"
              icon="lucide:arrow-down-left"
              systemIcon={RECEIVE_SYSTEM_ICON}
              onPress={handleReceive}
            />
          </View>
          <View testID="wallet-send" className="flex-1">
            <CapsuleButton
              label="Send"
              icon="lucide:arrow-up-right"
              systemIcon={SEND_SYSTEM_ICON}
              onPress={handleSend}
            />
          </View>
        </View>

        <View pointerEvents="box-none" className="absolute inset-x-0 z-[1000] items-center">
          <QRButton onPress={handleScanQR} />
        </View>
      </View>
    </Log>
  );
}

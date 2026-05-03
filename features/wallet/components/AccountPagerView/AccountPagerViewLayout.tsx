import React from 'react';
import { Platform } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';

import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { Account } from '../Account';
import {
  BUTTON_H,
  QR_SIZE,
  SECONDARY_ACTION_ROW_HEIGHT,
  type AccountPagerViewShared,
} from './useAccountPagerView';
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

  // While a multi-leg swap is running, every payment-initiating button on
  // this screen is gated. Coco's mint/melt services serialize through a
  // per-instance lock, and the user kicking off a Send/Receive/Swap/Split
  // Bill in parallel can stall the swap or surface "operation already in
  // progress" errors. Greying out is the cheapest user-visible indicator.
  const isSwapping = useSwapStatusStore((s) => s.active?.state === 'running');

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
       *   `app/(mint-flow)/_layout.tsx:27`).
       *   `tabler:dots` for the single remaining placeholder.
       */}
      <HStack
        justify="space-around"
        style={{ marginTop: 4, paddingHorizontal: 32, height: SECONDARY_ACTION_ROW_HEIGHT }}>
        <CircleActionButton
          icon="mdi:silverware-fork-knife"
          systemIcon="fork.knife"
          label="Split Bill"
          testID="wallet-split-bill"
          disabled={isSwapping}
          onPress={() => {
            walletLog.info('wallet.split_bill.tap');
            router.push('/(split-bill-flow)/amount');
          }}
        />
        <CircleActionButton
          icon="mdi:swap-horizontal"
          systemIcon="arrow.left.arrow.right"
          label="Swap"
          testID="wallet-swap"
          disabled={isSwapping}
          onPress={() => {
            walletLog.info('wallet.swap.tap', { unit: account.unit });
            router.navigate({
              pathname: '/(mint-flow)/distribution',
              params: { unit: account.unit },
            });
          }}
        />
        <CircleActionButton
          icon="mdi:palette"
          systemIcon="paintpalette"
          label="Theme"
          testID="wallet-action-theme"
          onPress={() => {
            walletLog.info('wallet.theme.tap');
            router.push('/(theme-flow)/preview');
          }}
        />
      </HStack>

      {/* Wrap the Receive / Send / QR row in a single pointerEvents=none
          shroud while swapping. CapsuleButton and QRButton don't accept a
          `disabled` prop, so the cheapest correct gate is to short-circuit
          touches at the parent and reduce opacity to match
          CircleActionButton's disabled treatment (0.4). */}
      <View
        pointerEvents={isSwapping ? 'none' : 'auto'}
        className="relative w-full justify-center px-3"
        style={{
          marginTop: 8,
          height: Math.max(QR_SIZE, BUTTON_H),
          opacity: isSwapping ? 0.4 : 1,
        }}>
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

import React from 'react';
import { Platform } from 'react-native';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';

import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Account } from '../Account';
import { BUTTON_H, QR_SIZE, type AccountPagerViewShared } from './useAccountPagerView';
import { Log } from '@/shared/lib/logger';

const RECEIVE_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.down.left' : undefined;
const SEND_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.up.right' : undefined;

export function AccountPagerViewLayout({
  shared,
}: {
  shared: AccountPagerViewShared;
}): React.ReactElement {
  const {
    accounts,
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

      <View
        className="relative w-full justify-center px-3"
        style={{ marginTop: 8, height: Math.max(QR_SIZE, BUTTON_H) }}>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <CapsuleButton
              label="Receive"
              icon="lucide:arrow-down-left"
              systemIcon={RECEIVE_SYSTEM_ICON}
              onPress={handleReceive}
            />
          </View>
          <View className="flex-1">
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

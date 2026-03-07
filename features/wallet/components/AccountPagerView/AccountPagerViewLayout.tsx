import React from 'react';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Account } from '../Account';
import { BUTTON_H, QR_SIZE, type AccountPagerViewShared } from './useAccountPagerView';

interface AccountPagerViewLayoutProps {
  shared: AccountPagerViewShared;
  renderReceiveButton: () => React.ReactNode;
  renderSendButton: () => React.ReactNode;
  renderQrButton: () => React.ReactNode;
}

export function AccountPagerViewLayout({
  shared,
  renderReceiveButton,
  renderSendButton,
  renderQrButton,
}: AccountPagerViewLayoutProps): React.ReactElement {
  const { accounts, pagerHeight, swiperRef, onPageSelected } = shared;

  return (
    <>
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
          <View className="flex-1">{renderReceiveButton()}</View>
          <View className="flex-1">{renderSendButton()}</View>
        </View>

        <View pointerEvents="box-none" className="absolute inset-x-0 z-[1000] items-center">
          {renderQrButton()}
        </View>
      </View>
    </>
  );
}

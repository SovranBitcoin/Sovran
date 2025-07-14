import React from 'react';
import { View } from 'react-native';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import Swiper from 'react-native-web-infinite-swiper';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { memoizedGetTheme } from 'helper/redux/settings';
import { CreditCardComponent } from 'components/common/NFCCard';

const TabTwoScreen = () => {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: greys(theme)[700],
      }}>
      <View className="bg-transparent">
        <View style={{ height: 500 }}>
          <Swiper
            controlsEnabled={false}
            from={0}
            minDistanceForAction={0.1}
            controlsProps={{
              dotsTouchable: true,
              dotsPos: 'top',
            }}>
            {[1, 2].map((acc, index) => (
              <View
                key={acc}
                style={{
                  flex: 1,
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  backgroundColor: greys(theme)[700],
                  marginTop: 32,
                }}>
                <CreditCardComponent />
              </View>
            ))}
          </Swiper>
        </View>
      </View>
    </View>
  );
};

export default withSheetProvider(TabTwoScreen);

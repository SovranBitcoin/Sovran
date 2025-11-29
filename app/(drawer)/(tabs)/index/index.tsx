import MaskedView from '@react-native-masked-view/masked-view';
import { usePaginatedHistory } from 'coco-cashu-react';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { Transactions } from 'components/blocks/Transactions';
import AnimatedSpriteBackground from 'components/ui/SpriteView';
import { View } from 'components/ui/View';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { useTheme } from 'providers/ThemeProvider';
import { memo, useCallback, useMemo, useState } from 'react';
import { Dimensions, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import 'react-native-get-random-values';
import 'shim';
import { useSettingsStore } from 'stores/settingsStore';
import { isBackgroundImageTheme, getGradientColorScale } from 'config/backgroundImageThemes';

function TabOneScreen() {
  const supportedUnits = useMemo(() => ['sat', 'usd', 'eur', 'gbp'], []);

  const accounts = useMemo(
    () =>
      [
        {
          unit: 'sat',
        },
        // {
        //   unit: 'usd',
        // },
        // {
        //   unit: 'eur',
        // },
        // {
        //   unit: 'gbp',
        // },
      ].filter((u) => supportedUnits.includes(u.unit)),
    [supportedUnits]
  );

  const [account, setAccount] = useState(accounts[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const viewportHeight = Dimensions.get('window').height;

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
    console.log('Page height (content):', height);
    console.log('Viewport height:', Dimensions.get('window').height);
  }, []);

  const onRefresh = useCallback(async () => {}, []);

  // Calculate gradient locations relative to content height
  // so they always appear at the same pixel position (0.3 and 0.6 of viewport)
  const gradientLocations = useMemo((): {
    maskLocations: [number, number, number, number];
    overlayLocations: [number, number];
  } => {
    if (contentHeight <= 0) {
      return { maskLocations: [0, 0.3, 0.6, 1], overlayLocations: [0.3, 0.6] };
    }
    const ratio = viewportHeight / contentHeight;
    const start = Math.min(0.3 * ratio, 1);
    const end = Math.min(0.6 * ratio, 1);
    return {
      maskLocations: [0, start, end, 1],
      overlayLocations: [start, end],
    };
  }, [viewportHeight, contentHeight]);

  const { getPrimaryColor } = useTheme();
  const primaryColor900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);

  // Get gradient colors for background image themes
  const currentTheme = useSettingsStore((state) => state.getTheme());
  const gradientColors = useMemo(() => {
    if (isBackgroundImageTheme(currentTheme)) {
      return getGradientColorScale(currentTheme);
    }
    return null;
  }, [currentTheme]);

  const { history } = usePaginatedHistory();

  useDeeplink();
  useVersionCheck();

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
      }}>
      <AnimatedSpriteBackground backgroundColor={primaryColor900} />
      <MaskedView
        style={[
          StyleSheet.absoluteFillObject,
          {
            top: 'auto',
            height: '50%',
          },
        ]}
        maskElement={
          <LinearGradient
            colors={['transparent', 'rgba(0, 0, 0, 0.95)']}
            locations={[0, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
        <BlurView intensity={200} tint="prominent" style={StyleSheet.absoluteFillObject} />
      </MaskedView>

      <View className="flex-1">
        <ScrollView
          style={{ flex: 1 }}
          onContentSizeChange={onContentSizeChange}
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
          {/* Gradient overlay that scrolls with content */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: contentHeight || viewportHeight,
            }}
            pointerEvents="none">
            <MaskedView
              style={StyleSheet.absoluteFillObject}
              maskElement={
                <LinearGradient
                  colors={['transparent', 'transparent', 'black', 'black']}
                  locations={gradientLocations.maskLocations}
                  style={StyleSheet.absoluteFillObject}
                />
              }>
              <BlurView intensity={200} tint="prominent" style={StyleSheet.absoluteFillObject} />
            </MaskedView>
            {gradientColors && (
              <LinearGradient
                colors={['transparent', opacity(gradientColors?.['300'], 0.33)]}
                locations={gradientLocations.overlayLocations}
                style={StyleSheet.absoluteFillObject}
              />
            )}
            <LinearGradient
              colors={['transparent', opacity(getPrimaryColor('950'), 0.33)]}
              locations={gradientLocations.overlayLocations}
              style={StyleSheet.absoluteFillObject}
            />
          </View>

          <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
          <View
            className="p-4 pt-0"
            style={{
              // backgroundColor: primaryColor900,
              minHeight: Dimensions.get('window').height - 375,
            }}>
            <Transactions account={account} showMore={true} history={history} hideExpired={true} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export default memo(TabOneScreen);

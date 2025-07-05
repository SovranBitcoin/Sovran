import React, { useState, useCallback, useMemo } from 'react';
import { Pressable } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { AnimatedQRCode } from 'components/common/QRCode';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { GradientSkeleton } from '../common/GradientSkeleton';
import { greys, shades } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
  useSharedValue,
} from 'react-native-reanimated';
import { showMessage } from 'helper/popup/popups';
import { Section } from 'components/common/Section';

interface TabItem {
  name: string;
  value: string;
}

interface PaymentInfoProps {
  unit: string;
  data: string | TabItem[];
  link?: string;
  popupMessage: string | { [key: number]: { name: string } };
  setUri?: (uri: string) => void;
  animated?: boolean;
  variant?: 'primary' | 'secondary';
  showSection?: boolean;
}

export function PaymentInfo({
  unit,
  data,
  link,
  popupMessage,
  setUri,
  animated = false,
  variant = 'primary',
  showSection = true,
}: PaymentInfoProps): React.ReactElement {
  const theme = useSelector(memoizedGetTheme);
  const underscoreWidth = useSharedValue(0);
  const underscorePosition = useSharedValue(0);

  const [activeTab, setActiveTab] = useState<number>(0);
  const tabWidths = React.useRef<number[]>([]);
  const tabOffsets = React.useRef<number[]>([]);

  const hasTabs = Array.isArray(data) && data.length > 0;
  const TABS = useMemo(() => (hasTabs ? data.map((item) => item.name) : []), [hasTabs, data]);

  const [selectedValue, setSelectedValue] = useState<string>(
    hasTabs ? data[0].value : typeof data === 'string' ? data : ''
  );

  const animatedUnderscoreStyle = useAnimatedStyle(() => ({
    width: withTiming(underscoreWidth.value, {
      duration: 200,
      easing: Easing.out(Easing.ease),
    }),
    transform: [
      {
        translateX: withTiming(underscorePosition.value, {
          duration: 200,
          easing: Easing.out(Easing.ease),
        }),
      },
    ],
  }));

  const measureTab = useCallback(
    (event: any, index: number) => {
      const { width, x } = event.nativeEvent.layout;
      tabWidths.current[index] = width;
      tabOffsets.current[index] = x;
      if (index === 0 && underscoreWidth.value === 0) {
        underscoreWidth.value = width;
        underscorePosition.value = x;
      }
    },
    [underscoreWidth, underscorePosition]
  );

  const handleTabPress = useCallback(
    (index: number) => {
      if (!Array.isArray(data)) return;

      setActiveTab(index);
      underscoreWidth.value = tabWidths.current[index] ?? 0;
      underscorePosition.value = tabOffsets.current[index] ?? 0;
      setSelectedValue(data[index].value);
    },
    [data, underscoreWidth, underscorePosition]
  );

  const handleCopyPress = useCallback(async () => {
    const textToCopy = link || selectedValue;
    await Clipboard.setStringAsync(textToCopy);

    const message =
      typeof popupMessage === 'string'
        ? popupMessage
        : (popupMessage[activeTab]?.name ?? 'Copied to clipboard');

    showMessage(message);
  }, [link, selectedValue, popupMessage, activeTab]);

  const renderTabs = (): React.ReactElement | null => {
    if (TABS.length === 0) return null;

    return (
      <View className="mx-4 bg-transparent px-4">
        <View className="mb-0 flex-1 justify-center bg-transparent">
          <View className="flex-1 flex-row bg-transparent">
            {TABS.map((tab, index) => (
              <TabButton
                key={tab}
                label={tab}
                isActive={index === activeTab}
                onPress={() => handleTabPress(index)}
                onLayout={(event) => measureTab(event, index)}
                theme={theme}
                isFirst={index === 0}
                animatedStyle={animatedUnderscoreStyle}
              />
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderQRCode = (): React.ReactElement => {
    if (!selectedValue) {
      return (
        <View className="flex-row items-center justify-center bg-transparent">
          <GradientSkeleton startColor={greys(theme)[800]} endColor={greys(theme)[950]} />
        </View>
      );
    }

    return (
      <Pressable className="bg-transparent" onPress={handleCopyPress}>
        <ViewShot captureMode="mount" onCapture={setUri}>
          <AnimatedQRCode
            padding={32}
            unit={unit}
            address={selectedValue}
            animate={animated}
            variant={variant}
          />
        </ViewShot>
      </Pressable>
    );
  };

  const renderSection = (): React.ReactElement | null => {
    if (!selectedValue || !showSection) return null;

    return (
      <>
        <Spacer size={12} />
        <Section
          special={true}
          style={{
            marginLeft: 16,
            marginRight: 16,
            marginBottom: 0,
          }}
          items={[
            {
              title: '',
              value: link || selectedValue,
            },
          ]}
        />
      </>
    );
  };

  return (
    <>
      {renderTabs()}
      {renderQRCode()}
      {renderSection()}
    </>
  );
}

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  onLayout: (event: any) => void;
  theme: any;
  isFirst: boolean;
  animatedStyle: any;
}

const TabButton = React.memo(
  ({
    label,
    isActive,
    onPress,
    onLayout,
    theme,
    isFirst,
    animatedStyle,
  }: TabButtonProps): React.ReactElement => {
    return (
      <TouchableOpacity
        onPress={onPress}
        className="relative flex-1 items-center bg-transparent pb-2"
        onLayout={onLayout}>
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: isActive ? greys(theme)[0] : greys(theme)[400],
          }}>
          {label}
        </Text>
        {isFirst && (
          <Animated.View
            style={[
              {
                height: 2,
                width: '100%',
                backgroundColor: shades[300],
                marginTop: 8,
                position: 'absolute',
                bottom: 0,
              },
              animatedStyle,
            ]}
          />
        )}
      </TouchableOpacity>
    );
  }
);

TabButton.displayName = 'TabButton';

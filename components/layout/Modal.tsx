import React, { useRef, useState, useEffect, ReactNode } from 'react';
import {
  Platform,
  Animated,
  TouchableOpacity,
  FlatList,
  Dimensions,
  LayoutChangeEvent,
  ListRenderItem,
  ViewStyle,
  StyleProp,
} from 'react-native';
import Constants from 'expo-constants';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';

import { greys } from 'helper/colors';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';
import { CloseIcon, CloseIcon2 } from 'assets/icons';
import { useNavigation } from 'expo-router';
import opacity from 'hex-color-opacity';
import { memoizedGetTheme } from 'helper/redux/settings';

import { registerAllSheets } from 'components/layout/sheets/registerSheets';

registerAllSheets({});

const headerHeight = Constants.statusBarHeight ?? 0;

interface ModalProps {
  transparent?: boolean;
  title?: string | ReactNode;
  children: ReactNode;
  buttons?: ReactNode;
  childrenStyles?: StyleProp<ViewStyle>;
  showBack?: boolean;
  showClose?: boolean;
  inverted?: boolean;
  showHeader?: boolean;
  padding?: number;
  backgroundColor?: string;
  [key: string]: any; // For any additional props
}

export default function Modal({
  transparent = false,
  title = 'Add title',
  children,
  buttons,
  childrenStyles,
  showBack = false,
  showClose = false,
  inverted = false,
  showHeader = true,
  padding = 40,
  backgroundColor,
  scrollEnabled = true,
}: ModalProps) {
  const navigation = useNavigation();
  const theme = useSelector(memoizedGetTheme);

  const scrollY = useRef(new Animated.Value(0)).current;
  const [blurIntensity, setBlurIntensity] = useState<number>(0);
  const [buttonHeight, setButtonHeight] = useState<number>(0);

  const titleOffset = showClose || showBack || typeof title !== 'string' ? 0 : 64;
  const bgColor = transparent ? 'transparent' : (backgroundColor ?? greys(theme)[950]);

  useEffect(() => {
    const listener = scrollY.addListener(({ value }) => {
      let intensity = 0;
      if (value > 0 && value <= 24) {
        intensity = (value / 24) * 50;
      } else if (value > 24) {
        intensity = Math.min(50, 50 + (value - 24) * 0.5);
      }
      setBlurIntensity(intensity);
    });

    return () => scrollY.removeListener(listener);
  }, [scrollY]);

  const handleButtonLayout = (event: LayoutChangeEvent): void => {
    setButtonHeight(event.nativeEvent.layout.height);
  };

  const handleBackPress = (): void => {
    navigation.goBack();
  };

  const renderHeaderButton = () => {
    if (showBack) {
      return (
        <TouchableOpacity onPress={handleBackPress} className="p-3">
          <CloseIcon2 width={24} height={24} color={greys(theme)[0]} />
        </TouchableOpacity>
      );
    } else if (showClose) {
      return (
        <TouchableOpacity onPress={handleBackPress} className="p-3">
          <CloseIcon width={24} height={24} color={greys(theme)[0]} />
        </TouchableOpacity>
      );
    }
    return <View className="w-12 bg-transparent" />;
  };

  const renderHeader = () => {
    if (!showHeader) return null;
    if (typeof title !== 'string') return title as React.ReactElement | null;

    const intensity =
      Platform.OS === 'ios'
        ? inverted
          ? 50
          : blurIntensity
        : (inverted ? 50 : blurIntensity) / 10;

    return (
      <BlurView
        tint="prominent"
        intensity={intensity}
        experimentalBlurMethod="dimezisBlurView"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1,
          minHeight: headerHeight,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: opacity(greys(theme)[950], 0.9),
        }}>
        <View className="w-full flex-row items-center justify-between bg-transparent">
          {renderHeaderButton()}
          <Text
            style={{
              fontFamily: 'OverpassHeavy',
              fontSize: 18,
              color: greys(theme)[0],
              width: 'auto',
            }}>
            {title}
          </Text>
          <View className="w-12 bg-transparent" />
        </View>
      </BlurView>
    );
  };

  const renderItem: ListRenderItem<number> = () =>
    React.isValidElement(children) ? children : <View>{children}</View>;

  return (
    <View
      style={[
        {
          position: 'relative',
          display: 'flex',
          flex: 1,
          backgroundColor: bgColor,
        },
        childrenStyles,
      ]}>
      {renderHeader()}

      <FlatList
        inverted={inverted}
        data={[0]}
        style={{
          height: '100%',
          flex: 1,
          backgroundColor: bgColor,
          marginTop: Platform.OS === 'web' ? 48 : showHeader ? headerHeight : 0,
          paddingTop: showBack || showClose ? 16 : 0,
        }}
        contentContainerStyle={{ paddingBottom: buttonHeight + 42 }}
        scrollEventThrottle={100}
        renderItem={renderItem}
        scrollEnabled={scrollEnabled}
      />

      <View
        style={[
          {
            width: '100%',
            backgroundColor: 'transparent',
            paddingBottom: padding,
          },
          // Position needs specific settings for keyboard avoiding view in message contact page
          typeof title !== 'string'
            ? {}
            : {
                position: 'absolute',
                top: Dimensions.get('window').height - buttonHeight - titleOffset,
              },
        ]}
        onLayout={handleButtonLayout}>
        {buttons}
      </View>
    </View>
  );
}

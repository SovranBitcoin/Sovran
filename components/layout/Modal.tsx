import {
  Platform,
  StyleSheet,
  Animated,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from 'react-native';
import Constants from 'expo-constants';
import { useRef, useState, useEffect } from 'react';
import { Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';
import { CloseIcon, CloseIcon2 } from 'assets/icons';
import { useNavigation } from 'expo-router';
import opacity from 'hex-color-opacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { SheetProvider } from 'react-native-actions-sheet';
import React from 'react';

const headerHeight = Constants.statusBarHeight;

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
  ...props
}) {
  const navigation = useNavigation();
  const theme = useSelector(memoizedGetTheme);

  const scrollY = useRef(new Animated.Value(0)).current;
  const [blurIntensity, setBlurIntensity] = useState(0);
  const [buttonHeight, setButtonHeight] = useState(0);

  const titleOffset = showClose || showBack || typeof title !== 'string' ? 0 : 64;
  const styles = createStyles(theme, buttonHeight, titleOffset, padding);
  const bgColor = transparent ? 'transparent' : backgroundColor || greys(theme)[2300];

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

  const renderHeader = () => {
    if (!showHeader) return null;

    if (typeof title !== 'string') return title;

    return (
      <BlurView
        tint="prominent"
        intensity={
          Platform.OS === 'ios'
            ? inverted
              ? 50
              : blurIntensity
            : (inverted ? 50 : blurIntensity) / 10
        }
        experimentalBlurMethod="dimezisBlurView"
        style={styles.blurView}>
        <View style={styles.headerContainer}>
          {renderHeaderButton()}
          <Text style={styles.title}>{title}</Text>
          <View style={styles.emptyView} />
        </View>
      </BlurView>
    );
  };

  const renderHeaderButton = () => {
    if (showBack) {
      return (
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <CloseIcon2 width={24} height={24} color={greys(theme)[0]} />
        </TouchableOpacity>
      );
    } else if (showClose) {
      return (
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <CloseIcon width={24} height={24} color={greys(theme)[0]} />
        </TouchableOpacity>
      );
    }
    return <View style={styles.emptyView} />;
  };

  return (
    <SheetProvider context="global">
      <View style={[styles.container, { backgroundColor: bgColor }, childrenStyles]}>
        {renderHeader()}

        <FlatList
          inverted={inverted}
          data={[0]}
          style={[
            styles.scrollView,
            { backgroundColor: bgColor },
            {
              marginTop: Platform.OS === 'web' ? 48 : showHeader ? headerHeight : 0,
              paddingTop: showBack || showClose ? 16 : 0,
            },
          ]}
          contentContainerStyle={{ paddingBottom: buttonHeight + 42 }}
          scrollEventThrottle={100}
          renderItem={() => children}
        />

        <View
          style={[
            styles.buttonContainer,
            // kinds need to do this so that keyboard avoiding view works in the message contact page.
            {
              ...(typeof title !== 'string'
                ? {}
                : {
                    position: 'absolute',
                    top: Dimensions.get('window').height - buttonHeight - titleOffset,
                  }),
            },
          ]}
          onLayout={(event) => setButtonHeight(event.nativeEvent.layout.height)}>
          {buttons}
        </View>
      </View>
    </SheetProvider>
  );
}

const createStyles = (theme, height, tabHeight, padding = 64) =>
  StyleSheet.create({
    container: {
      position: 'relative',
      display: 'flex',
      flex: 1,
    },
    blurView: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 1,
      minHeight: headerHeight,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: opacity(greys(theme)[2300], 0.9),
    },
    headerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      backgroundColor: 'transparent',
    },
    backButton: {
      padding: 12,
    },
    title: {
      fontFamily: 'OverpassHeavy',
      fontSize: 18,
      color: greys(theme)[0],
      width: 'auto',
    },
    scrollView: {
      height: '100%',
      flex: 1,
    },
    buttonContainer: {
      width: '100%',
      backgroundColor: 'transparent',
      paddingBottom: padding,
    },
    emptyView: {
      padding: 0,
      width: 48,
      backgroundColor: 'transparent',
    },
  });

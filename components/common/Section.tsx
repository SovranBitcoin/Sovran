import React, { useMemo } from 'react';
import { StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { StyledText, Text, View } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { BlurView } from 'expo-blur';

import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';

interface ItemTitle {
  id?: string;
  children?: string;
}

interface SectionItem {
  title: ItemTitle | string;
  value: string;
  direction?: 'row' | 'column';
  align?: 'left' | 'right';
}

interface SectionProps {
  items: SectionItem[];
  style?: ViewStyle;
  camera?: boolean;
  special?: boolean;
}

export function Section({
  items,
  style,
  camera = false,
  special = true,
}: SectionProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();

  const ContainerView = camera ? BlurView : View;

  // Memoize background color calculation
  const backgroundColor = useMemo(
    () => (camera ? opacity(greys(theme)[1800], 0.75) : greys(theme)[1800]),
    [camera, theme]
  );

  return (
    <ContainerView
      className="m-4 overflow-hidden rounded-lg"
      style={{
        backgroundColor: 'transparent',
        ...style,
      }}>
      <View
        style={{
          borderRadius: 8,
          flexDirection: 'column',
          backgroundColor,
          padding: 8,
        }}>
        {items.map((item, index) => {
          // Extract title information safely
          const titleObj = typeof item.title === 'object' ? item.title : null;
          const titleId = titleObj?.id;
          const titleText =
            typeof item.title === 'string' ? item.title : (titleObj?.children ?? '');

          return (
            <View
              key={index}
              className="flex flex-row justify-between bg-transparent p-2"
              style={{
                flexDirection: item.direction || 'row',
              }}>
              <Text
                id={titleId}
                weight="bold"
                size={16}
                style={{
                  color: greys(theme)[600],
                  marginRight: titleText === '' ? 0 : 8,
                }}>
                {titleText}
              </Text>

              {renderValueContent(item, titleText, theme)}
            </View>
          );
        })}
      </View>
    </ContainerView>
  );

  // Helper function to render the appropriate value content based on the item type
  function renderValueContent(item: SectionItem, titleText: string, theme: any): JSX.Element {
    // Email address format (@example)
    if (item.value?.includes?.('@')) {
      const [username, domain] = item.value.split('@');
      return (
        <View
          className="flex flex-1 flex-col items-center justify-center bg-transparent"
          style={{
            marginRight: titleText === '' ? 0 : 8,
          }}>
          <Text
            weight="mono"
            size={11}
            style={{
              color: greys(theme)[100],
              textAlign: 'center',
            }}>
            {username}
          </Text>
          <TouchableOpacity
            onPress={() => {
              // navigation.navigate("settings/customNpub");
            }}
            className="flex-row items-center">
            <StyledText
              primary
              style={{
                color: shades[100],
                fontFamily: 'OverpassHeavy',
                fontSize: 24,
                textAlign: 'center',
                textShadowColor: 'rgba(0, 0, 0, 0.75)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 8,
                padding: 4,
              }}>
              @{domain}
            </StyledText>
          </TouchableOpacity>
        </View>
      );
    }

    // Handle npub format
    if (item.value?.startsWith?.('npub')) {
      return renderPrefixedValue('npub', item.value.split('npub')[1], titleText, theme);
    }

    // Handle creqA format
    if (item.value?.startsWith?.('creqA')) {
      return renderPrefixedValue('creqA', item.value.split('creqA')[1], titleText, theme);
    }

    // Handle lnbc1 format
    if (item.value?.startsWith?.('lnbc1') && special) {
      return renderPrefixedValue('lnbc1', item.value.split('lnbc1')[1], titleText, theme);
    }

    // Handle cashu format
    if ((item.value?.startsWith?.('cashuB') || item.value?.startsWith?.('cashuA')) && special) {
      const prefix = item.value.startsWith('cashuA') ? 'cashuA' : 'cashuB';
      const value = item.value.split(prefix)[1];
      return renderPrefixedValue(prefix, value, titleText, theme);
    }

    // Handle bitcoin lightning+cashu format
    if (item.value?.startsWith?.('bitcoin:?lightning=') && item.value.includes('&cashu=')) {
      return (
        <View
          className="flex flex-1 flex-col items-center justify-center bg-transparent"
          style={{
            marginRight: titleText === '' ? 0 : 8,
          }}>
          <Text
            weight="bold"
            size={12}
            style={{
              color: greys(theme)[100],
              textAlign: 'left',
              fontFamily: 'OverpassMono',
              wordBreak: 'break-all',
            }}>
            {item.value}
          </Text>
        </View>
      );
    }

    // Default case - regular text
    return (
      <View className="bg-transparent">
        <Text
          weight={titleText === '' ? 'mono' : 'regular'}
          size={titleText === '' ? 12 : 16}
          style={{
            color: greys(theme)[0],
            textAlign: titleText === '' ? 'left' : item.align === 'left' ? 'left' : 'right',
            flex: 1,
          }}>
          {item.value}
        </Text>
      </View>
    );
  }

  // Helper function to render prefixed values (npub, creqA, etc.)
  function renderPrefixedValue(
    prefix: string,
    value: string,
    titleText: string,
    theme: any
  ): JSX.Element {
    return (
      <View
        className="flex flex-1 flex-col items-center justify-center bg-transparent"
        style={{
          marginRight: titleText === '' ? 0 : 8,
        }}>
        <Text
          weight="heavy"
          size={24}
          style={{
            color: shades[300],
            textAlign: 'center',
          }}>
          {prefix}
        </Text>
        <Text
          weight="bold"
          size={12}
          style={{
            color: greys(theme)[100],
            textAlign: 'center',
            fontFamily: 'OverpassMono',
          }}>
          {value}
        </Text>
      </View>
    );
  }
}

import React from 'react';
import { ViewStyle } from 'react-native';
import { Log } from '@/shared/lib/logger';
import { StyledText, Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { BlurView } from 'expo-blur';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { truncateMiddle } from '@/shared/lib/strings';

interface ItemTitle {
  id?: string;
  children?: string;
}

interface SectionItem {
  title: ItemTitle | string;
  value: React.ReactNode;
  direction?: 'row' | 'column';
  align?: 'left' | 'right';
}

interface SectionProps {
  items: SectionItem[];
  style?: ViewStyle;
  camera?: boolean;
  special?: boolean;
}

export function Section({ items, style, camera = false, special }: SectionProps) {
  const [foreground, shade300] = useThemeColor(['foreground', 'shade-300'] as const);

  const ContainerView = camera ? BlurView : View;

  return (
    <Log name="Section">
      <ContainerView
        className="overflow-hidden rounded-lg"
        style={{
          marginHorizontal: 16,
          ...style,
        }}>
        <VStack
          // blur
          className={`bg-surface-secondary${camera ? '/75' : ''}`}
          style={{
            borderRadius: 8,
            padding: 8,
          }}>
          {items.map((item, index) => {
            // Extract title information safely
            const titleObj = typeof item.title === 'object' ? item.title : null;
            const titleId = titleObj?.id;
            const titleText =
              typeof item.title === 'string' ? item.title : (titleObj?.children ?? '');

            return (
              <HStack key={index} justify="space-between" className="p-2">
                <Text id={titleId} heavy size={16} color={opacity(foreground, 0.9)}>
                  {titleText}
                </Text>
                {titleText !== '' && <Spacer size={8} />}

                {renderValueContent(item, titleText, special)}
              </HStack>
            );
          })}
        </VStack>
      </ContainerView>
    </Log>
  );

  // Helper function to render the appropriate value content based on the item type
  function renderValueContent(item: SectionItem, titleText: string, special?: boolean) {
    if (React.isValidElement(item.value)) {
      return (
        <HStack
          align="center"
          style={{
            flex: 1,
            justifyContent: item.align === 'left' ? 'flex-start' : 'flex-end',
          }}>
          {item.value}
          {titleText !== '' && <Spacer size={8} />}
        </HStack>
      );
    }

    // Email address format (@example)
    if (typeof item.value === 'string' && item.value?.includes?.('@') && special) {
      const [username, domain] = item.value.split('@');
      return (
        <VStack align="center" className="flex-1" justify="center">
          <Text
            size={18}
            color={opacity(foreground, 0.9)}
            style={{
              textAlign: 'center',
            }}>
            {truncateMiddle(username, 8)}
          </Text>
          <TouchableOpacity className="flex-row items-center">
            <StyledText
              primary
              size={24}
              heavy
              className="text-shade-200"
              style={{
                textAlign: 'center',
                textShadowColor: 'rgba(0, 0, 0, 0.75)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 8,
                padding: 4,
              }}>
              @{domain}
            </StyledText>
          </TouchableOpacity>
          {titleText !== '' && <Spacer size={8} />}
        </VStack>
      );
    }

    // Handle npub format
    if (typeof item.value === 'string' && item.value?.startsWith?.('npub') && special) {
      return renderPrefixedValue('npub', item.value.split('npub')[1], titleText);
    }

    // Handle creqA format
    if (typeof item.value === 'string' && item.value?.startsWith?.('creqA')) {
      return renderPrefixedValue('creqA', item.value.split('creqA')[1], titleText);
    }

    // Handle lnbc1 format
    if (typeof item.value === 'string' && item.value?.startsWith?.('lnbc1') && special) {
      return renderPrefixedValue('lnbc1', item.value.split('lnbc1')[1], titleText);
    }

    // Handle cashu format
    if (
      typeof item.value === 'string' &&
      (item.value?.startsWith?.('cashuB') || item.value?.startsWith?.('cashuA')) &&
      special
    ) {
      const prefix = item.value.startsWith('cashuA') ? 'cashuA' : 'cashuB';
      const value = item.value.split(prefix)[1];
      return renderPrefixedValue(prefix, value, titleText);
    }

    // Handle bitcoin lightning+cashu format
    if (
      typeof item.value === 'string' &&
      item.value?.startsWith?.('bitcoin:?lightning=') &&
      item.value.includes('&cashu=')
    ) {
      return (
        <VStack align="center" className="flex-1" justify="center">
          <Text
            bold
            size={12}
            color={opacity(foreground, 0.9)}
            style={{
              textAlign: 'left',
              wordBreak: 'break-all',
            }}>
            {item.value}
          </Text>
          {titleText !== '' && <Spacer size={8} />}
        </VStack>
      );
    }

    // Default case - regular text
    return (
      <View>
        <Text
          weight={titleText === '' ? 'regular' : 'bold'}
          size={titleText === '' ? 12 : 16}
          color={foreground}
          style={{
            textAlign: titleText === '' ? 'left' : item.align === 'left' ? 'left' : 'right',
            flex: 1,
          }}>
          {String(item.value)}
        </Text>
      </View>
    );
  }

  // Helper function to render prefixed values (npub, creqA, etc.)
  function renderPrefixedValue(prefix: string, value: string, titleText: string) {
    return (
      <VStack align="center" className="flex-1" justify="center">
        <Text
          heavy
          size={24}
          color={shade300}
          style={{
            textAlign: 'center',
          }}>
          {prefix}
        </Text>
        <Text
          bold
          size={12}
          color={opacity(foreground, 0.9)}
          style={{
            textAlign: 'center',
          }}>
          {value}
        </Text>
        {titleText !== '' && <Spacer size={8} />}
      </VStack>
    );
  }
}

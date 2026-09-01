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
import { withAlpha } from '@/shared/lib/color';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { truncateMiddle } from '@/shared/lib/strings';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { formatDisplayValue } from '@/shared/lib/format/displayValue';

interface ItemTitle {
  id?: string;
  children?: string;
}

interface DetailsListItem {
  title: ItemTitle | string;
  value: React.ReactNode;
  direction?: 'row' | 'column';
  align?: 'left' | 'right';
}

interface DetailsListProps {
  items: DetailsListItem[];
  style?: ViewStyle;
  camera?: boolean;
  special?: boolean;
  /** Render with the wallet's signature corner-gradient frame. */
  gradient?: boolean;
}

export function DetailsList({ items, style, camera = false, special, gradient }: DetailsListProps) {
  const [foreground, shade300] = useThemeColor(['foreground', 'shade-300'] as const);

  const ContainerView = camera ? BlurView : View;

  const rows = items.map((item, index) => {
    const titleObj = typeof item.title === 'object' ? item.title : null;
    const titleId = titleObj?.id;
    const titleText = typeof item.title === 'string' ? item.title : (titleObj?.children ?? '');
    const rowKey = titleId ?? titleText ?? `row-${index}`;

    return (
      <HStack key={rowKey} justify="space-between" className="p-2">
        <Text id={titleId} heavy size={16} color={withAlpha(foreground, 0.9)}>
          {titleText}
        </Text>
        {titleText !== '' && <Spacer size={8} />}

        {renderValueContent(item, titleText, special, { foreground, shade300 })}
      </HStack>
    );
  });

  if (gradient) {
    return (
      <Log name="DetailsList">
        <GradientCard style={{ marginHorizontal: 16, ...style }} contentStyle={{ padding: 8 }}>
          {rows}
        </GradientCard>
      </Log>
    );
  }

  return (
    <Log name="DetailsList">
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
          {rows}
        </VStack>
      </ContainerView>
    </Log>
  );
}

/**
 * Row-value renderers. They depend only on their arguments and the two theme
 * colours, so they live at module scope: declared inside the component (after
 * its `return`, no less) they were hoisted declarations in unreachable code,
 * which React Compiler cannot lower — costing the whole list its memoization.
 */
type DetailsListColors = { foreground: string; shade300: string };

function renderValueContent(
  item: DetailsListItem,
  titleText: string,
  special: boolean | undefined,
  colors: DetailsListColors
) {
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

  const layout = formatDisplayValue(item.value, special === true);

  switch (layout.kind) {
    case 'email':
      return (
        <VStack align="center" className="flex-1" justify="center">
          <Text size={18} color={withAlpha(colors.foreground, 0.9)} style={{ textAlign: 'center' }}>
            {truncateMiddle(layout.username, 8)}
          </Text>
          <Pressable className="flex-row items-center">
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
              @{layout.domain}
            </StyledText>
          </Pressable>
          {titleText !== '' && <Spacer size={8} />}
        </VStack>
      );

    case 'prefix-split':
      return renderPrefixedValue(layout.prefix, layout.body, titleText, colors);

    case 'bitcoin-uri':
      return (
        <VStack align="center" className="flex-1" justify="center">
          <Text
            bold
            size={12}
            color={withAlpha(colors.foreground, 0.9)}
            style={{
              textAlign: 'left',
              wordBreak: 'break-all',
            }}>
            {layout.value}
          </Text>
          {titleText !== '' && <Spacer size={8} />}
        </VStack>
      );

    case 'plain':
    default:
      return (
        <View>
          <Text
            weight={titleText === '' ? 'regular' : 'bold'}
            size={titleText === '' ? 12 : 16}
            color={colors.foreground}
            style={{
              textAlign: titleText === '' ? 'left' : item.align === 'left' ? 'left' : 'right',
              flex: 1,
            }}>
            {layout.value}
          </Text>
        </View>
      );
  }
}

// Helper function to render prefixed values (npub, creqA, etc.)
function renderPrefixedValue(
  prefix: string,
  value: string,
  titleText: string,
  colors: DetailsListColors
) {
  return (
    <VStack align="center" className="flex-1" justify="center">
      <Text
        heavy
        size={24}
        color={colors.shade300}
        style={{
          textAlign: 'center',
        }}>
        {prefix}
      </Text>
      <Text
        bold
        size={12}
        color={withAlpha(colors.foreground, 0.9)}
        style={{
          textAlign: 'center',
        }}>
        {value}
      </Text>
      {titleText !== '' && <Spacer size={8} />}
    </VStack>
  );
}

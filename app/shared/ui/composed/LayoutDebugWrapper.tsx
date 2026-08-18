import React, { ReactNode } from 'react';
import {
  Platform,
  RefreshControlProps,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';

import { AnimatedBackgroundView } from '@/shared/ui/composed/BackgroundView';
import { Log } from '@/shared/lib/logger';

interface LayoutDebugWrapperProps {
  children: ReactNode;
  /**
   * When true, wraps children in a ScrollView with automatic content inset adjustment.
   * Set to false for screens with PagerView or custom scroll handling.
   * @default true
   */
  scrollable?: boolean;
  /**
   * Custom content container style for the ScrollView (only used when scrollable=true)
   * @default { padding: 16 }
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Callback when content size changes (useful for ScrollableGradientOverlay)
   * Only called when scrollable=true
   */
  onContentSizeChange?: (width: number, height: number) => void;
  /**
   * Optional RefreshControl for pull-to-refresh (only used when scrollable=true)
   */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onScrollBeginDrag?: ScrollViewProps['onScrollBeginDrag'];
  onScrollEndDrag?: ScrollViewProps['onScrollEndDrag'];
}

export function LayoutDebugWrapper({
  children,
  scrollable = true,
  contentContainerStyle = { padding: 16 },
  onContentSizeChange,
  refreshControl,
  onScrollBeginDrag,
  onScrollEndDrag,
}: LayoutDebugWrapperProps) {
  const headerHeight = useHeaderHeight();

  const flattenedContentStyle = StyleSheet.flatten(contentContainerStyle) ?? {};
  const baseTopPadding =
    typeof flattenedContentStyle.paddingTop === 'number'
      ? flattenedContentStyle.paddingTop
      : typeof flattenedContentStyle.paddingVertical === 'number'
        ? flattenedContentStyle.paddingVertical
        : typeof flattenedContentStyle.padding === 'number'
          ? flattenedContentStyle.padding
          : 0;
  const scrollContentStyle =
    Platform.OS === 'android' && headerHeight > 0
      ? [contentContainerStyle, { paddingTop: baseTopPadding + headerHeight }]
      : contentContainerStyle;

  if (!scrollable) {
    return (
      <Log name="LayoutDebugWrapper">
        <AnimatedBackgroundView>
          <View className="flex-1">{children}</View>
        </AnimatedBackgroundView>
      </Log>
    );
  }

  return (
    <Log name="LayoutDebugWrapper">
      <AnimatedBackgroundView>
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onContentSizeChange={onContentSizeChange}
          contentContainerStyle={scrollContentStyle}
          refreshControl={refreshControl}>
          {children}
        </ScrollView>
      </AnimatedBackgroundView>
    </Log>
  );
}

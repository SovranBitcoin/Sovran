/**
 * @fileoverview Shared Modal Screen Layout component
 *
 * This module provides a consistent layout wrapper for modal screens.
 * It handles safe area insets, ScrollView padding, and BottomButtons positioning.
 */

import React, { ReactNode } from 'react';
import { ScrollView, StyleProp, ViewStyle } from 'react-native';
import { View } from 'components/ui/View';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ModalScreenLayoutProps {
  children: ReactNode;
  /** Content to render in the bottom buttons area */
  bottomButtons?: ReactNode;
  /** Additional padding at bottom for BottomButtons. Default: 120 */
  bottomPadding?: number;
  /** Additional styles for the container */
  style?: StyleProp<ViewStyle>;
  /** Whether to use ScrollView. Default: true */
  scrollable?: boolean;
  /** Extra top padding in addition to safe area. Default: 48 */
  headerHeight?: number;
}

export function ModalScreenLayout({
  children,
  bottomButtons,
  bottomPadding = 120,
  style,
  scrollable = true,
  headerHeight = 48,
}: ModalScreenLayoutProps) {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  const content = scrollable ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + headerHeight,
        paddingBottom: bottomPadding,
      }}>
      {children}
    </ScrollView>
  ) : (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top + headerHeight,
        paddingBottom: bottomPadding,
      }}>
      {children}
    </View>
  );

  return (
    <View style={[{ flex: 1, backgroundColor: getPrimaryColor('950') }, style]}>
      {content}
      {bottomButtons && <BottomButtons>{bottomButtons}</BottomButtons>}
    </View>
  );
}


/**
 * @fileoverview Shared Modal Screen Layout component
 *
 * This module provides a consistent layout wrapper for modal screens.
 * It handles safe area insets, ScrollView padding, and BottomButtons positioning.
 * Set debug={true} to visualize layout boundaries with colored overlays.
 */

import React, { ReactNode } from 'react';
import { ScrollView, StyleProp, ViewStyle } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface ModalScreenLayoutProps {
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
  /** Enable debug overlays to visualize safe areas and header height */
  debug?: boolean;
}

export function ModalScreenLayout({
  children,
  bottomButtons,
  bottomPadding = 120,
  style,
  scrollable = true,
  headerHeight = 32,
  debug = false,
}: ModalScreenLayoutProps) {
  const background = useThemeColor('background');
  const insets = useSafeAreaInsets();
  const navHeaderHeight = useHeaderHeight();

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
    <View style={[{ flex: 1, backgroundColor: background }, style]}>
      {/* Debug: Container outline */}
      {debug && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderColor: 'blue',
          }}
        />
      )}

      {/* Debug: Header height indicator (red) */}
      {debug && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: navHeaderHeight,
            backgroundColor: 'rgba(255,0,0,0.2)',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 4,
            zIndex: 100,
          }}>
          <Text style={{ color: 'red', fontSize: 10, fontWeight: 'bold' }}>
            header: {navHeaderHeight}px
          </Text>
        </View>
      )}

      {/* Debug: Bottom safe area indicator (cyan) */}
      {debug && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: insets.bottom,
            backgroundColor: 'rgba(0,255,255,0.3)',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}>
          <Text style={{ color: 'cyan', fontSize: 9, fontWeight: 'bold' }}>
            safe: {insets.bottom}px
          </Text>
        </View>
      )}

      {/* Debug: Info panel */}
      {debug && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: navHeaderHeight + 8,
            right: 8,
            backgroundColor: 'rgba(0,0,0,0.9)',
            borderRadius: 8,
            padding: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.3)',
            zIndex: 100,
          }}>
          <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold', marginBottom: 8 }}>
            📐 Debug
          </Text>
          <Text style={{ color: 'red', fontSize: 10 }}>header: {navHeaderHeight}px</Text>
          <Text style={{ color: 'orange', fontSize: 10 }}>insets.top: {insets.top}px</Text>
          <Text style={{ color: 'cyan', fontSize: 10 }}>insets.bottom: {insets.bottom}px</Text>
          <Text style={{ color: 'lime', fontSize: 10 }}>headerHeight prop: {headerHeight}px</Text>
          <Text style={{ color: 'yellow', fontSize: 10 }}>bottomPadding: {bottomPadding}px</Text>
        </View>
      )}

      {content}
      {bottomButtons && <BottomButtons>{bottomButtons}</BottomButtons>}
    </View>
  );
}

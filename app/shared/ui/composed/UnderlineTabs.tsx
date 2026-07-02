import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Log, log } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { MORE_BUTTON_WIDTH, partitionTabs } from '@/shared/ui/composed/underlineTabsLayout';
import Icon from 'assets/icons';

interface UnderlineTabsProps {
  tabs: readonly string[];
  selectedTab: string;
  handleTabPress: (tab: string, index: number) => void;
  /** Override the active underline color. Defaults to the theme `accent` token. */
  accentColor?: string;
}

/** Slightly under body size — keeps 4–5 short tabs on-bar on phone widths
 *  before the (…) overflow has to engage. */
const LABEL_SIZE = 15;

/**
 * Flat underline tab bar — each tab is `flex: 1`, the active tab gets a
 * 2 px bottom border in `accent` and a heavier weight; inactive labels use
 * the theme `muted` token. Mirrors the top-tab pattern on `ContactsScreen`
 * so screens that opt for the underline style render byte-identical chrome.
 *
 * When the labels can't all fit at a readable width, the bar keeps the
 * longest fitting prefix and collapses the rest behind a trailing (…) button
 * that opens the canonical action-menu sheet (FWO lane, so it stacks above
 * route modals like the receive hub). The (…) button carries the active
 * underline whenever the selected tab lives in the overflow.
 */
export function UnderlineTabs({
  tabs,
  selectedTab,
  handleTabPress,
  accentColor,
}: UnderlineTabsProps) {
  const [foreground, muted, themeAccent, success] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'success',
  ] as const);
  const underline = accentColor ?? themeAccent;

  const [containerWidth, setContainerWidth] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});

  const onRowLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === width ? prev : width));
  }, []);

  const onLabelLayout = useCallback((tab: string, width: number) => {
    setLabelWidths((prev) => {
      const rounded = Math.ceil(width);
      if (prev[tab] === rounded) return prev;
      return { ...prev, [tab]: rounded };
    });
  }, []);

  const { visible, overflow } = useMemo(
    () => partitionTabs(tabs, labelWidths, containerWidth),
    [tabs, labelWidths, containerWidth]
  );
  const selectedInOverflow = overflow.includes(selectedTab);

  const openOverflowMenu = useCallback(() => {
    log.info('ui.underline_tabs.overflow_menu', {
      overflowCount: overflow.length,
      selectedInOverflow,
    });
    actionMenuSheet({
      title: 'More',
      buttons: overflow.map((tab) => ({
        text: tab,
        testID: `underline-tabs-menu-${tab}`,
        suffix:
          tab === selectedTab ? <Icon name="mdi:check" size={20} color={success} /> : undefined,
        onPress: () => handleTabPress(tab, tabs.indexOf(tab)),
      })),
    });
  }, [overflow, selectedTab, selectedInOverflow, handleTabPress, tabs, success]);

  return (
    <Log name="UnderlineTabs">
      {/* Invisible measurement row: labels at intrinsic width (bold, the
          widest weight a tab can render at) so partitioning never squeezes
          the active tab. Same Text primitive → same font scaling. */}
      <View style={styles.measureRow} pointerEvents="none" aria-hidden>
        {tabs.map((tab) => (
          <Text
            key={tab}
            size={LABEL_SIZE}
            bold
            onLayout={(e) => onLabelLayout(tab, e.nativeEvent.layout.width)}>
            {tab}
          </Text>
        ))}
      </View>
      <View style={styles.row} onLayout={onRowLayout}>
        {visible.map((tab) => {
          const isActive = selectedTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => handleTabPress(tab, tabs.indexOf(tab))}
              style={[
                styles.tab,
                isActive && { borderBottomColor: underline, borderBottomWidth: 2 },
              ]}>
              <Text
                size={LABEL_SIZE}
                bold={isActive}
                numberOfLines={1}
                color={isActive ? foreground : muted}>
                {tab}
              </Text>
            </Pressable>
          );
        })}
        {overflow.length > 0 && (
          <Pressable
            testID="underline-tabs-more"
            accessibilityLabel="More tabs"
            onPress={openOverflowMenu}
            style={[
              styles.moreButton,
              selectedInOverflow && { borderBottomColor: underline, borderBottomWidth: 2 },
            ]}>
            <Icon name="tabler:dots" size={20} color={selectedInOverflow ? foreground : muted} />
          </Pressable>
        )}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  measureRow: {
    position: 'absolute',
    flexDirection: 'row',
    opacity: 0,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  moreButton: {
    width: MORE_BUTTON_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
});

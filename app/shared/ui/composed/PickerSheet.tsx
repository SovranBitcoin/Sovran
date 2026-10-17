/**
 * @fileoverview The picker sheet: choosing one of several things.
 *
 * The `picker` route's page. The same sheet as Select mint on iPhone, a pushed
 * page on Android (ADR 0025, 0026), with the same rows. Whoever opens it calls
 * `openPicker`, which puts the rows in `pickerSheetStore` and hears back what
 * was tapped.
 */

import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  answerPicker,
  pickerRouteMounted,
  pickerRouteUnmounted,
} from '@/shared/lib/picker/openPicker';
import type { PickerOption, PickerResult, PickerSection } from '@/shared/lib/picker/types';
import { usePickerSheetStore } from '@/shared/stores/runtime/pickerSheetStore';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { PillTabs, PILL_TABS_HEIGHT } from '@/shared/ui/composed/PillTabs';
import { Screen, useScreenOptions } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const EMPTY_SECTIONS: readonly PickerSection[] = [];

function PickerRow({
  option,
  onPick,
}: {
  option: PickerOption;
  onPick: (result: PickerResult) => void;
}) {
  const [foreground, danger] = useThemeColor(['foreground', 'danger'] as const);
  const leading = option.leading;
  const trailing =
    option.trailing != null || option.selected ? (
      <View className="flex-row items-center gap-1.5">
        {option.trailing}
        {option.selected ? <Icon name="mdi:check-circle" size={18} color={foreground} /> : null}
      </View>
    ) : undefined;
  return (
    <ListRow
      avatar={leading && 'avatar' in leading ? leading.avatar : undefined}
      icon={leading && 'icon' in leading ? leading.icon : undefined}
      leading={leading && 'node' in leading ? leading.node : undefined}
      title={
        option.isCaution ? (
          <Text size={16} bold numberOfLines={1} color={danger}>
            {option.title}
          </Text>
        ) : (
          option.title
        )
      }
      // A disabled choice stays in the list and says why.
      subtitle={option.disabled && option.reason ? option.reason : option.description}
      wrapSubtitle
      trailing={trailing}
      selected={option.selected === true}
      disabled={option.disabled}
      onPress={() => onPick({ kind: 'option', id: option.id })}
      testID={option.testID}
      accessibilityLabel={option.title}
    />
  );
}

export function PickerSheetScreen() {
  const request = usePickerSheetStore((state) => state.request);
  const navigation = useNavigation();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [chosenTab, setChosenTab] = useState<string | null>(null);

  useScreenOptions(() => ({ headerTitle: request?.title ?? '' }), [request?.title]);

  // Leaving by any road (a tap, a pull, the close or back button) ends the
  // picker; `openPicker` answers whoever is still waiting.
  useEffect(() => {
    pickerRouteMounted();
    return pickerRouteUnmounted;
  }, []);

  // Go back from this screen itself, so the tap can only ever close the sheet.
  const pick = (result: PickerResult) => {
    if (answerPicker(result)) navigation.goBack();
  };

  // Only tabs that have rows; a single one needs no tab bar. The first tab is
  // the one holding the current choice, until the person picks another.
  const sections = (request?.sections ?? EMPTY_SECTIONS).filter(
    (section) => section.options.length > 0
  );
  const tabbed = sections.length > 1;
  const initialTab =
    sections.find((section) => section.options.some((option) => option.selected)) ?? sections[0];
  const activeTab = sections.find((section) => section.id === chosenTab) ?? initialTab;
  const options = request?.sections
    ? tabbed
      ? (activeTab?.options ?? [])
      : sections.flatMap((section) => section.options)
    : (request?.options ?? []);

  const tabs = tabbed ? (
    <PillTabs
      tabs={sections.map((section) => section.id)}
      activeTab={activeTab?.id ?? ''}
      onTabChange={setChosenTab}
      labelFor={(id) => sections.find((section) => section.id === id)?.title ?? id}
      iconFor={(id) => sections.find((section) => section.id === id)?.icon}
      accessibilityRole="tab"
      testIDFor={(id) =>
        sections.find((section) => section.id === id)?.testID ?? `picker-tab-${id}`
      }
    />
  ) : undefined;

  const actions = request?.actions ?? [];
  const footer =
    actions.length > 0 ? (
      <BottomButtons>
        <ButtonHandler
          buttons={actions.map((action) => ({
            text: action.title,
            icon: action.icon,
            variant: action.variant ?? 'secondary',
            testID: action.testID,
            onPress: () => pick({ kind: 'action', id: action.id }),
          }))}
        />
      </BottomButtons>
    ) : undefined;

  const headerSpacer = { height: headerHeight };

  return (
    <Screen
      name="PickerSheetScreen"
      headerAppearance={tabbed ? 'gradient-tabs' : 'gradient'}
      stickyContent={tabs}
      stickyContentHeight={tabbed ? PILL_TABS_HEIGHT : undefined}
      scroll="custom"
      onHeaderHeightChange={setHeaderHeight}
      footer={footer}>
      <ScreenScrollView testID="picker-sheet" className="flex-1">
        <View style={headerSpacer} />
        <View testID={request?.testID}>
          {options.map((option) => (
            <PickerRow key={option.id} option={option} onPick={pick} />
          ))}
        </View>
      </ScreenScrollView>
    </Screen>
  );
}

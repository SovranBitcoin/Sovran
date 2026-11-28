import { useState } from 'react';

import {
  UI_KIT_FILTERS,
  UI_KIT_FILTER_LABELS,
  uiKitScenariosFor,
  type UiKitFilter,
} from '@/features/settings/design-system/uiKit';
import { PillTabs, PILL_TABS_HEIGHT } from '@/shared/ui/composed/PillTabs';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { HapticsOff } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const labelFor = (filter: UiKitFilter) => UI_KIT_FILTER_LABELS[filter];
const testIDFor = (filter: UiKitFilter) => `design-system-ui-kit-filter-${filter}`;

export function SettingsDesignSystemUiKitScreen() {
  const [filter, setFilter] = useState<UiKitFilter>('all');
  const scenarios = uiKitScenariosFor(filter);

  return (
    <ScreenWrapper
      name="SettingsDesignSystemUiKitScreen"
      // The filter bar stays pinned under the header, so a state is one tap
      // away however far down the list is scrolled.
      headerAppearance="opaque"
      stickyContentHeight={PILL_TABS_HEIGHT}
      stickyContent={
        <View className="border-separator border-b">
          <PillTabs
            tabs={UI_KIT_FILTERS}
            activeTab={filter}
            onTabChange={setFilter}
            labelFor={labelFor}
            testIDFor={testIDFor}
          />
        </View>
      }>
      <Text size={12} className="text-foreground/60 mb-2 mt-2">
        Every core component held in each of its states on made-up data. Nothing here reads a
        balance, a mint or the network, so a state looks the same every time.
      </Text>
      <Text
        size={12}
        className="text-foreground/60 mb-2"
        testID="design-system-ui-kit-count">{`${scenarios.length} ${scenarios.length === 1 ? 'state' : 'states'}`}</Text>
      {scenarios.map((scenario) => (
        <Section key={scenario.id} title={scenario.title}>
          <View testID={`design-system-scenario-ui-kit-${scenario.id}`}><HapticsOff>{scenario.render()}</HapticsOff></View>
        </Section>
      ))}
    </ScreenWrapper>
  );
}

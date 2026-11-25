import { useState } from 'react';

import {
  UI_KIT_FILTERS,
  UI_KIT_FILTER_LABELS,
  uiKitScenariosFor,
  type UiKitFilter,
} from '@/features/settings/design-system/uiKit';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const labelFor = (filter: UiKitFilter) => UI_KIT_FILTER_LABELS[filter];
const testIDFor = (filter: UiKitFilter) => `design-system-ui-kit-filter-${filter}`;

export function SettingsDesignSystemUiKitScreen() {
  const [filter, setFilter] = useState<UiKitFilter>('all');
  const scenarios = uiKitScenariosFor(filter);

  return (
    <ScreenWrapper name="SettingsDesignSystemUiKitScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView className="px-4" bottomSpacing={32}>
        <Text size={12} className="text-foreground/60 mb-2 mt-2">
          Every core component held in each of its states on made-up data. Nothing here reads a
          balance, a mint or the network, so a state looks the same every time.
        </Text>
        <View className="-mx-4 mb-2">
          <PillTabs
            tabs={UI_KIT_FILTERS}
            activeTab={filter}
            onTabChange={setFilter}
            labelFor={labelFor}
            testIDFor={testIDFor}
          />
        </View>
        <Text
          size={12}
          className="text-foreground/60 mb-2"
          testID="design-system-ui-kit-count">{`${scenarios.length} ${scenarios.length === 1 ? 'state' : 'states'}`}</Text>
        {scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-ui-kit-${scenario.id}`}>{scenario.render()}</View>
          </Section>
        ))}
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

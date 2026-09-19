import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const EMPTY_STATES_FAMILY = getDesignSystemFamily('empty-states');

export function SettingsDesignSystemEmptyStatesScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemEmptyStatesScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView className="px-4" bottomSpacing={32}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Every empty surface in the app rendered through the shared `EmptyState` component.
        </Text>
        {EMPTY_STATES_FAMILY.scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-empty-states-${scenario.id}`}>
              {scenario.render()}
            </View>
          </Section>
        ))}
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

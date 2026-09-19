import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const FOUNDATIONS_FAMILY = getDesignSystemFamily('foundations');

export function SettingsDesignSystemFoundationsScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemFoundationsScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView className="px-4" bottomSpacing={32}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Deterministic states for the shared primitives that shape Sovran. Each section is also an
          exact structural snapshot and a stable future device-screenshot target.
        </Text>
        {FOUNDATIONS_FAMILY.scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-foundations-${scenario.id}`}>
              {scenario.render()}
            </View>
          </Section>
        ))}
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

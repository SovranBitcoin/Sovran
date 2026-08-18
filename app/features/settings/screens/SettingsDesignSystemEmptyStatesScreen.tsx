import { ScrollView } from 'react-native';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const EMPTY_STATES_FAMILY = getDesignSystemFamily('empty-states');
const CONTENT_CONTAINER_STYLE = { paddingBottom: 32 };

export function SettingsDesignSystemEmptyStatesScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemEmptyStatesScreen" scroll="custom" safeArea>
      <ScrollView className="px-4" contentContainerStyle={CONTENT_CONTAINER_STYLE}>
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
      </ScrollView>
    </ScreenWrapper>
  );
}

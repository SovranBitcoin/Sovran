import { ScrollView } from 'react-native';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const FAKE_POSTS_FAMILY = getDesignSystemFamily('fake-posts');
const CONTENT_CONTAINER_STYLE = { paddingBottom: 32 };

export function SettingsDesignSystemPostsScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemPostsScreen" scroll="custom" safeArea>
      <ScrollView className="px-4" contentContainerStyle={CONTENT_CONTAINER_STYLE}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Fixture posts rendered through the real `PostCard` — relay cards in every state, seeded
          into `relayMetadataStore` so nothing here depends on live content.
        </Text>
        {FAKE_POSTS_FAMILY.scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-fake-posts-${scenario.id}`}>
              {scenario.render()}
            </View>
          </Section>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

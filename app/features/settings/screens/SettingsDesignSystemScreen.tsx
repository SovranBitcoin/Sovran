import React, { useCallback } from 'react';
import { ScrollView } from 'react-native';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';

import {
  DESIGN_SYSTEM_CATALOG,
  type DesignSystemFamily,
} from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';

const DesignSystemLinkItem: React.FC<DesignSystemFamily> = ({ id, href, title, description }) => {
  const handlePress = useCallback(() => router.navigate(href), [href]);

  return (
    <PressableFeedback
      testID={`design-system-family-${id}`}
      animation={false}
      onPress={handlePress}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
};

export function SettingsDesignSystemScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemScreen" scroll="custom" safeArea>
      <ScrollView className="px-4">
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Live previews of shared UI components. Open one to see it in isolation — only the selected
          component animates, so the previews stay smooth.
        </Text>
        <Section title="Components">
          <ListGroup variant="secondary">
            {DESIGN_SYSTEM_CATALOG.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <DesignSystemLinkItem {...entry} />
              </React.Fragment>
            ))}
          </ListGroup>
        </Section>
      </ScrollView>
    </ScreenWrapper>
  );
}

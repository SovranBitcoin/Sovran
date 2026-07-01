import React from 'react';
import { ScrollView } from 'react-native';

import { type Href } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';

type ComponentEntry = {
  href: Href;
  title: string;
  description: string;
};

const COMPONENTS: ComponentEntry[] = [
  {
    href: '/(settings-flow)/design-system-loading',
    title: 'Loading indicator',
    description: 'Idle / loading / done, resolving to success, error, or reverted',
  },
  {
    href: '/(settings-flow)/design-system-segmented',
    title: 'Segmented progress',
    description: 'Discrete step-by-step progress ring',
  },
  {
    href: '/(settings-flow)/design-system-timeline',
    title: 'Timeline',
    description: 'State-driven payment flow, stepped through its states',
  },
  {
    href: '/(settings-flow)/design-system-empty-states',
    title: 'Empty states',
    description: 'Every "nothing to show" surface, unified via EmptyState',
  },
  {
    href: '/(settings-flow)/design-system-skeleton-crossfade',
    title: 'Skeleton crossfade',
    description: 'Region wave, 220ms skeleton→content fade, independent image fades',
  },
];

const DesignSystemLinkItem: React.FC<ComponentEntry> = ({ href, title, description }) => (
  <PressableFeedback animation={false} onPress={() => router.navigate(href)}>
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
            {COMPONENTS.map((entry, index) => (
              <React.Fragment key={entry.title}>
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

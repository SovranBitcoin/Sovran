import React from 'react';
import { ScrollView } from 'react-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { EmptyState } from '@/shared/ui/composed/EmptyState';

/**
 * Catalog of every place the app shows an empty state, all rendered through the
 * single `EmptyState` component so they stay visually consistent. Adding a new
 * empty surface? Add its variant here and reuse `EmptyState` on the screen.
 */
const EMPTY_STATES: { section: string; icon: string; title: string; subtitle?: string }[] = [
  {
    section: 'Feed',
    icon: 'mdi:message-text',
    title: 'No posts yet',
    subtitle: "This user hasn't posted any notes.",
  },
  {
    section: 'Notifications',
    icon: 'mdi:bell-off-outline',
    title: 'No notifications',
    subtitle: "You're all caught up.",
  },
  {
    section: 'Mentions',
    icon: 'mdi:at',
    title: 'No mentions',
    subtitle: 'Replies and mentions will show up here.',
  },
  {
    section: 'Search results',
    icon: 'mdi:magnify',
    title: 'No results',
    subtitle: 'Try a different name or npub.',
  },
  {
    section: 'Contacts',
    icon: 'mdi:account-multiple',
    title: 'No conversations yet',
    subtitle: 'Your Nostr and Whitenoise chats will appear here.',
  },
  {
    section: 'Transactions',
    icon: 'mdi:receipt-text-outline',
    title: 'No transactions',
    subtitle: 'Your payments and receipts will appear here.',
  },
  {
    section: 'Nearby (BitChat)',
    icon: 'mdi:bluetooth-off',
    title: 'No one nearby',
    subtitle: 'Move closer to other people running Sovran to chat over Bluetooth.',
  },
];

export function SettingsDesignSystemEmptyStatesScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemEmptyStatesScreen" scroll="custom" safeArea>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Every empty surface in the app rendered through the shared `EmptyState` component.
        </Text>
        {EMPTY_STATES.map((entry) => (
          <Section key={entry.section} title={entry.section}>
            <EmptyState icon={entry.icon} title={entry.title} subtitle={entry.subtitle} />
          </Section>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

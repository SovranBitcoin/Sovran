import { EmptyState } from '@/shared/ui/composed/EmptyState';

import type { DesignSystemScenario } from './catalog';

const EMPTY_STATE_SOURCE = 'shared/ui/composed/EmptyState.tsx';

export const EMPTY_STATE_SCENARIOS = [
  {
    id: 'feed',
    title: 'Feed',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState
        icon="mdi:message-text"
        title="No posts yet"
        subtitle="This user hasn't posted any notes."
      />
    ),
  },
  {
    id: 'notifications',
    title: 'Notifications',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState
        icon="mdi:bell-off-outline"
        title="No notifications"
        subtitle="You're all caught up."
      />
    ),
  },
  {
    id: 'mentions',
    title: 'Mentions',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState
        icon="mdi:at"
        title="No mentions"
        subtitle="Replies and mentions will show up here."
      />
    ),
  },
  {
    id: 'search-results',
    title: 'Search results',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState icon="mdi:magnify" title="No results" subtitle="Try a different name or npub." />
    ),
  },
  {
    id: 'contacts',
    title: 'Contacts',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState
        icon="mdi:account-multiple"
        title="No conversations yet"
        subtitle="Your Nostr and Whitenoise chats will appear here."
      />
    ),
  },
  {
    id: 'transactions',
    title: 'Transactions',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState
        icon="mdi:receipt-text-outline"
        title="No transactions"
        subtitle="Your payments and receipts will appear here."
      />
    ),
  },
  {
    id: 'nearby-bitchat',
    title: 'Nearby (BitChat)',
    covers: [EMPTY_STATE_SOURCE],
    render: () => (
      <EmptyState
        icon="mdi:bluetooth-off"
        title="No one nearby"
        subtitle="Move closer to other people running Sovran to chat over Bluetooth."
      />
    ),
  },
] as const satisfies readonly DesignSystemScenario[];

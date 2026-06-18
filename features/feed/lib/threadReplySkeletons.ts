import { spacing } from '@/shared/styles/tokens';

export const DEFAULT_REPLY_SKELETON_COUNT = 3;
export const MAX_REPLY_SKELETON_COUNT = 5;

export const REPLY_SKELETON_VARIANTS = [
  {
    author: 'Display Name',
    timestamp: '12m',
    content: ['A short reply is loading'],
    metricWidth: spacing.lg,
  },
  {
    author: 'Longer Display Name',
    timestamp: '1h',
    content: ['Another reply placeholder is still loading'],
    metricWidth: spacing.xl,
  },
  {
    author: 'A Medium Author',
    timestamp: '5h',
    content: ['A medium-length response is still loading', 'with a compact second line'],
    metricWidth: spacing.md,
  },
  {
    author: 'Name',
    timestamp: 'now',
    content: ['Compact reply loading'],
    metricWidth: spacing.md,
  },
  {
    author: 'Casual Username',
    timestamp: '3d',
    content: ['Yet another reply is loading'],
    metricWidth: spacing['2xl'],
  },
] as const;

export const TARGET_SKELETON_VARIANT = {
  author: 'Display Name',
  npub: 'npub1skeleton...',
  date: 'May 16, 2026 at 12:00',
  content: [
    'This thread post is loading with the same content measure',
    'as a real post body in the detail view',
  ],
  metricWidth: spacing.xl,
} as const;

import type { Href } from 'expo-router';
import type { ReactElement } from 'react';

import { EMPTY_STATE_SCENARIOS } from './emptyStates';
import { FADE_REVEAL_STRESS_SCENARIOS } from './fadeRevealStress';
import { FAKE_POST_SCENARIOS } from './fakePosts';
import { FOUNDATION_SCENARIOS } from './foundations';
import { LOADING_INDICATOR_SCENARIOS } from './loadingIndicator';
import { SEGMENTED_PROGRESS_SCENARIOS } from './segmentedProgress';
import { SKELETON_CROSSFADE_SCENARIOS } from './skeletonCrossfade';
import { TIMELINE_SCENARIOS } from './timeline';
import { WALLET_CONTROL_SCENARIOS } from './walletControls';

export interface DesignSystemScenario {
  readonly id: string;
  readonly title: string;
  readonly covers: readonly string[];
  render(): ReactElement;
}

export interface DesignSystemFamily {
  readonly id: string;
  readonly href: Href;
  readonly title: string;
  readonly description: string;
  readonly scenarios: readonly DesignSystemScenario[];
}

export const DESIGN_SYSTEM_CATALOG: readonly DesignSystemFamily[] = [
  {
    id: 'foundations',
    href: '/(settings-flow)/design-system-foundations',
    title: 'Foundations',
    description: 'Type, buttons, badges, rows, selection, skeletons, and sheet chrome',
    scenarios: FOUNDATION_SCENARIOS,
  },
  {
    id: 'loading-indicator',
    href: '/(settings-flow)/design-system-loading',
    title: 'Loading indicator',
    description: 'Idle / loading / done, resolving to success, error, or reverted',
    scenarios: LOADING_INDICATOR_SCENARIOS,
  },
  {
    id: 'wallet-controls',
    href: '/(settings-flow)/design-system-wallet-controls',
    title: 'Wallet controls',
    description: 'Amounts, keypads, actions, mint identity, selection, and transfer feedback',
    scenarios: WALLET_CONTROL_SCENARIOS,
  },
  {
    id: 'segmented-progress',
    href: '/(settings-flow)/design-system-segmented',
    title: 'Segmented progress',
    description: 'Discrete step-by-step progress ring',
    scenarios: SEGMENTED_PROGRESS_SCENARIOS,
  },
  {
    id: 'timeline',
    href: '/(settings-flow)/design-system-timeline',
    title: 'Timeline',
    description: 'State-driven payment flow, stepped through its states',
    scenarios: TIMELINE_SCENARIOS,
  },
  {
    id: 'empty-states',
    href: '/(settings-flow)/design-system-empty-states',
    title: 'Empty states',
    description: 'Every "nothing to show" surface, unified via EmptyState',
    scenarios: EMPTY_STATE_SCENARIOS,
  },
  {
    id: 'skeleton-crossfade',
    href: '/(settings-flow)/design-system-skeleton-crossfade',
    title: 'Skeleton crossfade',
    description: 'Region wave, 220ms skeleton→content fade, independent image fades',
    scenarios: SKELETON_CROSSFADE_SCENARIOS,
  },
  {
    id: 'fade-reveal-stress',
    href: '/(settings-flow)/design-system-fade-stress',
    title: 'Fade-reveal stress',
    description: 'Remounting fade-in grid hunting the invisible-element race (red = stuck)',
    scenarios: FADE_REVEAL_STRESS_SCENARIOS,
  },
  {
    id: 'fake-posts',
    href: '/(settings-flow)/design-system-posts',
    title: 'Fake posts',
    description: 'Fixture feed posts — every relay-card situation without real content',
    scenarios: FAKE_POST_SCENARIOS,
  },
];

export function getDesignSystemFamily(id: string): DesignSystemFamily {
  const family = DESIGN_SYSTEM_CATALOG.find((entry) => entry.id === id);

  if (!family) {
    throw new Error(`Unknown Design System family: ${id}`);
  }

  return family;
}

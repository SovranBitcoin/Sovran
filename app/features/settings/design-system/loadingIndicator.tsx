import React from 'react';

import { LoadingIndicator, type Phase, type Result } from '@/shared/blocks/status';

import type { DesignSystemScenario } from './catalog';

const LOADING_INDICATOR_SOURCE = 'shared/blocks/status/LoadingIndicator.tsx';

export const LOADING_INDICATOR_PREVIEW_SIZE = 140;
export const LOADING_INDICATOR_SIZES = [16, 20, 32, 48, 72] as const;

const STATE_CASES: readonly {
  id: string;
  title: string;
  phase: Phase;
  result: Result;
}[] = [
  { id: 'state-idle', title: 'Idle', phase: 'idle', result: 'success' },
  { id: 'state-loading', title: 'Loading', phase: 'loading', result: 'success' },
  { id: 'state-success', title: 'Resolved · Success', phase: 'done', result: 'success' },
  { id: 'state-error', title: 'Resolved · Error', phase: 'done', result: 'error' },
  { id: 'state-reverted', title: 'Resolved · Reverted', phase: 'done', result: 'reverted' },
];

export const LOADING_INDICATOR_SCENARIOS = [
  ...STATE_CASES.map(({ id, title, phase, result }) => ({
    id,
    title,
    covers: [LOADING_INDICATOR_SOURCE],
    render: () => (
      <LoadingIndicator
        size={LOADING_INDICATOR_PREVIEW_SIZE}
        phase={phase}
        result={result}
        visualDisabled
      />
    ),
  })),
  ...LOADING_INDICATOR_SIZES.map((size) => ({
    id: `size-${size}`,
    title: `${size}px`,
    covers: [LOADING_INDICATOR_SOURCE],
    render: () => <LoadingIndicator size={size} phase="loading" result="success" visualDisabled />,
  })),
] satisfies readonly DesignSystemScenario[];

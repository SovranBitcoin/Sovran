import React from 'react';

import { Card } from '@/shared/ui/composed/Card';
import { DetailsList } from '@/shared/ui/composed/DetailsList';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import {
  RowStatsAccent,
  RowStatsAccentSkeleton,
  STAT_COLOR_SOCIAL,
  STAT_ICONS,
} from '@/shared/ui/composed/RowStatsAccent';
import { SheetGrabber } from '@/shared/ui/composed/SheetGrabber';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Button } from '@/shared/ui/primitives/Button';
import { SelectableCheckCircle } from '@/shared/ui/primitives/SelectableCheck/SelectableCheck.circle';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import type { DesignSystemScenario } from './types';

const SOURCES = {
  badge: 'shared/ui/primitives/Badge.tsx',
  button: 'shared/ui/primitives/Button.tsx',
  card: 'shared/ui/composed/Card.tsx',
  detailsList: 'shared/ui/composed/DetailsList.tsx',
  hstack: 'shared/ui/primitives/View/HStack.tsx',
  pillTabs: 'shared/ui/composed/PillTabs.tsx',
  rowStats: 'shared/ui/composed/RowStatsAccent.tsx',
  selectableCheckCircle: 'shared/ui/primitives/SelectableCheck/SelectableCheck.circle.tsx',
  sheetGrabber: 'shared/ui/composed/SheetGrabber.tsx',
  skeleton: 'shared/ui/primitives/Skeleton.tsx',
  spacer: 'shared/ui/primitives/View/Spacer.tsx',
  spinner: 'shared/ui/primitives/Spinner.tsx',
  text: 'shared/ui/primitives/Text.tsx',
  view: 'shared/ui/primitives/View/View.tsx',
  vstack: 'shared/ui/primitives/View/VStack.tsx',
} as const;

const noop = () => undefined;
const PILL_TABS = ['All', 'Recent', 'Requests'] as const;
const DETAIL_ITEMS = [
  { title: 'Mint', value: 'mint.sovran.example' },
  { title: 'Unit', value: 'sat' },
  { title: 'Balance', value: '2,100 sats' },
];
const DESIGN_SYSTEM_NIP05 = { handle: 'sovran@example.com' };

function RowStatsScenario() {
  const [warning, success] = useThemeColor(['warning', 'success'] as const);
  const stats = React.useMemo(
    () => [
      { icon: STAT_ICONS.reputation, value: '98%', color: STAT_COLOR_SOCIAL },
      { icon: STAT_ICONS.audit, value: 'Online', color: success },
      { icon: STAT_ICONS.score, value: '4.8', color: warning },
    ],
    [success, warning]
  );

  return (
    <RowStatsAccent stats={stats} nip05={DESIGN_SYSTEM_NIP05} note="Verified public profile" />
  );
}

export const FOUNDATION_SCENARIOS = [
  {
    id: 'type-ramp',
    title: 'Type ramp',
    covers: [SOURCES.text, SOURCES.vstack],
    render: () => (
      <VStack gap={8}>
        <Text size={12}>Caption · Oxygen Regular · 12</Text>
        <Text size={16} medium>
          Body · Oxygen Bold · 16
        </Text>
        <Text size={24} bold>
          Heading · Oxygen Bold · 24
        </Text>
        <Text size={32} overpass heavy>
          21,000
        </Text>
      </VStack>
    ),
  },
  {
    id: 'text-loading-fallback',
    title: 'Text loading and fallback',
    covers: [SOURCES.text, SOURCES.vstack],
    render: () => (
      <VStack gap={10}>
        <Text size={16} loading placeholder="Display name" visualDisabled />
        <Text size={14} fallback="Fallback copy" />
      </VStack>
    ),
  },
  {
    id: 'stack-layout',
    title: 'Stack, spacer, and view layout',
    covers: [SOURCES.hstack, SOURCES.spacer, SOURCES.text, SOURCES.view, SOURCES.vstack],
    render: () => (
      <VStack gap={8}>
        <HStack gap={8}>
          <View className="bg-success h-8 w-8 rounded-full" />
          <Text bold>Aligned row</Text>
          <Spacer size={8} />
          <Text>Trailing</Text>
        </HStack>
        <View className="bg-surface-secondary rounded-xl p-3">
          <Text>Shared surface</Text>
        </View>
      </VStack>
    ),
  },
  {
    id: 'button-variants',
    title: 'Button variants',
    covers: [SOURCES.button],
    render: () => (
      <VStack>
        <Button text="Primary action" variant="primary" onPress={noop} />
        <Button text="Secondary action" variant="secondary" onPress={noop} />
        <Button text="Dangerous action" variant="dangerous" onPress={noop} />
        <Button text="Underlined action" variant="underline" onPress={noop} />
      </VStack>
    ),
  },
  {
    id: 'button-states',
    title: 'Button states and compact chips',
    covers: [SOURCES.button, SOURCES.spinner],
    render: () => (
      <VStack gap={8}>
        <Button text="Disabled" variant="primary" disabled onPress={noop} />
        <Button text="Processing" variant="primary" loading onPress={noop} />
        <HStack gap={8} wrap="wrap">
          <Button text="Selected" variant="primary" size="compact" onPress={noop} />
          <Button text="Available" variant="secondary" size="compact" onPress={noop} />
        </HStack>
      </VStack>
    ),
  },
  {
    id: 'badge-statuses',
    title: 'Badge statuses',
    covers: [SOURCES.badge, SOURCES.hstack],
    render: () => (
      <HStack gap={8} wrap="wrap">
        <Badge variant="primary">Primary</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="error">Error</Badge>
        <Badge variant="star" icon="ic:round-star">
          Trusted
        </Badge>
      </HStack>
    ),
  },
  {
    id: 'skeleton-shapes',
    title: 'Skeleton shapes',
    covers: [SOURCES.skeleton, SOURCES.vstack],
    render: () => (
      <VStack gap={10}>
        <Skeleton className="h-4 w-2/3" visualDisabled />
        <Skeleton className="h-4 w-full" visualDisabled />
        <Skeleton className="h-20 w-full rounded-2xl" visualDisabled />
      </VStack>
    ),
  },
  {
    id: 'spinner-sizes',
    title: 'Spinner sizes',
    covers: [SOURCES.hstack, SOURCES.spinner],
    render: () => (
      <HStack gap={24} justify="center">
        <Spinner size={16} visualDisabled />
        <Spinner size={24} visualDisabled />
        <Spinner size={32} visualDisabled />
      </HStack>
    ),
  },
  {
    id: 'notice-cards',
    title: 'Information and warning cards',
    covers: [SOURCES.card, SOURCES.vstack],
    render: () => (
      <VStack gap={12}>
        <Card title="Information" message="This is a neutral supporting message." variant="info" />
        <Card title="Check this" message="This action needs your attention." variant="warning" />
      </VStack>
    ),
  },
  {
    id: 'detail-rows',
    title: 'Detail rows',
    covers: [SOURCES.detailsList],
    render: () => <DetailsList items={DETAIL_ITEMS} />,
  },
  {
    id: 'row-stats-loading',
    title: 'Row stats loading parity',
    covers: [SOURCES.rowStats],
    render: () => <RowStatsAccentSkeleton seed="design-system" />,
  },
  {
    id: 'row-stats',
    title: 'Row stats and NIP-05 identity',
    covers: [SOURCES.rowStats],
    render: () => <RowStatsScenario />,
  },
  {
    id: 'selection-circles',
    title: 'Selection circles',
    covers: [SOURCES.hstack, SOURCES.selectableCheckCircle],
    render: () => (
      <HStack gap={16}>
        <SelectableCheckCircle selected={false} accessibilityLabel="Not selected" />
        <SelectableCheckCircle selected accessibilityLabel="Selected" />
        <SelectableCheckCircle selected disabled accessibilityLabel="Disabled selection" />
      </HStack>
    ),
  },
  {
    id: 'pill-tabs',
    title: 'Pill tabs',
    covers: [SOURCES.pillTabs],
    render: () => <PillTabs tabs={PILL_TABS} activeTab="Recent" onTabChange={noop} />,
  },
  {
    id: 'sheet-grabber',
    title: 'Sheet grabber',
    covers: [SOURCES.sheetGrabber],
    render: () => <SheetGrabber />,
  },
] satisfies readonly DesignSystemScenario[];

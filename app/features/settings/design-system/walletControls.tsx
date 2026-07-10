/* eslint-disable @typescript-eslint/no-require-imports -- catalog metadata must stay import-side-effect free; native preview dependencies load only when rendered. */
import React from 'react';

import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import type { Capabilities } from '@/shared/ui/capability';
import type { DesignSystemScenario } from './catalog';

const SOURCES = {
  actionSegments: 'shared/ui/composed/ActionSegmentsCard.tsx',
  amountFormatter: 'shared/ui/composed/AmountFormatter.tsx',
  circleActionFlat: 'shared/ui/composed/CircleActionButton/CircleActionButton.flat.tsx',
  circleActionShell: 'shared/ui/composed/CircleActionButton/CircleActionButtonShell.tsx',
  copyableValue: 'shared/ui/composed/CopyableValue.tsx',
  customKeyboard: 'shared/ui/composed/CustomKeyboard.tsx',
  detailsSection: 'shared/ui/composed/DetailsSection.tsx',
  mintIcon: 'shared/ui/composed/MintIcon.tsx',
  selectableCheck: 'shared/ui/primitives/SelectableCheck/index.tsx',
  selectableCheckSquare: 'shared/ui/primitives/SelectableCheck/SelectableCheck.square.tsx',
  transferError: 'shared/blocks/transfer/TransferErrorBanner.tsx',
  transferSeparator: 'shared/blocks/transfer/TransferSeparator.tsx',
} as const;

const STATIC_CAPABILITIES = {
  liquidGlass: false,
  blur: false,
  frostedSurface: false,
  linearGradient: true,
  meshGradient: true,
  icon: 'monicon',
} as const satisfies Capabilities;

const noop = () => undefined;
const ACTION_SEGMENTS = [
  {
    label: 'Send',
    icon: 'lucide:arrow-up-right',
    active: true,
    onPress: noop,
    testID: 'design-system-wallet-segment-send',
  },
  {
    label: 'Receive',
    icon: 'lucide:arrow-down-left',
    onPress: noop,
    testID: 'design-system-wallet-segment-receive',
  },
  {
    label: 'Offline',
    icon: 'lucide:wifi-off',
    dimmed: true,
    onPress: noop,
    testID: 'design-system-wallet-segment-offline',
  },
];
const DETAIL_ITEMS = [
  { title: 'Mint', value: 'mint.sovran.example' },
  { title: 'Quote ID', value: 'melt-quote-000021' },
  { title: 'State', value: 'PAID' },
];

function AmountSatModesPreview() {
  const { CapabilityProvider } =
    require('@/shared/ui/capability') as typeof import('@/shared/ui/capability');
  const { AmountFormatter } =
    require('@/shared/ui/composed/AmountFormatter') as typeof import('@/shared/ui/composed/AmountFormatter');

  return (
    <CapabilityProvider value={STATIC_CAPABILITIES}>
      <VStack gap={12}>
        <AmountFormatter amount={21_000} unit="sat" displayPreference={0} size={24} />
        <AmountFormatter amount={21_000} unit="sat" displayPreference={1} size={24} />
        <AmountFormatter amount={21_000} unit="sat" displayPreference={2} size={24} />
        <AmountFormatter amount={21_000} unit="sat" displayPreference={3} size={24} />
      </VStack>
    </CapabilityProvider>
  );
}

function AmountDirectionPreview() {
  const { CapabilityProvider } =
    require('@/shared/ui/capability') as typeof import('@/shared/ui/capability');
  const { AmountFormatter } =
    require('@/shared/ui/composed/AmountFormatter') as typeof import('@/shared/ui/composed/AmountFormatter');

  return (
    <CapabilityProvider value={STATIC_CAPABILITIES}>
      <VStack gap={12}>
        <AmountFormatter amount={2_100} unit="sat" displayPreference={3} sign="-" size={24} />
        <AmountFormatter amount={12_345} unit="usd" sign="+" size={24} />
      </VStack>
    </CapabilityProvider>
  );
}

function KeyboardPreview({ unit, loading = false }: { unit: string; loading?: boolean }) {
  const CustomKeyboard = require('@/shared/ui/composed/CustomKeyboard')
    .default as typeof import('@/shared/ui/composed/CustomKeyboard').default;

  return (
    <CustomKeyboard
      unit={unit}
      loading={loading}
      compact
      value={unit === 'sat' ? '2100' : '21.00'}
      onKeyPress={noop}
    />
  );
}

function ActionSegmentsPreview() {
  const { ActionSegmentsCard } =
    require('@/shared/ui/composed/ActionSegmentsCard') as typeof import('@/shared/ui/composed/ActionSegmentsCard');

  return <ActionSegmentsCard segments={ACTION_SEGMENTS} />;
}

function CircleActionsPreview() {
  const { CircleActionButtonFlat } =
    require('@/shared/ui/composed/CircleActionButton/CircleActionButton.flat') as typeof import('@/shared/ui/composed/CircleActionButton/CircleActionButton.flat');

  return (
    <HStack gap={24} justify="center">
      <CircleActionButtonFlat
        icon="lucide:arrow-up-right"
        label="Send"
        onPress={noop}
        testID="design-system-wallet-circle-send"
      />
      <CircleActionButtonFlat
        icon="lucide:arrow-down-left"
        label="Receive"
        onPress={noop}
        testID="design-system-wallet-circle-receive"
      />
      <CircleActionButtonFlat
        icon="lucide:scan-line"
        label="Scan"
        disabled
        testID="design-system-wallet-circle-disabled"
      />
    </HStack>
  );
}

function MintIconStatesPreview() {
  const { MintIcon } =
    require('@/shared/ui/composed/MintIcon') as typeof import('@/shared/ui/composed/MintIcon');

  return (
    <HStack gap={16} align="center">
      <VStack gap={6} align="center">
        <MintIcon name="Loading mint" size={44} isLoading />
        <Text size={12}>Loading</Text>
      </VStack>
      <VStack gap={6} align="center">
        <MintIcon name="Fallback mint" size={44} />
        <Text size={12}>Fallback</Text>
      </VStack>
    </HStack>
  );
}

function CopyableValuePreview() {
  const { CopyableValue } =
    require('@/shared/ui/composed/CopyableValue') as typeof import('@/shared/ui/composed/CopyableValue');

  return (
    <CopyableValue
      value="https://mint.sovran.example/bitcoin"
      display="mint.sovran…/bitcoin"
      copyTarget="mintUrl"
    />
  );
}

function SelectionSquaresPreview() {
  const { SelectableCheck } =
    require('@/shared/ui/primitives/SelectableCheck') as typeof import('@/shared/ui/primitives/SelectableCheck');

  return (
    <HStack gap={20} align="center">
      <SelectableCheck selected={false} style="square" accessibilityLabel="Unchecked mint" />
      <SelectableCheck
        selected
        style="square"
        variant="primary"
        accessibilityLabel="Selected mint"
      />
      <SelectableCheck
        selected
        disabled
        style="square"
        variant="error"
        accessibilityLabel="Disabled mint"
      />
    </HStack>
  );
}

function DetailsPreview({ expanded }: { expanded: boolean }) {
  const { DetailsSection } =
    require('@/shared/ui/composed/DetailsSection') as typeof import('@/shared/ui/composed/DetailsSection');

  return <DetailsSection label="Payment details" items={DETAIL_ITEMS} initialExpanded={expanded} />;
}

function TransferFeedbackPreview() {
  const { TransferErrorBanner } =
    require('@/shared/blocks/transfer/TransferErrorBanner') as typeof import('@/shared/blocks/transfer/TransferErrorBanner');
  const { TransferSeparator } =
    require('@/shared/blocks/transfer/TransferSeparator') as typeof import('@/shared/blocks/transfer/TransferSeparator');

  return (
    <VStack gap={8}>
      <TransferSeparator status="idle" />
      <TransferSeparator status="done" />
      <TransferSeparator status="failed" />
      <TransferErrorBanner message="The mint rejected these proofs. Nothing was spent." />
    </VStack>
  );
}

export const WALLET_CONTROL_SCENARIOS = [
  {
    id: 'amount-sat-modes',
    title: 'Amount · BTC and sat display modes',
    covers: [SOURCES.amountFormatter],
    render: () => <AmountSatModesPreview />,
  },
  {
    id: 'amount-direction-and-fiat',
    title: 'Amount · Direction and fiat cents',
    covers: [SOURCES.amountFormatter],
    render: () => <AmountDirectionPreview />,
  },
  {
    id: 'keypad-sats',
    title: 'Keypad · Sats',
    covers: [SOURCES.customKeyboard],
    render: () => <KeyboardPreview unit="sat" />,
  },
  {
    id: 'keypad-fiat-loading',
    title: 'Keypad · Fiat loading',
    covers: [SOURCES.customKeyboard],
    render: () => <KeyboardPreview unit="usd" loading />,
  },
  {
    id: 'action-segments',
    title: 'Action segments · Active and dimmed',
    covers: [SOURCES.actionSegments],
    render: () => <ActionSegmentsPreview />,
  },
  {
    id: 'circle-actions',
    title: 'Circle actions · Enabled and disabled',
    covers: [SOURCES.circleActionFlat, SOURCES.circleActionShell],
    render: () => <CircleActionsPreview />,
  },
  {
    id: 'mint-icon-states',
    title: 'Mint icon · Loading and fallback',
    covers: [SOURCES.mintIcon],
    render: () => <MintIconStatesPreview />,
  },
  {
    id: 'copyable-value',
    title: 'Copyable wallet value',
    covers: [SOURCES.copyableValue],
    render: () => <CopyableValuePreview />,
  },
  {
    id: 'selection-squares',
    title: 'Selection squares · State and palette',
    covers: [SOURCES.selectableCheck, SOURCES.selectableCheckSquare],
    render: () => <SelectionSquaresPreview />,
  },
  {
    id: 'details-collapsed',
    title: 'Payment details · Collapsed',
    covers: [SOURCES.detailsSection],
    render: () => <DetailsPreview expanded={false} />,
  },
  {
    id: 'details-expanded',
    title: 'Payment details · Expanded',
    covers: [SOURCES.detailsSection],
    render: () => <DetailsPreview expanded />,
  },
  {
    id: 'transfer-feedback',
    title: 'Transfer feedback · Idle, done, and failed',
    covers: [SOURCES.transferError, SOURCES.transferSeparator],
    render: () => <TransferFeedbackPreview />,
  },
] satisfies readonly DesignSystemScenario[];

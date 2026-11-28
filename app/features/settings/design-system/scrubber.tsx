/* eslint-disable @typescript-eslint/no-require-imports -- catalog metadata must stay import-side-effect free; the tab bar's module loads only when rendered. */

/**
 * The animation frame scrubber: five of the app's transitions, each driven by
 * one shared value from outside instead of its own timing, so any in-between
 * frame (0 = start, 1 = end) can be held still and inspected. Setting the
 * value is direct, never animated, so a held frame does not drift.
 */

import { useEffect, type ReactElement } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Button } from '@/shared/ui/primitives/Button';
import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';
import { View } from '@/shared/ui/primitives/View/View';

import type { DesignSystemScenario } from './types';
import { ACCOUNT, AccountRowFixture, MINT, MintPillFixture } from './uiKit';

const SOURCES = {
  balanceDisplay: 'shared/ui/composed/BalancePill/BalanceDisplay.tsx',
  button: 'shared/ui/primitives/Button.tsx',
  pressScale: 'shared/ui/primitives/PressScale.tsx',
  selectableCheckCircle: 'shared/ui/primitives/SelectableCheck/SelectableCheck.circle.tsx',
  skeletonCrossfade: 'shared/ui/composed/SkeletonContentCrossfade.tsx',
  tabBar: 'shared/blocks/SovranTabBar.tsx',
} as const;

const noop = () => undefined;

/** The quick-snap stops, in percent of the transition. */
export const SCRUB_STOPS = [0, 25, 50, 75, 100] as const;

export type ScrubTransitionId =
  | 'button-press'
  | 'mint-selector-crossfade'
  | 'selectable-check'
  | 'account-row-active'
  | 'search-tab-close';

type FrameProps = { progress: SharedValue<number> };

export interface ScrubTransition {
  readonly id: ScrubTransitionId;
  readonly title: string;
  /** What 0% and 100% look like, in plain words. */
  readonly from: string;
  readonly to: string;
  readonly component: string;
  readonly covers: readonly string[];
  readonly Frame: (props: FrameProps) => ReactElement;
}

function ButtonPressFrame({ progress }: FrameProps) {
  return (
    <View className="w-full">
      <Button text="Send" haptics={false} onPress={noop} pressProgress={progress} />
    </View>
  );
}

function MintSelectorCrossfadeFrame({ progress }: FrameProps) {
  return (
    <MintPillFixture
      title={MINT.name}
      balance={21_000}
      presence="online"
      loadingProgress={progress}
    />
  );
}

function SelectableCheckFrame({ progress }: FrameProps) {
  return (
    <SelectableCheck
      selected={false}
      size={28}
      selectProgress={progress}
      accessibilityLabel="Scrubbed selection mark"
    />
  );
}

function AccountRowActiveFrame({ progress }: FrameProps) {
  return (
    <View className="w-full">
      <AccountRowFixture
        profile={ACCOUNT.plain}
        metadata={ACCOUNT.handle}
        activeProgress={progress}
      />
    </View>
  );
}

function SearchTabCloseFrame({ progress }: FrameProps) {
  const { SearchTabIcon } =
    require('@/shared/blocks/SovranTabBar') as typeof import('@/shared/blocks/SovranTabBar');
  const foreground = useThemeColor('foreground');

  return <SearchTabIcon focused={false} color={foreground} searchCloseProgress={progress} />;
}

export const SCRUB_TRANSITIONS: readonly ScrubTransition[] = [
  {
    id: 'button-press',
    title: 'Button press',
    from: 'At rest',
    to: 'Pressed',
    component: 'Button',
    covers: [SOURCES.button, SOURCES.pressScale],
    Frame: ButtonPressFrame,
  },
  {
    id: 'mint-selector-crossfade',
    title: 'Mint selector arrives',
    from: 'Placeholder',
    to: 'Mint and balance',
    component: 'MintSelector',
    covers: [SOURCES.balanceDisplay, SOURCES.skeletonCrossfade],
    Frame: MintSelectorCrossfadeFrame,
  },
  {
    id: 'selectable-check',
    title: 'Selection mark',
    from: 'Empty',
    to: 'Selected',
    component: 'SelectableCheck',
    covers: [SOURCES.selectableCheckCircle],
    Frame: SelectableCheckFrame,
  },
  {
    id: 'account-row-active',
    title: 'Account becomes active',
    from: 'Plain row',
    to: 'Highlighted, checked',
    component: 'AccountRow',
    covers: [],
    Frame: AccountRowActiveFrame,
  },
  {
    id: 'search-tab-close',
    title: 'Search tab icon',
    from: 'Magnifier',
    to: 'Close mark',
    component: 'SearchTabIcon',
    covers: [SOURCES.tabBar],
    Frame: SearchTabCloseFrame,
  },
];

/**
 * One transition drawn at `value`. The shared value follows the prop
 * directly — a set, never a timing — so the frame shown is exactly `value`.
 */
export function ScrubbedFrame({
  transition,
  value,
}: {
  transition: ScrubTransition;
  value: number;
}) {
  const progress = useSharedValue(value);
  useEffect(() => {
    progress.set(value);
  }, [value, progress]);
  const { Frame } = transition;

  return (
    <View className="min-h-[72px] w-full items-center justify-center">
      <Frame progress={progress} />
    </View>
  );
}

/** For the catalog: each transition held at its midpoint, the frame a timing never pauses on. */
export const SCRUBBER_SCENARIOS = SCRUB_TRANSITIONS.map((transition) => ({
  id: transition.id,
  title: `${transition.title} · 50%`,
  component: transition.component,
  covers: transition.covers,
  render: () => <ScrubbedFrame transition={transition} value={0.5} />,
})) satisfies readonly DesignSystemScenario[];

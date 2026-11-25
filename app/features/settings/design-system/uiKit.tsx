/* eslint-disable @typescript-eslint/no-require-imports -- catalog metadata must stay import-side-effect free; the account row's module and the platform pills load only when rendered. */

/**
 * The state-locked UI kit: every core component held in each of its discrete
 * states on fixed data. Nothing here reads a store, a mint, a relay or the
 * network — every value a component shows is a constant below — so a state
 * looks the same on every run and on both platforms.
 *
 * `large-text` cannot set the phone's text size from inside the app, so its
 * frame narrows the column to the width 160% type leaves the same words, and
 * passes bigger sizes where a component takes one. Set the phone's own text
 * size to see the real thing.
 */

import React, { type ComponentProps } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
import type { GridStat } from '@/shared/ui/composed/StatsGrid';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import type { DesignSystemComponentState, DesignSystemScenario } from './types';

const SOURCES = {
  amountFormatter: 'shared/ui/composed/AmountFormatter.tsx',
  avatar: 'shared/ui/primitives/Avatar.tsx',
  badge: 'shared/ui/primitives/Badge.tsx',
  balanceDisplay: 'shared/ui/composed/BalancePill/BalanceDisplay.tsx',
  balancePillFlat: 'shared/ui/composed/BalancePill/BalancePill.flat.tsx',
  balancePillLiquid: 'shared/ui/composed/BalancePill/BalancePill.liquid.tsx',
  button: 'shared/ui/primitives/Button.tsx',
  glassSearchBarAndroid: 'shared/ui/composed/GlassSearchBar/GlassSearchBar.android.tsx',
  glassSearchBarIos: 'shared/ui/composed/GlassSearchBar/GlassSearchBar.ios.tsx',
  listRow: 'shared/ui/composed/ListRow.tsx',
  mintHeader: 'features/mint/components/MintHeader.tsx',
  mintIcon: 'shared/ui/composed/MintIcon.tsx',
  mintSelector: 'features/wallet/components/MintSelector/MintSelector.tsx',
  notice: 'shared/ui/composed/Notice.tsx',
  presenceDot: 'shared/ui/primitives/PresenceDot.tsx',
  pressScale: 'shared/ui/primitives/PressScale.tsx',
  selectableCheck: 'shared/ui/primitives/SelectableCheck/index.tsx',
  selectableCheckCircle: 'shared/ui/primitives/SelectableCheck/SelectableCheck.circle.tsx',
  selectableCheckSquare: 'shared/ui/primitives/SelectableCheck/SelectableCheck.square.tsx',
  settingsRows: 'shared/ui/composed/SettingsRows.tsx',
  statsGrid: 'shared/ui/composed/StatsGrid.tsx',
  switch: 'shared/ui/primitives/Switch.tsx',
  text: 'shared/ui/primitives/Text.tsx',
} as const;

const noop = () => undefined;

/**
 * The parts the fixtures draw, loaded on first render rather than when the
 * catalog is imported: several reach native or platform modules, and
 * the catalog's metadata is read where neither can load.
 */
function ui() {
  return {
    Icon: (require('@/assets/icons') as typeof import('@/assets/icons')).default,
    ...(require('@/shared/ui/composed/ListGroup') as typeof import('@/shared/ui/composed/ListGroup')),
    ...(require('@/features/mint/components/MintHeader') as typeof import('@/features/mint/components/MintHeader')),
    ...(require('@/shared/ui/composed/AmountFormatter') as typeof import('@/shared/ui/composed/AmountFormatter')),
    ...(require('@/shared/ui/composed/ListRow') as typeof import('@/shared/ui/composed/ListRow')),
    ...(require('@/shared/ui/composed/MintIcon') as typeof import('@/shared/ui/composed/MintIcon')),
    ...(require('@/shared/ui/composed/Notice') as typeof import('@/shared/ui/composed/Notice')),
    ...(require('@/shared/ui/composed/SettingsRows') as typeof import('@/shared/ui/composed/SettingsRows')),
    ...(require('@/shared/ui/composed/StatsGrid') as typeof import('@/shared/ui/composed/StatsGrid')),
    ...(require('@/shared/ui/primitives/Badge') as typeof import('@/shared/ui/primitives/Badge')),
    ...(require('@/shared/ui/primitives/Button') as typeof import('@/shared/ui/primitives/Button')),
    ...(require('@/shared/ui/primitives/PresenceDot') as typeof import('@/shared/ui/primitives/PresenceDot')),
    ...(require('@/shared/ui/primitives/SelectableCheck') as typeof import('@/shared/ui/primitives/SelectableCheck')),
    ...(require('@/shared/ui/primitives/Switch') as typeof import('@/shared/ui/primitives/Switch')),
  };
}

/** The pill's platform entry (liquid glass on iOS, flat elsewhere), loaded on render. */
function balancePill() {
  return (
    require('@/shared/ui/composed/BalancePill') as typeof import('@/shared/ui/composed/BalancePill/index.ios')
  ).default;
}

/** Matches `UNKNOWN_STAT`: an unknown count reads as a dash, never as a measured zero. */
const UNKNOWN = '—';

/** The largest text size the frame stands in for. */
const LARGE_TEXT_SCALE = 1.6;

/** Worst-case inputs: long unbroken words, huge amounts, emoji and right-to-left text. */
const WORST = {
  unbroken: 'Mintwithanamethatneverbreaksbecauseithasnospacesanywhereatallnotevenone',
  emoji: '🥜⚡️🧡 Peanut Mint 🧡⚡️🥜',
  rtl: 'نعناع البيتكوين الكبير',
  host: 'https://a-very-long-subdomain-that-keeps-going.mint.example-with-a-long-domain.com/Bitcoin',
  handle: 'someone_with_a_very_long_handle_that_never_ends@an-equally-long-domain.example',
  /** All 21 million bitcoin, in sats. */
  hugeSats: 2_100_000_000_000_000,
} as const;
const WORST_NAME = `${WORST.rtl} ${WORST.emoji} ${WORST.unbroken}`;

// ── Frames ──────────────────────────────────────────────────────

/**
 * Stand-in for a large system text size: a dashed frame whose column is the
 * width 160% type leaves the same words, so wrapping and truncation show.
 */
function LargeTextFrame({ children }: { children: React.ReactNode }) {
  return (
    <View
      testID="design-system-ui-kit-large-text-frame"
      className="border-foreground/30 gap-2 rounded-2xl border border-dashed p-3">
      <Text size={11} className="text-foreground/60" maxFontSizeMultiplier={1}>
        {`Large text stand-in · this column wraps like ${Math.round(LARGE_TEXT_SCALE * 100)}% type`}
      </Text>
      <View className="w-[62%] gap-3">{children}</View>
    </View>
  );
}

/** Visible but dimmed and untouchable, for a part with no disabled look of its own. */
function DisabledFrame({ children }: { children: React.ReactNode }) {
  return (
    <View pointerEvents="none" className="opacity-50" accessibilityState={{ disabled: true }}>
      {children}
    </View>
  );
}

// ── BalancePill / MintSelector ─────────────────────────────────

type PillFixture = {
  title: string;
  balance: number;
  isLoading?: boolean;
  ctaLabel?: string;
  presence?: 'online' | 'offline';
  width?: number;
  /** Holds the skeleton → label fade at one frame, for the scrubber. */
  loadingProgress?: SharedValue<number>;
};

/** The wallet header's mint pill, drawn the way `MintSelector` draws it, on fixed data. */
export function MintPillFixture({
  title,
  balance,
  isLoading,
  ctaLabel,
  presence,
  width,
  loadingProgress,
}: PillFixture) {
  const BalancePill = balancePill();
  const { MintIcon, PresenceDot } = ui();

  return (
    <BalancePill
      title={title}
      balance={balance}
      unit="sat"
      isLoading={isLoading}
      ctaLabel={ctaLabel}
      iconBoxSize={24}
      width={width}
      loadingProgress={loadingProgress}
      displayPreference={0}
      onPress={noop}
      iconNode={
        <View className="relative">
          <MintIcon name={title} size={24} isLoading={isLoading} />
          {!isLoading ? <PresenceDot presence={presence ?? null} size={24} /> : null}
        </View>
      }
    />
  );
}

/** The AI tab's balance pill: the same chrome with a wallet glyph and "Balance". */
function BalancePillDefault() {
  const BalancePill = balancePill();
  const { Icon } = ui();
  const foreground = useThemeColor('foreground');

  return (
    <BalancePill
      title="Balance"
      balance={21_000}
      unit="sat"
      iconBoxSize={24}
      displayPreference={0}
      onPress={noop}
      iconNode={<Icon name="solar:wallet-bold" size={20} color={foreground} />}
    />
  );
}

const PILL_COVERS = [
  SOURCES.balanceDisplay,
  SOURCES.balancePillFlat,
  SOURCES.balancePillLiquid,
  SOURCES.mintSelector,
  SOURCES.mintIcon,
  SOURCES.presenceDot,
];

// ── AccountRow ──────────────────────────────────────────────────

const FIXTURE_PUBKEY = '0f'.repeat(32);

type AccountFixture = {
  profile: ProfileEntry;
  metadata?: NostrProfileMetadata;
  isActive?: boolean;
  isPending?: boolean;
  locked?: boolean;
  /** Holds the active highlight at one frame, for the scrubber. */
  activeProgress?: SharedValue<number>;
};

function profileFixture(overrides: Partial<ProfileEntry>): ProfileEntry {
  return { accountIndex: 0, pubkey: FIXTURE_PUBKEY, addedAt: 0, ...overrides };
}

/** The drawer's row, given its cached profile as a constant: no cache read, no fetch. */
export function AccountRowFixture({
  profile,
  metadata,
  isActive,
  isPending,
  locked,
  activeProgress,
}: AccountFixture) {
  const { AccountRow } =
    require('@/navigation/AccountRow') as typeof import('@/navigation/AccountRow');

  return (
    <AccountRow
      profile={profile}
      metadata={metadata}
      isActive={isActive ?? false}
      isPending={isPending ?? false}
      locked={locked ?? false}
      displayBtc={0}
      onPress={noop}
      onOpenMenu={noop}
      activeProgress={activeProgress}
    />
  );
}

export const ACCOUNT = {
  plain: profileFixture({ cachedDisplayName: 'Satoshi', cachedBalanceSats: 21_000 }),
  handle: { nip05: 'satoshi@sovran.example', fetchedAt: 0 },
  empty: profileFixture({ accountIndex: 3 }),
  worst: profileFixture({
    accountIndex: 7,
    cachedDisplayName: WORST_NAME,
    cachedBalanceSats: WORST.hugeSats,
  }),
  worstMetadata: { nip05: WORST.handle, fetchedAt: 0 },
} as const;

// ── MintHeader ──────────────────────────────────────────────────

export const MINT = { name: 'Sovran Mint', url: 'https://mint.sovran.example/Bitcoin' } as const;

// ── ListRow / SettingsRows ──────────────────────────────────────

type RowsFixture = {
  title: string;
  subtitle: string;
  selected?: boolean;
  disabled?: boolean;
};

function RowsFixture({ title, subtitle, selected = false, disabled = false }: RowsFixture) {
  const { ListGroup, ListRow, SettingsToggleItem } = ui();
  return (
    <View className="gap-3">
      <ListRow
        title={title}
        subtitle={subtitle}
        avatar={{ seed: FIXTURE_PUBKEY, name: title, size: 44 }}
        selected={selected}
        disabled={disabled}
        onPress={noop}
        testID="design-system-ui-kit-list-row"
      />
      <ListGroup variant="secondary">
        <SettingsToggleItem
          title={title}
          description={subtitle}
          isSelected={selected}
          onSelectedChange={noop}
          disabled={disabled}
          disabledReason={disabled ? 'Turn on Network first' : undefined}
          testID="design-system-ui-kit-toggle-row"
        />
      </ListGroup>
    </View>
  );
}

const ROWS_COVERS = [SOURCES.listRow, SOURCES.settingsRows, SOURCES.avatar, SOURCES.switch];

// ── Badge / SelectableCheck / Switch ────────────────────────────

function SelectionFixture({
  selected,
  disabled = false,
}: {
  selected: boolean;
  disabled?: boolean;
}) {
  const { Badge, SelectableCheck, Switch } = ui();
  const marks = (
    <View className="flex-row flex-wrap items-center gap-4">
      <Badge variant={selected ? 'primary' : 'secondary'}>{selected ? 'Default' : 'Backup'}</Badge>
      <SelectableCheck selected={selected} disabled={disabled} accessibilityLabel="Circle mark" />
      <SelectableCheck
        selected={selected}
        disabled={disabled}
        style="square"
        variant="primary"
        accessibilityLabel="Square mark"
      />
      <Switch isSelected={selected} isDisabled={disabled} onSelectedChange={noop} />
    </View>
  );
  // A badge has no disabled look of its own; the frame dims the group.
  return disabled ? <DisabledFrame>{marks}</DisabledFrame> : marks;
}

const SELECTION_COVERS = [
  SOURCES.badge,
  SOURCES.selectableCheck,
  SOURCES.selectableCheckCircle,
  SOURCES.selectableCheckSquare,
  SOURCES.switch,
];

// ── StatsGrid ───────────────────────────────────────────────────

function stats(values: readonly [string, string, string, string]): GridStat[] {
  return [
    {
      label: 'Uptime',
      description: 'Last 30 days',
      value: values[0],
      accent: true,
      placeholder: '99.9%',
    },
    {
      label: 'Swaps',
      description: 'Audited',
      value: values[1],
      accent: true,
      placeholder: '1,234',
    },
    { label: 'Fees', description: 'Per input', value: values[2], placeholder: '0 sat' },
    { label: 'Since', description: 'First seen', value: values[3], placeholder: '2024' },
  ];
}

const STATS = {
  populated: stats(['99.9%', '1,234', '0 sat', '2024']),
  empty: stats([UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]),
  worst: stats(['100.000000%', '2,100,000,000,000,000', '21,000,000 sat', WORST.emoji]),
} as const;

function StatsFixture({ values, loading = false }: { values: GridStat[]; loading?: boolean }) {
  const { StatsGrid } = ui();
  return (
    <StatsGrid
      stats={values}
      loading={loading}
      visualKey="design-system-ui-kit-stats"
      visualSurface="design-system"
    />
  );
}

// ── GlassSearchBar ──────────────────────────────────────────────

function SearchFixture({ seedText }: { seedText?: string }) {
  const { GlassSearchBar } =
    require('@/shared/ui/composed/GlassSearchBar') as typeof import('@/shared/ui/composed/GlassSearchBar');

  return (
    <View className="h-11 flex-row">
      <GlassSearchBar
        clearKey={0}
        seedText={seedText}
        value={seedText}
        onChangeText={noop}
        onClear={noop}
        placeholder="Search"
      />
    </View>
  );
}

const SEARCH_COVERS = [SOURCES.glassSearchBarIos, SOURCES.glassSearchBarAndroid];

// ── AmountFormatter / balance hero ──────────────────────────────

/** The wallet's balance hero on fixed data: a label over one large amount. */
function BalanceHeroFixture({
  label,
  amount,
  loading = false,
  size = 44,
}: {
  label: string;
  amount: number;
  loading?: boolean;
  size?: number;
}) {
  const { AmountFormatter } = ui();
  const muted = useThemeColor('muted');

  return (
    <View className="items-center gap-1">
      <Text size={Math.round(size / 3)} color={muted} numberOfLines={2} className="text-center">
        {label}
      </Text>
      {loading ? (
        // A known-unknown, never a zero that reads as measured.
        <Text size={size} bold color={muted} accessibilityLabel="Balance loading">
          ≈ —
        </Text>
      ) : (
        <AmountFormatter amount={amount} unit="sat" displayPreference={0} size={size} centered />
      )}
    </View>
  );
}

// ── Notice, Button, MintHeader ──────────────────────────────────

type UiParts = ReturnType<typeof ui>;

function NoticeFixture(props: ComponentProps<UiParts['Notice']>) {
  const { Notice } = ui();
  return <Notice {...props} />;
}

function ButtonFixture(props: Omit<ComponentProps<UiParts['Button']>, 'onPress'>) {
  const { Button } = ui();
  return <Button {...props} onPress={noop} />;
}

function MintHeaderFixture(props: ComponentProps<UiParts['MintHeader']>) {
  const { MintHeader } = ui();
  return <MintHeader {...props} />;
}

const OFFLINE_NOTICE = {
  title: 'You’re offline',
  description: 'Balances show what this phone last saw. Payments wait until you’re back.',
} as const;

// ── Scenarios ───────────────────────────────────────────────────

export const UI_KIT_SCENARIOS = [
  // BalancePill / MintSelector
  {
    id: 'balance-pill-default',
    title: 'Balance pill · Default',
    component: 'BalancePill',
    state: 'default',
    covers: [SOURCES.balanceDisplay, SOURCES.balancePillFlat, SOURCES.balancePillLiquid],
    render: () => <BalancePillDefault />,
  },
  {
    id: 'mint-selector-populated',
    title: 'Mint selector · Populated',
    component: 'MintSelector',
    state: 'populated',
    covers: PILL_COVERS,
    render: () => <MintPillFixture title={MINT.name} balance={21_000} presence="online" />,
  },
  {
    id: 'mint-selector-loading',
    title: 'Mint selector · Loading',
    component: 'MintSelector',
    state: 'loading',
    covers: PILL_COVERS,
    render: () => <MintPillFixture title="" balance={0} isLoading />,
  },
  {
    id: 'mint-selector-empty',
    title: 'Mint selector · No mint yet',
    component: 'MintSelector',
    state: 'empty',
    covers: PILL_COVERS,
    // The wallet's own words for this state (`ADD_MINT_LABEL`).
    render: () => <MintPillFixture title="" balance={0} ctaLabel="Add a mint" />,
  },
  {
    id: 'mint-selector-offline',
    title: 'Mint selector · Mint offline',
    component: 'MintSelector',
    state: 'offline',
    covers: PILL_COVERS,
    render: () => <MintPillFixture title={MINT.name} balance={21_000} presence="offline" />,
  },
  {
    id: 'mint-selector-worst-case',
    title: 'Mint selector · Worst case',
    component: 'MintSelector',
    state: 'worst-case',
    covers: PILL_COVERS,
    render: () => <MintPillFixture title={WORST_NAME} balance={WORST.hugeSats} presence="online" />,
  },
  {
    id: 'mint-selector-large-text',
    title: 'Mint selector · Large text',
    component: 'MintSelector',
    state: 'large-text',
    covers: PILL_COVERS,
    render: () => (
      <LargeTextFrame>
        <MintPillFixture title={MINT.name} balance={21_000} presence="online" width={180} />
      </LargeTextFrame>
    ),
  },

  // AccountRow
  {
    id: 'account-row-default',
    title: 'Account row · Default',
    component: 'AccountRow',
    state: 'default',
    covers: [SOURCES.avatar, SOURCES.pressScale],
    render: () => <AccountRowFixture profile={ACCOUNT.plain} metadata={ACCOUNT.handle} />,
  },
  {
    id: 'account-row-selected',
    title: 'Account row · Active',
    component: 'AccountRow',
    state: 'selected',
    covers: [SOURCES.avatar, SOURCES.pressScale],
    render: () => <AccountRowFixture profile={ACCOUNT.plain} metadata={ACCOUNT.handle} isActive />,
  },
  {
    id: 'account-row-loading',
    title: 'Account row · Switching',
    component: 'AccountRow',
    state: 'loading',
    covers: [SOURCES.avatar, SOURCES.pressScale],
    render: () => (
      <AccountRowFixture profile={ACCOUNT.plain} metadata={ACCOUNT.handle} isPending locked />
    ),
  },
  {
    id: 'account-row-empty',
    title: 'Account row · Nothing cached',
    component: 'AccountRow',
    state: 'empty',
    covers: [SOURCES.avatar, SOURCES.pressScale],
    render: () => <AccountRowFixture profile={ACCOUNT.empty} />,
  },
  {
    id: 'account-row-worst-case',
    title: 'Account row · Worst case',
    component: 'AccountRow',
    state: 'worst-case',
    covers: [SOURCES.avatar, SOURCES.pressScale],
    render: () => <AccountRowFixture profile={ACCOUNT.worst} metadata={ACCOUNT.worstMetadata} />,
  },
  {
    id: 'account-row-large-text',
    title: 'Account row · Large text',
    component: 'AccountRow',
    state: 'large-text',
    covers: [SOURCES.avatar, SOURCES.pressScale],
    render: () => (
      <LargeTextFrame>
        <AccountRowFixture profile={ACCOUNT.plain} metadata={ACCOUNT.handle} isActive />
      </LargeTextFrame>
    ),
  },

  // MintHeader
  {
    id: 'mint-header-populated',
    title: 'Mint header · Operational',
    component: 'MintHeader',
    state: 'populated',
    covers: [SOURCES.mintHeader, SOURCES.mintIcon],
    render: () => <MintHeaderFixture name={MINT.name} mintUrl={MINT.url} health="operational" />,
  },
  {
    id: 'mint-header-error',
    title: 'Mint header · Having problems',
    component: 'MintHeader',
    state: 'error',
    covers: [SOURCES.mintHeader, SOURCES.mintIcon],
    render: () => <MintHeaderFixture name={MINT.name} mintUrl={MINT.url} health="problems" />,
  },
  {
    id: 'mint-header-offline',
    title: 'Mint header · Offline',
    component: 'MintHeader',
    state: 'offline',
    covers: [SOURCES.mintHeader, SOURCES.mintIcon],
    render: () => <MintHeaderFixture name={MINT.name} mintUrl={MINT.url} health="offline" />,
  },
  {
    id: 'mint-header-empty',
    title: 'Mint header · Not audited',
    component: 'MintHeader',
    state: 'empty',
    covers: [SOURCES.mintHeader, SOURCES.mintIcon],
    render: () => <MintHeaderFixture name={MINT.name} mintUrl={MINT.url} />,
  },
  {
    id: 'mint-header-worst-case',
    title: 'Mint header · Worst case',
    component: 'MintHeader',
    state: 'worst-case',
    covers: [SOURCES.mintHeader, SOURCES.mintIcon],
    render: () => <MintHeaderFixture name={WORST_NAME} mintUrl={WORST.host} health="problems" />,
  },
  {
    id: 'mint-header-large-text',
    title: 'Mint header · Large text',
    component: 'MintHeader',
    state: 'large-text',
    covers: [SOURCES.mintHeader, SOURCES.mintIcon],
    render: () => (
      <LargeTextFrame>
        <MintHeaderFixture name={MINT.name} mintUrl={MINT.url} health="operational" />
      </LargeTextFrame>
    ),
  },

  // ListRow / SettingsRows
  {
    id: 'rows-default',
    title: 'Rows · Default',
    component: 'ListRow',
    state: 'default',
    covers: ROWS_COVERS,
    render: () => <RowsFixture title="Sovran Mint" subtitle="mint.sovran.example" />,
  },
  {
    id: 'rows-selected',
    title: 'Rows · Selected',
    component: 'ListRow',
    state: 'selected',
    covers: ROWS_COVERS,
    render: () => <RowsFixture title="Sovran Mint" subtitle="mint.sovran.example" selected />,
  },
  {
    id: 'rows-disabled',
    title: 'Rows · Disabled',
    component: 'ListRow',
    state: 'disabled',
    covers: ROWS_COVERS,
    render: () => <RowsFixture title="Sovran Mint" subtitle="mint.sovran.example" disabled />,
  },
  {
    id: 'rows-worst-case',
    title: 'Rows · Worst case',
    component: 'ListRow',
    state: 'worst-case',
    covers: ROWS_COVERS,
    render: () => <RowsFixture title={WORST_NAME} subtitle={WORST.host} selected />,
  },
  {
    id: 'rows-large-text',
    title: 'Rows · Large text',
    component: 'ListRow',
    state: 'large-text',
    covers: ROWS_COVERS,
    render: () => (
      <LargeTextFrame>
        <RowsFixture title="Sovran Mint" subtitle="mint.sovran.example" />
      </LargeTextFrame>
    ),
  },

  // Button
  {
    id: 'button-default',
    title: 'Button · Default',
    component: 'Button',
    state: 'default',
    covers: [SOURCES.button, SOURCES.pressScale],
    render: () => (
      <View className="gap-3">
        <ButtonFixture text="Send" />
        <ButtonFixture text="Receive" variant="secondary" />
      </View>
    ),
  },
  {
    id: 'button-loading',
    title: 'Button · Loading',
    component: 'Button',
    state: 'loading',
    covers: [SOURCES.button, SOURCES.pressScale],
    render: () => (
      <View className="gap-3">
        <ButtonFixture text="Send" loading />
        <ButtonFixture text="Receive" variant="secondary" loading />
      </View>
    ),
  },
  {
    id: 'button-disabled',
    title: 'Button · Disabled',
    component: 'Button',
    state: 'disabled',
    covers: [SOURCES.button, SOURCES.pressScale],
    render: () => (
      <View className="gap-3">
        <ButtonFixture text="Send" disabled />
        <ButtonFixture text="Receive" variant="secondary" disabled />
      </View>
    ),
  },
  {
    id: 'button-worst-case',
    title: 'Button · Worst case',
    component: 'Button',
    state: 'worst-case',
    covers: [SOURCES.button, SOURCES.pressScale],
    render: () => (
      <View className="gap-3">
        <ButtonFixture text={WORST_NAME} />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <ButtonFixture text={WORST.unbroken} variant="secondary" />
          </View>
          <View className="flex-1">
            <ButtonFixture text={WORST.rtl} variant="dangerous" />
          </View>
        </View>
      </View>
    ),
  },
  {
    id: 'button-large-text',
    title: 'Button · Large text',
    component: 'Button',
    state: 'large-text',
    covers: [SOURCES.button, SOURCES.pressScale],
    render: () => (
      <LargeTextFrame>
        <ButtonFixture text="Send to a contact" />
        <ButtonFixture text="Receive" variant="secondary" />
      </LargeTextFrame>
    ),
  },

  // Badge / SelectableCheck / Switch
  {
    id: 'selection-default',
    title: 'Badge, check and switch · Default',
    component: 'SelectableCheck',
    state: 'default',
    covers: SELECTION_COVERS,
    render: () => <SelectionFixture selected={false} />,
  },
  {
    id: 'selection-selected',
    title: 'Badge, check and switch · Selected',
    component: 'SelectableCheck',
    state: 'selected',
    covers: SELECTION_COVERS,
    render: () => <SelectionFixture selected />,
  },
  {
    id: 'selection-disabled',
    title: 'Badge, check and switch · Disabled',
    component: 'SelectableCheck',
    state: 'disabled',
    covers: SELECTION_COVERS,
    render: () => <SelectionFixture selected disabled />,
  },

  // StatsGrid
  {
    id: 'stats-grid-populated',
    title: 'Stats grid · Populated',
    component: 'StatsGrid',
    state: 'populated',
    covers: [SOURCES.statsGrid],
    render: () => <StatsFixture values={STATS.populated} />,
  },
  {
    id: 'stats-grid-loading',
    title: 'Stats grid · Loading',
    component: 'StatsGrid',
    state: 'loading',
    covers: [SOURCES.statsGrid],
    render: () => <StatsFixture values={STATS.populated} loading />,
  },
  {
    id: 'stats-grid-empty',
    title: 'Stats grid · Nothing measured',
    component: 'StatsGrid',
    state: 'empty',
    covers: [SOURCES.statsGrid],
    render: () => <StatsFixture values={STATS.empty} />,
  },
  {
    id: 'stats-grid-error',
    title: 'Stats grid · Failed',
    component: 'StatsGrid',
    state: 'error',
    covers: [SOURCES.statsGrid, SOURCES.notice],
    render: () => (
      <View className="gap-3">
        <StatsFixture values={STATS.empty} />
        <NoticeFixture status="danger" size="compact" title="Couldn’t load these numbers" />
      </View>
    ),
  },
  {
    id: 'stats-grid-worst-case',
    title: 'Stats grid · Worst case',
    component: 'StatsGrid',
    state: 'worst-case',
    covers: [SOURCES.statsGrid],
    render: () => <StatsFixture values={STATS.worst} />,
  },
  {
    id: 'stats-grid-large-text',
    title: 'Stats grid · Large text',
    component: 'StatsGrid',
    state: 'large-text',
    covers: [SOURCES.statsGrid],
    render: () => (
      <LargeTextFrame>
        <StatsFixture values={STATS.populated} />
      </LargeTextFrame>
    ),
  },

  // GlassSearchBar
  {
    id: 'search-bar-empty',
    title: 'Search bar · Empty',
    component: 'GlassSearchBar',
    state: 'empty',
    covers: SEARCH_COVERS,
    render: () => <SearchFixture />,
  },
  {
    id: 'search-bar-populated',
    title: 'Search bar · With text',
    component: 'GlassSearchBar',
    state: 'populated',
    covers: SEARCH_COVERS,
    render: () => <SearchFixture seedText="sovran" />,
  },
  {
    id: 'search-bar-disabled',
    title: 'Search bar · Disabled',
    component: 'GlassSearchBar',
    state: 'disabled',
    covers: SEARCH_COVERS,
    render: () => (
      <DisabledFrame>
        <SearchFixture />
      </DisabledFrame>
    ),
  },
  {
    id: 'search-bar-worst-case',
    title: 'Search bar · Worst case',
    component: 'GlassSearchBar',
    state: 'worst-case',
    covers: SEARCH_COVERS,
    render: () => <SearchFixture seedText={WORST_NAME} />,
  },

  // AmountFormatter / balance hero
  {
    id: 'amount-populated',
    title: 'Balance · Populated',
    component: 'AmountFormatter',
    state: 'populated',
    covers: [SOURCES.amountFormatter],
    render: () => <BalanceHeroFixture label={MINT.name} amount={21_000} />,
  },
  {
    id: 'amount-empty',
    title: 'Balance · Zero',
    component: 'AmountFormatter',
    state: 'empty',
    covers: [SOURCES.amountFormatter],
    render: () => <BalanceHeroFixture label={MINT.name} amount={0} />,
  },
  {
    id: 'amount-loading',
    title: 'Balance · Loading',
    component: 'AmountFormatter',
    state: 'loading',
    covers: [SOURCES.amountFormatter, SOURCES.text],
    render: () => <BalanceHeroFixture label={MINT.name} amount={0} loading />,
  },
  {
    id: 'amount-worst-case',
    title: 'Balance · Worst case',
    component: 'AmountFormatter',
    state: 'worst-case',
    covers: [SOURCES.amountFormatter],
    render: () => <BalanceHeroFixture label={WORST_NAME} amount={WORST.hugeSats} />,
  },
  {
    id: 'amount-large-text',
    title: 'Balance · Large text',
    component: 'AmountFormatter',
    state: 'large-text',
    covers: [SOURCES.amountFormatter],
    render: () => (
      <LargeTextFrame>
        <BalanceHeroFixture
          label={MINT.name}
          amount={2_100_000}
          size={Math.round(44 * LARGE_TEXT_SCALE)}
        />
      </LargeTextFrame>
    ),
  },

  // Notice
  {
    id: 'notice-default',
    title: 'Notice · Default',
    component: 'Notice',
    state: 'default',
    covers: [SOURCES.notice],
    render: () => (
      <NoticeFixture
        status="info"
        title="Back up your wallet"
        description="Write down your recovery words so you can restore this wallet on a new phone."
      />
    ),
  },
  {
    id: 'notice-error',
    title: 'Notice · Error',
    component: 'Notice',
    state: 'error',
    covers: [SOURCES.notice],
    render: () => (
      <NoticeFixture
        status="danger"
        title="Payment failed"
        description="The mint turned this payment down. Nothing left your wallet."
      />
    ),
  },
  {
    id: 'notice-offline',
    title: 'Notice · Offline',
    component: 'Notice',
    state: 'offline',
    covers: [SOURCES.notice],
    render: () => <NoticeFixture status="warning" tone="soft" {...OFFLINE_NOTICE} />,
  },
  {
    id: 'notice-worst-case',
    title: 'Notice · Worst case',
    component: 'Notice',
    state: 'worst-case',
    covers: [SOURCES.notice],
    render: () => (
      <NoticeFixture
        status="warning"
        title={WORST_NAME}
        description={`${WORST.unbroken}${WORST.unbroken} ${WORST.rtl} ${WORST.emoji}`}
        collapseLines={3}
      />
    ),
  },
  {
    id: 'notice-large-text',
    title: 'Notice · Large text',
    component: 'Notice',
    state: 'large-text',
    covers: [SOURCES.notice],
    render: () => (
      <LargeTextFrame>
        <NoticeFixture status="warning" tone="soft" {...OFFLINE_NOTICE} />
      </LargeTextFrame>
    ),
  },
] satisfies readonly (DesignSystemScenario & {
  component: string;
  state: DesignSystemComponentState;
})[];

/** The filter bar's order: "All", then the states in the order a component moves through them. */
export const UI_KIT_FILTERS = [
  'all',
  'default',
  'populated',
  'loading',
  'empty',
  'selected',
  'disabled',
  'error',
  'offline',
  'worst-case',
  'large-text',
] as const satisfies readonly ('all' | DesignSystemComponentState)[];

export type UiKitFilter = (typeof UI_KIT_FILTERS)[number];

export const UI_KIT_FILTER_LABELS: Record<UiKitFilter, string> = {
  all: 'All',
  default: 'Default',
  populated: 'Populated',
  loading: 'Loading',
  empty: 'Empty',
  selected: 'Selected',
  disabled: 'Disabled',
  error: 'Error',
  offline: 'Offline',
  'worst-case': 'Worst case',
  'large-text': 'Large text',
};

export function uiKitScenariosFor(filter: UiKitFilter): readonly DesignSystemScenario[] {
  return filter === 'all'
    ? UI_KIT_SCENARIOS
    : UI_KIT_SCENARIOS.filter((scenario) => scenario.state === filter);
}

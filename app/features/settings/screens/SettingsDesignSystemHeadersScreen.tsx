import { SWITCHABLE_UNITS } from 'wallet';
import { MintCurrencyTabs } from '@/features/mint/components/MintCurrencyTabs';
import { HEADER_SCENARIOS } from '@/features/settings/design-system/headers';
import { useState } from 'react';
import Animated from 'react-native-reanimated';

import { Screen, useScreenOptions } from '@/shared/ui/composed/Screen';
import { useIdentityHeader } from '@/shared/ui/composed/IdentityHeader';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';

const OPTIONS = ['Gradient', 'Identity', 'Sticky tabs', 'Tab fade'] as const;
type HeaderVariant = (typeof OPTIONS)[number];
const VARIANT_ID = {
  Gradient: 'gradient',
  Identity: 'identity',
  'Sticky tabs': 'sticky-tabs',
  'Tab fade': 'tab-fade',
} as const satisfies Record<HeaderVariant, string>;
const CURRENCIES = SWITCHABLE_UNITS.map((unit) => unit.toUpperCase());
const RAILS = ['Unified', 'Lightning', 'Onchain', 'Cashu'];
const EXAMPLES = [
  'Gradient headers fade into the page on iOS and Android.',
  'Identity headers hand the avatar from the page to the navigation bar as you scroll.',
  'A compact avatar and title share one row, including Pay Alex.',
  'Pinned tabs use a solid header band. Scrolling pages keep the gradient within the navigation area.',
  'Long titles truncate within the navigation bar and leave actions reachable.',
  'System reduced motion is respected. Scroll back to restore the page identity.',
];

export function SettingsDesignSystemHeadersScreen() {
  const [variant, setVariant] = useState<HeaderVariant>('Gradient');
  const [rail, setRail] = useState('Unified');
  const [currency, setCurrency] = useState('SAT');
  const morph = useIdentityHeader({
    title: 'Headers',
    identity:
      variant === 'Identity' ? { name: 'Pay Alex', seed: 'header-example-alex' } : undefined,
    collapseAt: 96,
  });
  useScreenOptions(() => ({ headerTitle: morph.headerTitle }), [variant]);

  return (
    <Screen
      name="SettingsDesignSystemHeadersScreen"
      scroll="animated"
      scrollY={morph.scrollY}
      headerAppearance={
        variant === 'Sticky tabs' ? 'opaque' : variant === 'Tab fade' ? 'gradient-tabs' : 'gradient'
      }
      stickyContent={
        <View className="px-4 pb-2">
          <UnderlineTabs
            tabs={OPTIONS}
            selectedTab={variant}
            handleTabPress={(tab) => {
              const next = OPTIONS.find((option) => option === tab);
              if (next) setVariant(next);
            }}
          />
          {variant === 'Tab fade' ? (
            <MintCurrencyTabs
              currencies={CURRENCIES}
              selectedCurrency={currency}
              onCurrencyChange={setCurrency}
              scrollY={morph.scrollY}
            />
          ) : null}
          {variant === 'Sticky tabs' ? (
            <UnderlineTabs tabs={RAILS} selectedTab={rail} handleTabPress={setRail} />
          ) : null}
        </View>
      }>
      {morph.probe}
      <E2EAccessibilityProbe
        testID={`header-example-${VARIANT_ID[variant]}`}
        accessibilityLabel={`Header example: ${variant}`}
        value={variant === 'Tab fade' ? currency : rail}
      />
      {variant === 'Identity' ? (
        <Animated.View style={[{ alignItems: 'center', paddingVertical: 16 }, morph.contentStyle]}>
          <Avatar state="fallback" seed="header-example-alex" size={64} alt="Alex" />
          <Text bold size={22}>
            Alex
          </Text>
        </Animated.View>
      ) : null}
      {EXAMPLES.map((description, index) => (
        <View key={description} className="py-10">
          <Text bold size={20}>
            {index + 1}. {variant}
          </Text>
          <Text size={16} className="text-muted mt-4">
            {description}
          </Text>
        </View>
      ))}
      {HEADER_SCENARIOS.map((scenario) => (
        <View key={scenario.id} testID={`header-preview-${scenario.id}`}>
          {scenario.render()}
        </View>
      ))}
    </Screen>
  );
}

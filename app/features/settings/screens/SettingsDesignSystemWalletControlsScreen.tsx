import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const WALLET_CONTROLS_FAMILY = getDesignSystemFamily('wallet-controls');

export function SettingsDesignSystemWalletControlsScreen() {
  return (
    <ScreenWrapper
      name="SettingsDesignSystemWalletControlsScreen"
      scroll="custom"
      safeArea="scroll">
      <ScreenScrollView className="px-4" bottomSpacing={32}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Fixed wallet-facing states for amount output, keypads, actions, mint identity, selection,
          and transfer feedback. These previews never read a live balance, mint, or payment quote.
        </Text>
        {WALLET_CONTROLS_FAMILY.scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-wallet-controls-${scenario.id}`}>
              {scenario.render()}
            </View>
          </Section>
        ))}
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

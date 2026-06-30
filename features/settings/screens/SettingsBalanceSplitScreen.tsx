import React, { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { Card, Radio, RadioGroup, Separator } from 'heroui-native';

import {
  BALANCE_SPLIT_VARIANTS,
  BALANCE_SPLIT_VARIANT_DESCRIPTIONS,
  BALANCE_SPLIT_VARIANT_LABELS,
  isBalanceSplitVariant,
  type BalanceSplitVariant,
} from '@/shared/lib/balanceSplitVariant';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';

export function SettingsBalanceSplitScreen() {
  useLifecycleLogger('SettingsBalanceSplitScreen');
  const balanceSplitVariant = useSettingsStore((state) => state.balanceSplitVariant);
  const setBalanceSplitVariant = useSettingsStore((state) => state.setBalanceSplitVariant);

  const handleVariantChange = useCallback(
    (value: string) => {
      if (!isBalanceSplitVariant(value)) return;
      log.info('settings.balance_split.change', { variant: value });
      setBalanceSplitVariant(value);
    },
    [setBalanceSplitVariant]
  );

  return (
    <ScreenWrapper name="SettingsBalanceSplitScreen" scroll="custom" safeArea>
      <ScrollView
        className="px-4"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title="Layout">
          <Card variant="secondary">
            <Card.Body className="p-0">
              <RadioGroup value={balanceSplitVariant} onValueChange={handleVariantChange}>
                {BALANCE_SPLIT_VARIANTS.map((variant, index) => (
                  <React.Fragment key={variant}>
                    {index > 0 ? <Separator className="mx-4" /> : null}
                    <BalanceSplitVariantOption variant={variant} />
                  </React.Fragment>
                ))}
              </RadioGroup>
            </Card.Body>
          </Card>
        </Section>
      </ScrollView>
    </ScreenWrapper>
  );
}

function BalanceSplitVariantOption({ variant }: { variant: BalanceSplitVariant }) {
  const [muted] = useThemeColor(['muted'] as const);
  const label = BALANCE_SPLIT_VARIANT_LABELS[variant];
  const description = BALANCE_SPLIT_VARIANT_DESCRIPTIONS[variant];

  return (
    <RadioGroup.Item value={variant} className="px-4 py-3">
      <HStack align="center" style={{ flex: 1, gap: 12 }}>
        <VStack style={{ flex: 1 }} spacing={2}>
          <Text size={16} bold>
            {label}
          </Text>
          <Text size={13} color={muted}>
            {description}
          </Text>
        </VStack>
        <Radio accessibilityLabel={`${label} balance split layout`} />
      </HStack>
    </RadioGroup.Item>
  );
}

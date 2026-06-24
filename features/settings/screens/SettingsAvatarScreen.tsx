import React from 'react';
import { ScrollView } from 'react-native';
import { Card, Radio, RadioGroup, Separator } from 'heroui-native';

import {
  AVATAR_FALLBACK_VARIANT_LABELS,
  AVATAR_FALLBACK_VARIANTS,
  isAvatarFallbackVariant,
  type AvatarFallbackVariant,
} from '@/shared/lib/avatarFallback';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';

const PREVIEW_SEED = 'sovran-avatar-fallback-preview';

export function SettingsAvatarScreen() {
  useLifecycleLogger('SettingsAvatarScreen');
  const avatarFallbackVariant = useSettingsStore((state) => state.avatarFallbackVariant);
  const setAvatarFallbackVariant = useSettingsStore((state) => state.setAvatarFallbackVariant);

  const handleVariantChange = (value: string) => {
    if (!isAvatarFallbackVariant(value)) return;
    log.info('settings.avatar_fallback.change', { variant: value });
    setAvatarFallbackVariant(value);
  };

  return (
    <ScreenWrapper name="SettingsAvatarScreen" scroll="custom" safeArea>
      <ScrollView
        className="px-4"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title="Variation">
          <Card variant="secondary">
            <Card.Body className="p-0">
              <RadioGroup value={avatarFallbackVariant} onValueChange={handleVariantChange}>
                {AVATAR_FALLBACK_VARIANTS.map((variant, index) => (
                  <React.Fragment key={variant}>
                    {index > 0 ? <Separator className="mx-4" /> : null}
                    <AvatarFallbackVariantOption variant={variant} />
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

function AvatarFallbackVariantOption({ variant }: { variant: AvatarFallbackVariant }) {
  const label = AVATAR_FALLBACK_VARIANT_LABELS[variant];

  return (
    <RadioGroup.Item value={variant} className="px-4 py-3">
      <HStack align="center" style={{ flex: 1, gap: 12 }}>
        <Avatar
          state="fallback"
          seed={`${PREVIEW_SEED}-${variant}`}
          alt={`${label} avatar fallback preview`}
          size={40}
          fallbackVariant={variant}
        />
        <VStack style={{ flex: 1 }} spacing={2}>
          <Text size={16} bold>
            {label}
          </Text>
        </VStack>
        <Radio accessibilityLabel={`${label} avatar fallback`} />
      </HStack>
    </RadioGroup.Item>
  );
}

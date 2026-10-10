import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { useCallback } from 'react';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { SlideToConfirm } from '@/shared/ui/composed/SlideToConfirm';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { deleteAllProfiles } from '@/shared/lib/profile/profileSessionOrchestrator';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Button } from '@/shared/ui/primitives/Button';
import Icon from 'assets/icons';
import { Surface } from '@/shared/ui/composed/Surface';
import { useStylePaint } from '@/shared/styles/appStyle';
import { withAlpha } from '@/shared/lib/color';

export function DeleteScreen() {
  useLifecycleLogger('DeleteScreen');
  const foreground = useThemeColor('foreground');
  const [danger, red400] = useThemeColor(['danger', 'red-400'] as const);
  const paint = useStylePaint();
  const cardContent = { padding: paint.style.space.pad, gap: paint.style.space.related };

  const handleDelete = useCallback(async () => {
    log.warn('settings.delete.confirmed', { reason: 'user_initiated_slide_to_delete' });
    await deleteAllProfiles();
    log.info('settings.delete.complete');
  }, []);

  return (
    <ScreenWrapper name="DeleteScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView className="flex-1" contentContainerClassName="grow">
        <VStack gap={24} className="flex-1 px-6 pt-12">
          <VStack gap={24} className="flex-1 items-center justify-center">
            <View
              className="h-24 w-24 items-center justify-center self-center rounded-full"
              style={{ backgroundColor: danger }}>
              <Icon name="mdi:trash-can-outline" size={48} color={red400} />
            </View>

            <VStack gap={8} className="items-center">
              <Text size={24} bold className="text-foreground text-center">
                Delete Account
              </Text>
              <Text
                size={16}
                className="text-center leading-6"
                style={{ color: withAlpha(foreground, 0.5) }}>
                This will permanently erase all wallet data, all profiles, and all keys from this
                device. The app will restart as if freshly installed. This action cannot be
                reversed.
              </Text>
            </VStack>

            <View className="w-full">
              <Surface contentStyle={cardContent}>
                <Text semibold size={16} color={paint.text.primary}>
                  Save your NIP06
                </Text>
                <Text size={13} color={paint.text.secondary}>
                  Your NIP06 is the recovery phrase for your full Sovran account. Every Cashu
                  profile in this app is derived from it, so restoring with a different NIP06 will
                  create different Cashu wallets and will not recover the same ecash. If you were a
                  TestFlight user, recovery may still not restore all historical funds.
                </Text>
              </Surface>
            </View>

            <View className="w-full">
              <Surface contentStyle={cardContent}>
                <Text semibold size={16} color={paint.text.primary}>
                  Imported Nostr accounts
                </Text>
                <Text size={13} color={paint.text.secondary}>
                  Even imported Nostr accounts depend on your current NIP06 for their Cashu profile.
                  Re-importing the same Nostr key under a different NIP06 will produce a different
                  Cashu profile, so that ecash will not be recoverable.
                </Text>
              </Surface>
            </View>

            <View className="w-full">
              <Surface contentStyle={cardContent}>
                <Text semibold size={16} color={paint.text.primary}>
                  Before deleting, make sure you have:
                </Text>
                <Text size={13} color={paint.text.secondary}>
                  - Backed up your NIP06{'\n'}- Transferred any ecash you do not want to risk
                  {'\n'}- Exported any important data
                </Text>
              </Surface>
            </View>
          </VStack>

          <VStack gap={12} className="w-full items-center pb-6">
            <SlideToConfirm
              onConfirm={handleDelete}
              iconName="mdi:trash-can-outline"
              label="Swipe to delete →"
              trackColor={danger}
              thumbColor={foreground}
              textColor={foreground}
              iconColor={danger}
              testID="settings-delete-slider"
            />
            <View className="w-full">
              <Button
                variant="secondary"
                text="Cancel"
                testID="settings-delete-cancel"
                onPress={() => router.back()}
              />
            </View>
          </VStack>
        </VStack>
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

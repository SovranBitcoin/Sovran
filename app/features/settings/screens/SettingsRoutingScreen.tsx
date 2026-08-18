import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import {
  useSettingsStore,
  type MiddlemanRoutingSettings,
} from '@/shared/stores/global/settingsStore';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Section } from '@/shared/ui/composed/Section';
import Icon from 'assets/icons';
import {
  Card,
  Label,
  ListGroup,
  RadioGroup,
  Separator,
  Slider,
  Switch as HeroSwitch,
} from 'heroui-native';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SettingsRoutingScreen() {
  useLifecycleLogger('SettingsRoutingScreen');
  const middlemanRouting = useSettingsStore((state) => state.middlemanRouting);
  const setMiddlemanRouting = useSettingsStore((state) => state.setMiddlemanRouting);
  const minTransferThreshold = useSettingsStore((state) => state.minTransferThreshold);
  const setMinTransferThreshold = useSettingsStore((state) => state.setMinTransferThreshold);

  const update = useCallback(
    (partial: Partial<MiddlemanRoutingSettings>) => {
      log.info('settings.routing.change', { ...partial });
      setMiddlemanRouting(partial);
    },
    [setMiddlemanRouting]
  );

  const asNumber = (value: number | number[]) => (Array.isArray(value) ? (value[0] ?? 0) : value);
  // Snap to slider step so a stored rate that isn't a multiple of 5 doesn't
  // display as e.g. "73%" while the thumb sits between stops.
  const snapSuccessRate = (rate: number) => Math.round((rate * 100) / 5) * 5;

  return (
    <ScreenWrapper name="SettingsRoutingScreen" scroll="custom" safeArea>
      <ScrollView
        className="px-4"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title="Rebalancing">
          <VStack gap={12}>
            <Card variant="secondary">
              <Card.Body className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Label>Min transfer amount</Label>
                  <Text>{`${minTransferThreshold} sat`}</Text>
                </View>
                <Slider
                  value={minTransferThreshold}
                  minValue={1}
                  maxValue={50}
                  step={1}
                  onChangeEnd={(value) => setMinTransferThreshold(asNumber(value))}>
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
                <Card.Description>
                  Transfers below this amount are skipped during rebalancing to avoid noisy,
                  fee-inefficient steps.
                </Card.Description>
              </Card.Body>
            </Card>
          </VStack>
        </Section>

        <Section title="Middleman Routing">
          <VStack gap={12}>
            <Card variant="secondary">
              <Card.Body className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Label>Max intermediaries</Label>
                  <Text>{middlemanRouting.maxHops}</Text>
                </View>
                <Slider
                  value={middlemanRouting.maxHops}
                  minValue={1}
                  maxValue={3}
                  step={1}
                  onChangeEnd={(value) => update({ maxHops: asNumber(value) })}>
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
                <Card.Description>
                  How many middleman mints can be chained together (1 = A→via→B, 2 = A→via1→via2→B).
                </Card.Description>
              </Card.Body>
            </Card>

            <Card variant="secondary">
              <Card.Body className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Label>Max fee</Label>
                  <Text>{`${middlemanRouting.maxFee} sat`}</Text>
                </View>
                <Slider
                  value={middlemanRouting.maxFee}
                  minValue={1}
                  maxValue={50}
                  step={1}
                  onChangeEnd={(value) => update({ maxFee: asNumber(value) })}>
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
                <Card.Description>
                  Maximum total fee (in sats) allowed across all hops of an intermediary route.
                </Card.Description>
              </Card.Body>
            </Card>

            <Card variant="secondary">
              <Card.Body className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Label>Min success rate</Label>
                  <Text>{`${snapSuccessRate(middlemanRouting.minSuccessRate)}%`}</Text>
                </View>
                <Slider
                  value={snapSuccessRate(middlemanRouting.minSuccessRate)}
                  minValue={50}
                  maxValue={100}
                  step={5}
                  onChangeEnd={(value) => update({ minSuccessRate: asNumber(value) / 100 })}>
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
                <Card.Description>
                  Minimum percentage of successful swaps required for each edge in the route.
                </Card.Description>
              </Card.Body>
            </Card>

            <ListGroup variant="secondary">
              <ListGroup.Item>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Last swap must be OK</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    Require the most recent swap on each edge to have been successful.
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <HeroSwitch
                    isSelected={middlemanRouting.requireLastOk}
                    onSelectedChange={(v) => update({ requireLastOk: v })}
                  />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </ListGroup>
          </VStack>
        </Section>

        <Section title="Mint Trust">
          <VStack gap={12}>
            <Card variant="secondary">
              <Card.Body className="gap-3">
                <VStack>
                  <Text size={16}>Intermediary trust policy</Text>
                  <Card.Description>
                    Controls which mints can act as middlemen. Trusted mints are always preferred
                    regardless of this setting.
                  </Card.Description>
                </VStack>

                <RadioGroup
                  value={middlemanRouting.trustMode}
                  onValueChange={(value) => {
                    if (value === 'trusted_only' || value === 'allow_untrusted') {
                      update({ trustMode: value });
                    }
                  }}>
                  <RadioGroup.Item value="trusted_only">Trusted only</RadioGroup.Item>
                  <Separator className="my-1" />
                  <RadioGroup.Item value="allow_untrusted">Allow untrusted</RadioGroup.Item>
                </RadioGroup>

                {middlemanRouting.trustMode === 'allow_untrusted' ? (
                  <View className="flex-row items-start gap-2">
                    <Icon
                      name="mdi:alert-circle-outline"
                      size={16}
                      color="#f59e0b"
                      style={{ marginTop: 2 }}
                    />
                    <Text size={12} className="flex-1" style={{ color: '#f59e0b' }}>
                      Untrusted mints will be temporarily trusted for the swap and untrusted
                      afterward. Your ecash passes through mints you have not verified. Only use
                      this with small amounts.
                    </Text>
                  </View>
                ) : null}
              </Card.Body>
            </Card>
          </VStack>
        </Section>
      </ScrollView>
    </ScreenWrapper>
  );
}

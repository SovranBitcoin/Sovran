import React, { useCallback } from 'react';
import { ScrollView, Switch } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { useSettingsStore, type MiddlemanRoutingSettings } from 'stores/settingsStore';
import Container from 'components/blocks/Container';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Section } from './index';
import Icon from 'assets/icons';

// ---------------------------------------------------------------------------
// Stepper – a simple +/- row for integer or percentage values
// ---------------------------------------------------------------------------

const Stepper: React.FC<{
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  description?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ value, min, max, step = 1, label, description, format, onChange }) => {
  const { getPrimaryColor, getShadeColor } = useTheme();

  const decrement = useCallback(() => {
    const next = Math.max(min, value - step);
    onChange(next);
  }, [value, min, step, onChange]);

  const increment = useCallback(() => {
    const next = Math.min(max, value + step);
    onChange(next);
  }, [value, max, step, onChange]);

  const displayValue = format ? format(value) : String(value);
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <View
      style={{
        backgroundColor: getPrimaryColor('900'),
        borderRadius: 12,
        padding: 16,
      }}>
      <HStack align="center" justify="space-between">
        <VStack flex={1} style={{ marginRight: 12 }}>
          <Text size={16} style={{ color: getPrimaryColor('0') }}>
            {label}
          </Text>
          {description && (
            <Text
              size={13}
              style={{
                color: getPrimaryColor('400'),
                marginTop: 4,
              }}>
              {description}
            </Text>
          )}
        </VStack>

        <HStack align="center" gap={2}>
          <TouchableOpacity
            onPress={decrement}
            disabled={atMin}
            haptics
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: atMin ? getPrimaryColor('800') : getPrimaryColor('700'),
              opacity: atMin ? 0.4 : 1,
            }}>
            <Icon name="mdi:minus" size={18} color={getPrimaryColor('0')} />
          </TouchableOpacity>

          <View
            style={{
              minWidth: 56,
              height: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: getShadeColor('800'),
            }}>
            <Text bold overpass size={15} style={{ color: getPrimaryColor('0') }}>
              {displayValue}
            </Text>
          </View>

          <TouchableOpacity
            onPress={increment}
            disabled={atMax}
            haptics
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: atMax ? getPrimaryColor('800') : getPrimaryColor('700'),
              opacity: atMax ? 0.4 : 1,
            }}>
            <Icon name="mdi:plus" size={18} color={getPrimaryColor('0')} />
          </TouchableOpacity>
        </HStack>
      </HStack>
    </View>
  );
};

// ---------------------------------------------------------------------------
// TrustModeOption – pill-style selector for trust mode
// ---------------------------------------------------------------------------

const TrustModeOption: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => {
  const { getPrimaryColor, getShadeColor } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      haptics
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
        backgroundColor: active ? getShadeColor('700') : getPrimaryColor('800'),
        borderWidth: 1,
        borderColor: active ? getShadeColor('500') : getPrimaryColor('700'),
      }}>
      <Text
        bold={active}
        overpass
        size={13}
        style={{
          color: active ? getPrimaryColor('0') : getPrimaryColor('400'),
        }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

function RoutingSettingsScreen() {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const middlemanRouting = useSettingsStore((state) => state.middlemanRouting);
  const setMiddlemanRouting = useSettingsStore((state) => state.setMiddlemanRouting);
  const minTransferThreshold = useSettingsStore((state) => state.minTransferThreshold);
  const setMinTransferThreshold = useSettingsStore((state) => state.setMinTransferThreshold);

  const update = useCallback(
    (partial: Partial<MiddlemanRoutingSettings>) => {
      setMiddlemanRouting(partial);
    },
    [setMiddlemanRouting]
  );

  return (
    <Container>
      <ScrollView style={{ paddingHorizontal: 16 }}>
        <Section title="Rebalancing">
          <VStack gap={12}>
            <Stepper
              label="Min transfer amount"
              description="Transfers below this amount are skipped during rebalancing to avoid noisy, fee-inefficient steps."
              value={minTransferThreshold}
              min={1}
              max={50}
              format={(v) => `${v} sat`}
              onChange={setMinTransferThreshold}
            />
          </VStack>
        </Section>

        <Section title="Middleman Routing">
          <VStack gap={12}>
            <Stepper
              label="Max intermediaries"
              description="How many middleman mints can be chained together (1 = A→via→B, 2 = A→via1→via2→B)."
              value={middlemanRouting.maxHops}
              min={1}
              max={3}
              onChange={(v) => update({ maxHops: v })}
            />

            <Stepper
              label="Max fee"
              description="Maximum total fee (in sats) allowed across all hops of an intermediary route."
              value={middlemanRouting.maxFee}
              min={1}
              max={50}
              format={(v) => `${v} sat`}
              onChange={(v) => update({ maxFee: v })}
            />

            <Stepper
              label="Min success rate"
              description="Minimum percentage of successful swaps required for each edge in the route."
              value={Math.round(middlemanRouting.minSuccessRate * 100)}
              min={50}
              max={100}
              step={5}
              format={(v) => `${v}%`}
              onChange={(v) => update({ minSuccessRate: v / 100 })}
            />

            <View
              style={{
                backgroundColor: getPrimaryColor('900'),
                borderRadius: 12,
                padding: 16,
              }}>
              <HStack align="center" justify="space-between">
                <VStack flex={1} style={{ marginRight: 12 }}>
                  <Text size={16} style={{ color: getPrimaryColor('0') }}>
                    Last swap must be OK
                  </Text>
                  <Text
                    size={13}
                    style={{
                      color: getPrimaryColor('400'),
                      marginTop: 4,
                    }}>
                    Require the most recent swap on each edge to have been successful.
                  </Text>
                </VStack>
                <Switch
                  value={middlemanRouting.requireLastOk}
                  onValueChange={(v) => update({ requireLastOk: v })}
                  trackColor={{
                    false: getPrimaryColor('700'),
                    true: getShadeColor('300'),
                  }}
                  thumbColor={getPrimaryColor('0')}
                />
              </HStack>
            </View>
          </VStack>
        </Section>

        <Section title="Mint Trust">
          <VStack gap={12}>
            <View
              style={{
                backgroundColor: getPrimaryColor('900'),
                borderRadius: 12,
                padding: 16,
              }}>
              <VStack gap={12}>
                <VStack>
                  <Text size={16} style={{ color: getPrimaryColor('0') }}>
                    Intermediary trust policy
                  </Text>
                  <Text
                    size={13}
                    style={{
                      color: getPrimaryColor('400'),
                      marginTop: 4,
                    }}>
                    Controls which mints can act as middlemen. Trusted mints are always preferred
                    regardless of this setting.
                  </Text>
                </VStack>

                <HStack gap={8}>
                  <TrustModeOption
                    label="Trusted only"
                    active={middlemanRouting.trustMode === 'trusted_only'}
                    onPress={() => update({ trustMode: 'trusted_only' })}
                  />
                  <TrustModeOption
                    label="Allow untrusted"
                    active={middlemanRouting.trustMode === 'allow_untrusted'}
                    onPress={() => update({ trustMode: 'allow_untrusted' })}
                  />
                </HStack>

                {middlemanRouting.trustMode === 'allow_untrusted' && (
                  <HStack gap={8} align="flex-start">
                    <Icon
                      name="mdi:alert-circle-outline"
                      size={16}
                      color="#f59e0b"
                      style={{ marginTop: 2 }}
                    />
                    <Text size={12} style={{ color: '#f59e0b', flex: 1 }}>
                      Untrusted mints will be temporarily trusted for the swap and untrusted
                      afterward. Your ecash passes through mints you have not verified. Only use
                      this with small amounts.
                    </Text>
                  </HStack>
                )}
              </VStack>
            </View>
          </VStack>
        </Section>
      </ScrollView>
    </Container>
  );
}

export default withSheetProvider(RoutingSettingsScreen);

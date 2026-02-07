import React, { useCallback } from 'react';
import { ScrollView, Switch, StyleSheet } from 'react-native';
import { Host, Picker, Text as ExpoText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
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
      style={[
        styles.card,
        {
          backgroundColor: getPrimaryColor('900'),
        },
      ]}>
      <HStack align="center" justify="space-between">
        <VStack flex={1} style={styles.labelContainer}>
          <Text size={16} style={{ color: getPrimaryColor('0') }}>
            {label}
          </Text>
          {description ? (
            <Text size={13} style={[styles.description, { color: getPrimaryColor('400') }]}>
              {description}
            </Text>
          ) : null}
        </VStack>

        <HStack align="center" gap={2}>
          <TouchableOpacity
            onPress={decrement}
            disabled={atMin}
            haptics
            style={[
              styles.stepperButton,
              {
                backgroundColor: atMin ? getPrimaryColor('800') : getPrimaryColor('700'),
                opacity: atMin ? 0.4 : 1,
              },
            ]}>
            <Icon name="mdi:minus" size={18} color={getPrimaryColor('0')} />
          </TouchableOpacity>

          <View
            style={[
              styles.stepperValue,
              {
                backgroundColor: getShadeColor('800'),
              },
            ]}>
            <Text bold overpass size={15} style={{ color: getPrimaryColor('0') }}>
              {displayValue}
            </Text>
          </View>

          <TouchableOpacity
            onPress={increment}
            disabled={atMax}
            haptics
            style={[
              styles.stepperButton,
              {
                backgroundColor: atMax ? getPrimaryColor('800') : getPrimaryColor('700'),
                opacity: atMax ? 0.4 : 1,
              },
            ]}>
            <Icon name="mdi:plus" size={18} color={getPrimaryColor('0')} />
          </TouchableOpacity>
        </HStack>
      </HStack>
    </View>
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
      <ScrollView
        style={styles.scrollView}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}>
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
              style={[
                styles.card,
                {
                  backgroundColor: getPrimaryColor('900'),
                },
              ]}>
              <HStack align="center" justify="space-between">
                <VStack flex={1} style={styles.labelContainer}>
                  <Text size={16} style={{ color: getPrimaryColor('0') }}>
                    Last swap must be OK
                  </Text>
                  <Text size={13} style={[styles.description, { color: getPrimaryColor('400') }]}>
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
              style={[
                styles.card,
                {
                  backgroundColor: getPrimaryColor('900'),
                },
              ]}>
              <VStack gap={12}>
                <VStack>
                  <Text size={16} style={{ color: getPrimaryColor('0') }}>
                    Intermediary trust policy
                  </Text>
                  <Text size={13} style={[styles.description, { color: getPrimaryColor('400') }]}>
                    Controls which mints can act as middlemen. Trusted mints are always preferred
                    regardless of this setting.
                  </Text>
                </VStack>

                <Host matchContents>
                  <Picker
                    selection={middlemanRouting.trustMode}
                    onSelectionChange={(value) => {
                      if (value === 'trusted_only' || value === 'allow_untrusted') {
                        update({ trustMode: value });
                      }
                    }}
                    modifiers={[pickerStyle('segmented')]}>
                    <ExpoText modifiers={[tag('trusted_only')]}>Trusted only</ExpoText>
                    <ExpoText modifiers={[tag('allow_untrusted')]}>Allow untrusted</ExpoText>
                  </Picker>
                </Host>

                {middlemanRouting.trustMode === 'allow_untrusted' ? (
                  <HStack gap={8} align="flex-start">
                    <Icon
                      name="mdi:alert-circle-outline"
                      size={16}
                      color="#f59e0b"
                      style={styles.warningIcon}
                    />
                    <Text size={12} style={styles.warningText}>
                      Untrusted mints will be temporarily trusted for the swap and untrusted
                      afterward. Your ecash passes through mints you have not verified. Only use
                      this with small amounts.
                    </Text>
                  </HStack>
                ) : null}
              </VStack>
            </View>
          </VStack>
        </Section>
      </ScrollView>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  card: {
    borderRadius: 12,
    borderCurve: 'continuous',
    padding: 16,
  },
  labelContainer: {
    marginRight: 12,
  },
  description: {
    marginTop: 4,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 56,
    height: 32,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningIcon: {
    marginTop: 2,
  },
  warningText: {
    color: '#f59e0b',
    flex: 1,
  },
});

export default withSheetProvider(RoutingSettingsScreen);

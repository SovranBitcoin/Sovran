import React, { useCallback } from 'react';
import { ScrollView, Switch, StyleSheet } from 'react-native';
import { Host, Picker, Stepper as ExpoStepper, Text as ExpoText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from 'providers/ThemeProvider';
import { useSettingsStore, type MiddlemanRoutingSettings } from 'stores/settingsStore';
import Container from 'components/blocks/Container';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { Section } from './index';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';

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
            <View
              style={[
                styles.card,
                {
                  backgroundColor: getPrimaryColor('900'),
                },
              ]}>
              <VStack gap={8}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Min transfer amount
                </Text>
                <Host matchContents>
                  <ExpoStepper
                    label={`${minTransferThreshold} sat`}
                    defaultValue={minTransferThreshold}
                    min={1}
                    max={50}
                    step={1}
                    onValueChanged={setMinTransferThreshold}
                  />
                </Host>
                <Text
                  size={13}
                  style={[styles.description, { color: opacity(getPrimaryColor('0'), 0.4) }]}>
                  Transfers below this amount are skipped during rebalancing to avoid noisy,
                  fee-inefficient steps.
                </Text>
              </VStack>
            </View>
          </VStack>
        </Section>

        <Section title="Middleman Routing">
          <VStack gap={12}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: getPrimaryColor('900'),
                },
              ]}>
              <VStack gap={8}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Max intermediaries
                </Text>
                <Host matchContents>
                  <ExpoStepper
                    label={`${middlemanRouting.maxHops}`}
                    defaultValue={middlemanRouting.maxHops}
                    min={1}
                    max={3}
                    step={1}
                    onValueChanged={(v) => update({ maxHops: v })}
                  />
                </Host>
                <Text
                  size={13}
                  style={[styles.description, { color: opacity(getPrimaryColor('0'), 0.4) }]}>
                  How many middleman mints can be chained together (1 = A→via→B, 2 = A→via1→via2→B).
                </Text>
              </VStack>
            </View>

            <View
              style={[
                styles.card,
                {
                  backgroundColor: getPrimaryColor('900'),
                },
              ]}>
              <VStack gap={8}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Max fee
                </Text>
                <Host matchContents>
                  <ExpoStepper
                    label={`${middlemanRouting.maxFee} sat`}
                    defaultValue={middlemanRouting.maxFee}
                    min={1}
                    max={50}
                    step={1}
                    onValueChanged={(v) => update({ maxFee: v })}
                  />
                </Host>
                <Text
                  size={13}
                  style={[styles.description, { color: opacity(getPrimaryColor('0'), 0.4) }]}>
                  Maximum total fee (in sats) allowed across all hops of an intermediary route.
                </Text>
              </VStack>
            </View>

            <View
              style={[
                styles.card,
                {
                  backgroundColor: getPrimaryColor('900'),
                },
              ]}>
              <VStack gap={8}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Min success rate
                </Text>
                <Host matchContents>
                  <ExpoStepper
                    label={`${Math.round(middlemanRouting.minSuccessRate * 100)}%`}
                    defaultValue={Math.round(middlemanRouting.minSuccessRate * 100)}
                    min={50}
                    max={100}
                    step={5}
                    onValueChanged={(v) => update({ minSuccessRate: v / 100 })}
                  />
                </Host>
                <Text
                  size={13}
                  style={[styles.description, { color: opacity(getPrimaryColor('0'), 0.4) }]}>
                  Minimum percentage of successful swaps required for each edge in the route.
                </Text>
              </VStack>
            </View>

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
                  <Text
                    size={13}
                    style={[styles.description, { color: opacity(getPrimaryColor('0'), 0.4) }]}>
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
                  <Text
                    size={13}
                    style={[styles.description, { color: opacity(getPrimaryColor('0'), 0.4) }]}>
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
  warningIcon: {
    marginTop: 2,
  },
  warningText: {
    color: '#f59e0b',
    flex: 1,
  },
});

export default withSheetProvider(RoutingSettingsScreen);

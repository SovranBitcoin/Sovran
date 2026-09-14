import { Fragment, useState } from 'react';
import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';

import Icon from '@/assets/icons';
import {
  REASON_LAST_RAIL,
  type Bip321RailSelection,
} from '@/features/receive/lib/bip321RailSelection';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { paymentLog } from '@/shared/lib/logger';
import type { Bip321RailId } from '@/shared/stores/profile/mintStore';
import { CopyRequestRow } from '@/shared/ui/composed/CopyRequestCard';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

export function Bip321CustomizationCard({
  selection,
  muted,
  display,
  loading = false,
  reveal = false,
  onCopy,
  onRailToggle,
}: {
  selection: Bip321RailSelection;
  muted: string;
  display?: string;
  /** The URI is still composing: keep the card (Advanced included — it is
   *  coming regardless) and scramble the copy row until it lands. */
  loading?: boolean;
  /** `display` just landed from a fetch: play the copy row's decode once. */
  reveal?: boolean;
  onCopy: () => Promise<void>;
  onRailToggle: (id: Bip321RailId, enabled: boolean) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const stateValue = selection.rails
    .map((rail) => `${rail.id}:${rail.state === 'included' ? '1' : '0'}`)
    .join(',');

  return (
    <View className="mx-4">
      <Section title="Unified">
        <GradientCard>
          <ListGroup variant="transparent">
            {display || loading ? (
              <>
                <CopyRequestRow
                  icon="stash:qr-code"
                  display={display ?? ''}
                  loading={loading}
                  reveal={reveal}
                  muted={muted}
                  onPress={loading ? undefined : onCopy}
                  testID="receive-unified-copy"
                  accessibilityLabel="Copy Unified request"
                />
                <Separator className="mx-4" />
              </>
            ) : null}
            <PressableFeedback
              animation={false}
              testID="receive-unified-advanced-toggle"
              accessibilityRole="button"
              accessibilityLabel="Advanced Unified options"
              accessibilityState={{ expanded: advancedOpen }}
              onPress={() => {
                paymentLog.info('receive.unified.advanced_toggled', { open: !advancedOpen });
                setAdvancedOpen(!advancedOpen);
              }}>
              <PressableFeedback.Scale>
                <ListGroup.Item disabled>
                  <ListGroup.ItemPrefix>
                    <Icon name="material-symbols:settings-rounded" size={20} color={muted} />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Advanced</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon
                      name={advancedOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                      size={20}
                      color={muted}
                    />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
            {advancedOpen
              ? selection.rails.map((rail) => {
                  const enabled = rail.state === 'included';
                  const disabled = rail.state === 'unavailable' || rail.reason === REASON_LAST_RAIL;
                  return (
                    <Fragment key={rail.id}>
                      <Separator className="mx-4" />
                      <PressableFeedback
                        animation={false}
                        testID={`receive-unified-rail-switch-${rail.id}`}
                        accessibilityRole="switch"
                        accessibilityLabel={rail.label}
                        accessibilityHint={rail.reason}
                        accessibilityState={{ checked: enabled, disabled }}
                        accessibilityValue={{ text: enabled ? '1' : '0' }}
                        isDisabled={disabled}
                        onPress={() => {
                          if (!disabled) onRailToggle(rail.id, !enabled);
                        }}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{rail.label}</ListGroup.ItemTitle>
                              {rail.reason ? (
                                <ListGroup.ItemDescription>{rail.reason}</ListGroup.ItemDescription>
                              ) : null}
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <View
                                pointerEvents="none"
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants">
                                <HeroSwitch isSelected={enabled} isDisabled={disabled} />
                              </View>
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    </Fragment>
                  );
                })
              : null}
          </ListGroup>
        </GradientCard>
        {advancedOpen ? (
          <Text size={12} className="text-muted mt-2">
            Unified requests never include a Lightning invoice — invoices are single-use.
          </Text>
        ) : null}
      </Section>
      <E2EAccessibilityProbe
        testID="receive-unified-rails-state"
        accessibilityLabel="Unified methods enabled"
        value={stateValue}
      />
    </View>
  );
}

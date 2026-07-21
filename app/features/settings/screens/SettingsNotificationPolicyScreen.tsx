import React, { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';

import type { FeedNotificationPolicy } from '@/features/feed/data/feedClient';
import { notificationPolicyLabel } from '@/features/feed/lib/notificationCopy';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';

const NOTIFICATION_POLICIES: readonly FeedNotificationPolicy[] = [
  'FOLLOWS',
  'STRICT',
  'MODERATE',
  'RELAXED',
];

const POLICY_DESCRIPTIONS: Record<FeedNotificationPolicy, string> = {
  FOLLOWS: 'Only notifications from people you follow.',
  STRICT: 'Prefer high-signal notifications from trusted parts of the network.',
  MODERATE: 'Balance relevance with a broader notification surface.',
  RELAXED: 'Show the widest set of notification events.',
};

export function SettingsNotificationPolicyScreen() {
  useLifecycleLogger('SettingsNotificationPolicyScreen');
  const policy = useNotificationPolicyStore((state) => state.policy);
  const setPolicy = useNotificationPolicyStore((state) => state.setPolicy);

  const handlePolicyChange = useCallback(
    (value: FeedNotificationPolicy) => {
      log.info('settings.notification_policy.change', { policy: value });
      setPolicy(value);
    },
    [setPolicy]
  );

  return (
    <ScreenWrapper name="SettingsNotificationPolicyScreen" scroll="custom" safeArea>
      <ScrollView
        className="px-4"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title="Policy">
          <ListGroup variant="secondary">
            {NOTIFICATION_POLICIES.map((option, index) => (
              <React.Fragment key={option}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <SelectableSettingsRow
                  title={notificationPolicyLabel(option)}
                  description={POLICY_DESCRIPTIONS[option]}
                  selected={policy === option}
                  onPress={() => handlePolicyChange(option)}
                  testID={`notification-policy-${option.toLowerCase()}`}
                />
              </React.Fragment>
            ))}
          </ListGroup>
        </Section>
      </ScrollView>
    </ScreenWrapper>
  );
}

function SelectableSettingsRow({
  title,
  description,
  selected,
  onPress,
  testID,
}: {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      testID={testID}
      accessible={!!testID}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked: selected }}
      accessibilityValue={testID ? { text: selected ? '1' : '0' } : undefined}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            {/* The row Pressable owns the press; the check is a pure-visual mark. */}
            <SelectableCheck selected={selected} style="square" variant="primary" />
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from 'assets/icons';
import { Button } from '@/shared/ui/primitives/Button';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useWhitenoiseSetup } from '../hooks/useWhitenoiseSetup';
import { MarmotIcon } from '../components/MarmotIcon';

export function WhitenoiseSetupScreen() {
  const router = useRouter();
  const { isReady, isLoading, isBootstrapping, keyPackageCount, error, bootstrap } =
    useWhitenoiseSetup();
  const [foreground, foregroundSecondary, accent, danger] = useThemeColor([
    'foreground',
    'surface-secondary-foreground',
    'accent',
    'danger',
  ]);

  const bottomButtons = (
    <BottomButtons>
      {isReady ? (
        <Button
          text="All set — close"
          variant="primary"
          onPress={() => router.back()}
          testID="whitenoise-setup-close"
        />
      ) : (
        <Button
          text={isBootstrapping ? 'Setting up…' : 'Set up White Noise'}
          variant="primary"
          loading={isBootstrapping}
          disabled={isLoading || isBootstrapping}
          onPress={bootstrap}
          testID="whitenoise-setup-start"
        />
      )}
    </BottomButtons>
  );

  return (
    <Screen name="WhitenoiseSetupScreen" contentPadding={24} footer={bottomButtons}>
      <View style={styles.iconCircle}>
        <MarmotIcon size={64} />
      </View>

      <Text style={[styles.title, { color: foreground }]}>White Noise</Text>
      <Text style={[styles.subtitle, { color: foregroundSecondary }]}>
        End-to-end encrypted messaging via the Marmot Protocol (MLS over Nostr).
      </Text>

      <View style={styles.bullets}>
        <Bullet
          color={foregroundSecondary}
          icon="mdi:check-circle"
          accent={accent}
          text="Forward secrecy and post-compromise security"
        />
        <Bullet
          color={foregroundSecondary}
          icon="mdi:check-circle"
          accent={accent}
          text="1:1 messages and group chats"
        />
        <Bullet
          color={foregroundSecondary}
          icon="mdi:check-circle"
          accent={accent}
          text="Encrypted at rest on this device"
        />
      </View>

      <View style={styles.statusRow}>
        <Text style={[styles.statusLabel, { color: foregroundSecondary }]}>Key packages</Text>
        <Text style={[styles.statusValue, { color: foreground }]}>{keyPackageCount} / 2</Text>
      </View>

      {error ? (
        <Text style={[styles.error, { color: danger }]} testID="whitenoise-setup-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

function Bullet({
  color,
  accent,
  icon,
  text,
}: {
  color: string;
  accent: string;
  icon: string;
  text: string;
}) {
  return (
    <View style={styles.bullet}>
      <Icon name={icon} size={18} color={accent} />
      <Text style={[styles.bulletText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 16,
  },
  bullets: {
    gap: 12,
    marginTop: 16,
  },
  bullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginTop: 16,
  },
  statusLabel: {
    fontSize: 14,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  error: {
    fontSize: 13,
    marginTop: 8,
  },
});

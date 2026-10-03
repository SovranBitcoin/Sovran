import { View } from 'react-native';
import * as nip19 from 'nostr-tools/nip19';
import Icon from '@/assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNip05Verification, type Nip05State } from '@/shared/hooks/useNip05Verification';
import { parseNip05Identifier } from 'wallet';
import { staticColor } from '@/shared/lib/themeEngine';

export function Nip05Status({
  address,
  state,
  testID,
  detail = false,
}: {
  address: string;
  state: Nip05State;
  testID?: string;
  detail?: boolean;
}) {
  const muted = useThemeColor('muted');
  const display = parseNip05Identifier(address)?.identifier ?? address;
  const presentation = {
    verified: {
      icon: 'mdi:check-decagram',
      color: staticColor['blue-300'],
      label: 'Domain matches this key',
    },
    mismatch: {
      icon: 'mdi:alert-circle-outline',
      color: staticColor['red-300'],
      label: 'Does not match this key',
    },
    error: {
      icon: 'mdi:alert-circle-outline',
      color: staticColor['red-300'],
      label: 'Could not verify',
    },
    pending: { icon: 'mdi:at', color: muted, label: 'Not verified' },
    none: { icon: 'mdi:at', color: muted, label: 'Not verified' },
  }[state.status];
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${display}. ${presentation.label}`}
      className="min-w-0 shrink">
      <View className="flex-row items-center gap-1">
        <Icon name={presentation.icon} size={13} color={presentation.color} />
        <Text
          size={12}
          color={presentation.color}
          numberOfLines={detail ? undefined : 1}
          ellipsizeMode="middle"
          className="shrink">
          {display}
        </Text>
      </View>
      {detail && (
        <Text size={12} color={presentation.color}>
          {presentation.label}
        </Text>
      )}
    </View>
  );
}

/** A checkmark belongs to the domain assertion, never to a name or avatar. */
export function Nip05Identity({
  address,
  pubkey,
  testID,
  detail,
}: {
  address: string;
  pubkey: string;
  testID?: string;
  detail?: boolean;
}) {
  const { state } = useNip05Verification(address, pubkey);
  return <Nip05Status address={address} state={state} testID={testID} detail={detail} />;
}

/** Payment counterparties retain a key fingerprint even when they claim no domain identity. */
export function PaymentIdentity({ pubkey, address }: { pubkey?: string; address?: string | null }) {
  if (!pubkey || !/^[a-f0-9]{64}$/.test(pubkey)) return null;
  return (
    <View className="items-center gap-1 px-4 py-2">
      {address ? (
        <Nip05Identity address={address} pubkey={pubkey} testID="payment-identity-nip05" detail />
      ) : null}
      <Text
        testID="payment-identity-key"
        size={12}
        className="text-muted"
        numberOfLines={1}
        ellipsizeMode="middle"
        selectable
        accessibilityLabel={`Public key ${nip19.npubEncode(pubkey)}`}>
        {nip19.npubEncode(pubkey)}
      </Text>
    </View>
  );
}

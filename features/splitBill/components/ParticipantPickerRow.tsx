/**
 * @fileoverview Row for the Split-Bill participant picker.
 *
 * Thin wrapper over `ListRow` — renders the shared Avatar + title + subtitle
 * layout and adds a circle-check trailing slot that reflects the selection
 * state. Tapping the row toggles the selection.
 *
 * BLE rows use a `mdi:bluetooth`-tinted iconCircle (no avatar URL is
 * available for a raw peerID). Nostr + search rows use the Avatar primitive
 * with profile picture + seeded gradient fallback.
 */

import React, { useCallback } from 'react';
import opacity from 'hex-color-opacity';

import { ListRow } from '@/shared/ui/composed/ListRow';
import Icon from 'assets/icons';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { PickerCandidate } from '../hooks/useSplitBillParticipantPicker';

interface Props {
  candidate: PickerCandidate;
  selected: boolean;
  onToggle: (candidate: PickerCandidate) => void;
}

const BLUETOOTH_ACCENT = '#0A84FF';

export const ParticipantPickerRow = React.memo(function ParticipantPickerRow({
  candidate,
  selected,
  onToggle,
}: Props) {
  const [foreground, accent] = useThemeColor(['foreground', 'accent'] as const);

  const handlePress = useCallback(() => {
    onToggle(candidate);
  }, [candidate, onToggle]);

  const trailing = (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: selected ? accent : opacity(foreground, 0.25),
        backgroundColor: selected ? accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {selected && <Icon name="mdi:check" size={16} color="#FFFFFF" />}
    </View>
  );

  // BLE candidates don't have avatar URLs — use an iconCircle so they read
  // as "Bluetooth-sourced" rather than a random gradient.
  if (candidate.source === 'ble') {
    return (
      <ListRow
        iconCircle={{
          icon: 'mdi:bluetooth',
          color: BLUETOOTH_ACCENT,
          backgroundColor: opacity(BLUETOOTH_ACCENT, 0.12),
        }}
        title={candidate.nickname ?? candidate.peerID ?? 'Peer'}
        subtitle={candidate.subtitle}
        trailing={trailing}
        onPress={handlePress}
      />
    );
  }

  return (
    <ListRow
      avatar={{
        picture: candidate.avatarUrl,
        name: candidate.nickname,
        seed: candidate.pubkey,
        size: 44,
      }}
      title={candidate.nickname ?? candidate.pubkey?.slice(0, 12) ?? 'Anonymous'}
      subtitle={candidate.subtitle}
      trailing={trailing}
      onPress={handlePress}
    />
  );
});

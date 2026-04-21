export const BLUETOOTH_TIER = {
  key: 'bluetooth',
  precision: 0,
  label: 'Bluetooth',
  icon: 'mdi:bluetooth',
  transport: 'ble' as const,
} as const;

export const LOCATION_TIERS = [
  { key: 'block', precision: 7, label: 'Block', icon: 'mdi:home', transport: 'nostr' as const },
  { key: 'neighborhood', precision: 6, label: 'Neighborhood', icon: 'mdi:map-marker', transport: 'nostr' as const },
  { key: 'city', precision: 5, label: 'City', icon: 'mdi:map', transport: 'nostr' as const },
  { key: 'province', precision: 4, label: 'Province', icon: 'mdi:compass', transport: 'nostr' as const },
  { key: 'region', precision: 2, label: 'Region', icon: 'mdi:earth', transport: 'nostr' as const },
] as const;

// BitChat Nostr event kinds
export const BITCHAT_EVENT_KIND_EPHEMERAL = 20000;
export const BITCHAT_EVENT_KIND_PRESENCE = 20001;
export const BITCHAT_EVENT_KIND_TEXT_NOTE = 1;

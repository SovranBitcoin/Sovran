// The drawer's rows as data (ADR 0021), kept free of React Native imports so
// the per-edition row set can be unit-tested directly.

import { hasFeature, type Feature } from '@/shared/config/features';

export type MenuRoute =
  | '/(drawer)/(tabs)/feed'
  // Wallet is the `(tabs)/index` folder, which expo-router collapses to an
  // empty path segment — so its canonical route is the app root `/`, not
  // `/(drawer)/(tabs)/index` (that path resolves to +not-found at runtime).
  | '/'
  | '/(drawer)/(tabs)/contacts'
  | '/(drawer)/(tabs)/notifications'
  | '/(drawer)/(tabs)/ai'
  | '/(signer-flow)'
  | '/(settings-flow)';

export type MenuIconPair = {
  default: string;
  selected: string;
};

type MenuItem = {
  /** Stable row identity; drives the `drawer-menu-*` testID and list key. */
  id: string;
  icon: MenuIconPair;
  label: string;
  route: MenuRoute;
  /** Segment-prefix that, when matched against `useSegments()`, marks this menu item active. */
  activeSegments: readonly string[];
  /** Module this row belongs to (ADR 0021); omitted rows always ship. */
  feature?: Feature;
};

const ALL_MENU_ITEMS: readonly MenuItem[] = [
  {
    id: 'feed',
    feature: 'feed',
    icon: { default: 'mingcute:home-4-line', selected: 'mingcute:home-4-fill' },
    label: 'Feed',
    route: '/(drawer)/(tabs)/feed',
    activeSegments: ['(drawer)', '(tabs)', 'feed'],
  },
  {
    id: 'wallet',
    icon: { default: 'fluent:wallet-20-regular', selected: 'fluent:wallet-20-filled' },
    label: 'Wallet',
    route: '/',
    activeSegments: ['(drawer)', '(tabs)', 'index'],
  },
  {
    id: 'contacts',
    feature: 'contacts',
    icon: { default: 'mdi:account-group-outline', selected: 'mdi:account-group' },
    label: 'Contacts',
    route: '/(drawer)/(tabs)/contacts',
    activeSegments: ['(drawer)', '(tabs)', 'contacts'],
  },
  {
    id: 'notifications',
    feature: 'feed',
    icon: { default: 'mdi:bell-outline', selected: 'mdi:bell' },
    label: 'Notifications',
    route: '/(drawer)/(tabs)/notifications',
    activeSegments: ['(drawer)', '(tabs)', 'notifications'],
  },
  {
    id: 'ai',
    feature: 'ai',
    icon: { default: 'mdi:robot-outline', selected: 'mdi:robot' },
    label: 'AI',
    route: '/(drawer)/(tabs)/ai',
    activeSegments: ['(drawer)', '(tabs)', 'ai'],
  },
  {
    id: 'remote-login',
    feature: 'nostr',
    icon: { default: 'mdi:key-variant', selected: 'mdi:key-variant' },
    label: 'Remote Login',
    route: '/(signer-flow)',
    activeSegments: ['(signer-flow)'],
  },
  {
    id: 'settings',
    icon: {
      default: 'material-symbols:settings-rounded',
      selected: 'material-symbols:settings-rounded',
    },
    label: 'Settings',
    route: '/(settings-flow)',
    activeSegments: ['(settings-flow)'],
  },
];

/** The rows a build ships: a row whose module is off would route nowhere. */
export function drawerMenuItems(
  enabled: (feature: Feature) => boolean = hasFeature
): readonly MenuItem[] {
  return ALL_MENU_ITEMS.filter((item) => !item.feature || enabled(item.feature));
}

import type { DrawerContentComponentProps } from 'expo-router/drawer';

import { AccountSwitcherDrawer } from '@/navigation/AccountSwitcherDrawer';

/** The drawer is the account switcher (ADR 0035); Wallet, Settings and Search are tabs. */
export function DrawerContent({ navigation }: DrawerContentComponentProps) {
  return <AccountSwitcherDrawer navigation={navigation} />;
}

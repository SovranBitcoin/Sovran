import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../features/wallet/screens/WalletScreen.tsx'),
  'utf8'
);
const drawerSource = readFileSync(
  resolve(__dirname, '../shared/blocks/DrawerProfileChrome.tsx'),
  'utf8'
);
const tabsSource = readFileSync(resolve(__dirname, '../app/(drawer)/(tabs)/_layout.tsx'), 'utf8');

const homeLayoutSource = readFileSync(
  resolve(__dirname, '../features/wallet/home/HomeLayouts.tsx'),
  'utf8'
);

/** The object literal that declares one home action in WalletScreen. */
function homeAction(id: string): string {
  const marker = source.indexOf(`id: '${id}',`);
  if (marker < 0) throw new Error(`missing ${id} home action`);
  return source.slice(marker, source.indexOf('},', marker));
}

describe('wallet simulator selectors', () => {
  it.each([
    ['receive', 'wallet-receive'],
    ['send', 'wallet-send'],
  ])('declares the %s action with its testID, once, for every home layout', (id, testID) => {
    expect(homeAction(id)).toContain(`testID: '${testID}'`);
    expect(source.split(`'${testID}'`)).toHaveLength(2);
    expect(source).not.toContain(`<View testID="${testID}"`);
  });

  it.each(['receive', 'send'])('puts the %s testID on the accessible CapsuleButton', (id) => {
    const marker = homeLayoutSource.indexOf(`testID={actions.${id}.testID}`);
    expect(marker).toBeGreaterThan(0);
    expect(homeLayoutSource.lastIndexOf('<CapsuleButton', marker)).toBeGreaterThan(
      homeLayoutSource.lastIndexOf('/>', marker)
    );
  });

  it('exposes the active drawer profile name through a stable accessibility selector', () => {
    expect(drawerSource).toContain('testID="drawer-profile-name"');
    expect(drawerSource).toContain('accessibilityLabel={displayName}');
  });

  it('keeps the profile-switcher controls AX-selectable for e2e', () => {
    // The dots button opens the heroui switcher sheet; the inactive-profile
    // avatars are one-tap switch shortcuts. Both need a paired
    // accessibilityLabel or iOS drops them from the AX tree.
    expect(drawerSource).toContain('testID="drawer-profile-switcher-open"');
    expect(drawerSource).toContain('accessibilityLabel="Switch profile"');
    expect(drawerSource).toContain('testID={`drawer-profile-switch-${profile.accountIndex}`}');
    expect(drawerSource).toContain(
      'accessibilityLabel={`Switch account ${profile.accountIndex + 1}`}'
    );
  });

  it('gives the Wallet tab one cross-platform AX identity', () => {
    expect(tabsSource).toContain("testID: 'tab-wallet'");
    expect(tabsSource).toContain('tabBarItemTestID: tab.testID');
    expect(tabsSource).toContain('tabBarItemAccessibilityLabel: tab.title');
    expect(tabsSource).toContain('tabBarButtonTestID: tab.testID');
  });

  it('gives the AI tab one cross-platform fallback identity', () => {
    expect(tabsSource).toContain("testID: 'tab-ai'");
  });
});

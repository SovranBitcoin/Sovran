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

function capsuleButton(label: string): string {
  const marker = source.indexOf(`label="${label}"`);
  if (marker < 0) throw new Error(`missing ${label} CapsuleButton`);
  const start = source.lastIndexOf('<CapsuleButton', marker);
  const end = source.indexOf('/>', marker);
  if (start < 0 || end < 0) throw new Error(`could not isolate ${label} CapsuleButton`);
  return source.slice(start, end + 2);
}

describe('wallet simulator selectors', () => {
  it.each([
    ['Receive', 'wallet-receive'],
    ['Send', 'wallet-send'],
  ])('puts %s testID on the accessible CapsuleButton', (label, testID) => {
    expect(capsuleButton(label)).toContain(`testID="${testID}"`);
    expect(source).not.toContain(`<View testID="${testID}"`);
  });

  it('exposes the active drawer profile name through a stable accessibility selector', () => {
    expect(drawerSource).toContain('testID="drawer-profile-name"');
    expect(drawerSource).toContain('accessibilityLabel={displayName}');
  });
});

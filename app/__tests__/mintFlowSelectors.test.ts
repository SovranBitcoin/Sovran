import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Selector registry for the mint-management e2e scenarios
// (receive.lightning.change-mint.confirm, receive.cashu.unknown-mint,
// mint.add.url). Each testID pinned here is load-bearing for a scenario in
// e2e/scenarios/ — renaming one breaks a simulator run, not just a unit test.

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

describe('mint flow e2e selectors', () => {
  it('pins quote-mint-selector on the lightning receive confirmation pill', () => {
    const source = read('features/receive/screens/LightningReceiveScreen.tsx');
    const marker = source.indexOf('testID="quote-mint-selector"');
    expect(marker).toBeGreaterThan(-1);
    const start = source.lastIndexOf('<MintSelector', marker);
    expect(start).toBeGreaterThan(-1);
    expect(source.indexOf('testID="quote-mint-selector"', start)).toBe(marker);
  });

  it.each([
    'app/(receive-flow)/mintSelect.tsx',
    'app/(send-flow)/mintSelect.tsx',
    'app/(mint-flow)/list.tsx',
  ])('pins mint-select-add on the %s header add action', (file) => {
    expect(read(file)).toContain('testID="mint-select-add"');
  });

  it('pins wallet-mint-selector on the wallet home header pill', () => {
    expect(read('app/(drawer)/(tabs)/index/_layout.tsx')).toContain(
      'testID="wallet-mint-selector"'
    );
  });

  it('pins the add-mint screen selectors', () => {
    const source = read('features/mint/screens/MintAddScreen.tsx');
    // Both platform inputs: GlassSearchBar (iOS header) and the Android
    // fallback TextInput share one id — a scenario must not care which
    // platform it runs on.
    expect(source.match(/testID="mint-add-search-input"/g)).toHaveLength(2);
    expect(source).toContain('testID="mint-add-search-toggle"');
    expect(source).toContain('testID="mint-add-search-close"');
    expect(source).toContain("testID: 'mint-add-confirm'");
    expect(source).toContain("testID: 'mint-add-cancel'");
  });

  it.each(['GlassSearchBar.ios.tsx', 'GlassSearchBar.android.tsx'])(
    'forwards testID to the %s TextInput',
    (file) => {
      const source = read(`shared/ui/composed/GlassSearchBar/${file}`);
      expect(source).toContain('testID={testID}');
    }
  );

  it('pins the mint info trust decision buttons on every ButtonHandler variant', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    // trust: accepter ("Accept") + scan/untrusted ("Add mint"); close: those
    // two plus the trusted read-only variant.
    expect(source.match(/testID: 'mint-info-trust'/g)).toHaveLength(2);
    expect(source.match(/testID: 'mint-info-close'/g)).toHaveLength(3);
  });
});

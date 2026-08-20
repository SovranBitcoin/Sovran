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

  const MINT_SELECT_SCREEN = 'features/mint/screens/MintSelectFlowScreen.tsx';

  it.each([
    ['app/(receive-flow)/mintSelect.tsx', 'receive'],
    ['app/(send-flow)/mintSelect.tsx', 'send'],
  ])('%s renders the shared MintSelectFlowScreen as the %s flow', (file, flow) => {
    const source = read(file);
    expect(source).toContain(`<MintSelectFlowScreen flow="${flow}"`);
  });

  it('pins mint-select-add on the mint-select header add action', () => {
    const source = read(MINT_SELECT_SCREEN);
    expect(source).toContain('testID="mint-select-add"');
    // HeaderGlassCircle sets accessible={!!accessibilityLabel} — a header
    // action with only a testID is AX-invisible on liquid-glass devices, so
    // the label is load-bearing for the e2e selector, not just for VoiceOver.
    expect(source).toContain('accessibilityLabel="Add mint"');
  });

  it('refreshes stale machine candidates when the mint-select screen regains focus', () => {
    const source = read(MINT_SELECT_SCREEN);
    expect(source).toContain('useRefreshMintSelectorOnFocus({');
    expect(source).toContain('const trackedTrustedMintUrls = useColadaTrustedMintUrls();');
    expect(source).toContain(
      'trustedMintUrls: trackedTrustedMintUrls ?? walletContext.trustedMintUrls'
    );
    expect(source).toContain('refresh: refreshMintSelector');
    expect(source).toContain('liveSelectMint?.scope ? { scope: liveSelectMint.scope } : undefined');
  });

  it('keeps the mint-add search header actions accessible on liquid glass', () => {
    const source = read('features/mint/screens/MintAddScreen.tsx');
    expect(source).toContain('accessibilityLabel="Search mints"');
    expect(source).toContain('accessibilityLabel="Close search"');
  });

  it('mirrors toast evidence inside the mint-list modal', () => {
    const source = read('features/mint/screens/MintListScreen.tsx');
    expect(source).toContain("import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';");
    expect(source).toContain('<E2EToastProbe />');
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

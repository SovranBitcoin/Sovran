import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Selector registry for the wallet-surface e2e scenarios (currency display,
// unit switch, mint info/reviews/DM, search-send, QR-display tabs). Each
// testID pinned here is load-bearing for a scenario in e2e/scenarios/ —
// renaming one breaks a simulator run, not just a unit test.

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

describe('wallet surface e2e selectors', () => {
  it('pins wallet-fiat-pill on the sat-page fiat conversion pill', () => {
    const source = read('features/wallet/components/PrimaryBalance.tsx');
    expect(source).toContain("testID={isSatUnit ? 'wallet-fiat-pill' : undefined}");
    expect(source).toContain(
      "accessibilityLabel={isSatUnit ? 'Change display currency' : undefined}"
    );
    // All pill variants must forward the id to their tappable root.
    for (const variant of [
      'features/wallet/components/FiatCurrencyPill/FiatCurrencyPill.liquid.tsx',
      'features/wallet/components/FiatCurrencyPill/FiatCurrencyPill.flat.tsx',
      'features/wallet/components/FiatCurrencyPill/FiatCurrencyPill.androidMenu.tsx',
    ]) {
      expect(read(variant)).toContain('testID={testID}');
    }
  });

  it('pins the wallet-selected-mint probe on the wallet home', () => {
    const probe = read('features/wallet/components/WalletSelectedMintProbe.tsx');
    expect(probe).toContain('testID={`wallet-selected-mint:${host}`}');
    expect(read('features/wallet/screens/WalletScreen.tsx')).toContain(
      '<WalletSelectedMintProbe />'
    );
  });

  it('pins per-row mint-inspect ids on the mint selector', () => {
    const source = read('features/mint/screens/MintListScreen.tsx');
    expect(source).toContain('testID={`mint-inspect:${mintUrl}`}');
    expect(source).toContain('accessibilityLabel="Open mint page"');
  });

  it('pins mint-info-reviews on the mint info headerRight', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    expect(source).toContain('testID="mint-info-reviews"');
    // Header actions without an accessibilityLabel are AX-invisible on
    // liquid-glass iOS — the label is load-bearing for the e2e selector.
    expect(source).toContain('accessibilityLabel="View mint reviews"');
  });

  it('pins the mint-info Nostr contact row', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    expect(source).toContain("testID={c.isNostr ? 'mint-info-contact-nostr' : undefined}");
  });

  it('pins profile-send-money on the user profile screen', () => {
    expect(read('features/user/screens/UserProfileScreen.tsx')).toContain(
      'testID="profile-send-money"'
    );
  });

  it('pins the P2PK lock row toggle and its state probe', () => {
    const source = read('features/receive/components/CreqCustomizationCard.tsx');
    // The HeroSwitch collapses inside the grouped ListGroup row on device, so
    // the row pressable owns the id and the toggle; the probe carries state.
    expect(source).toContain('testID="receive-creq-p2pk-toggle"');
    expect(source).toContain('testID="receive-creq-p2pk-state"');
  });

  it('pins the wallet header search toggle and input', () => {
    const layout = read('shared/ui/composed/SearchLayout.tsx');
    expect(layout).toContain('`${searchTestIDPrefix}-search-toggle`');
    expect(layout).toContain('`${searchTestIDPrefix}-search-input`');
    expect(read('app/(drawer)/(tabs)/index/_layout.tsx')).toContain('searchTestIDPrefix="wallet"');
    // Liquid-glass header buttons are accessible only WITH a label; the
    // HeaderIconButton must forward both identity props to HeaderGlassCircle.
    const header = read('navigation/nativeTabs.tsx');
    expect(header).toContain(
      '<HeaderGlassCircle onPress={onPress} testID={testID} accessibilityLabel={accessibilityLabel}>'
    );
  });

  it('pins the DM conversation probe on UserMessagesScreen', () => {
    const source = read('features/user/screens/UserMessagesScreen.tsx');
    expect(source).toContain('testID="dm-chat-probe"');
  });

  it('pins the unit switcher pill AX identity', () => {
    const source = read('features/wallet/components/UnitSwitcherPill/UnitSwitcherPill.liquid.tsx');
    // LiquidGlassMenu is AX-invisible without accessible+label — both render
    // branches must carry the id AND the label or the wallet scenarios break.
    expect(source.match(/testID="wallet-unit-switcher"/g)?.length).toBe(2);
    expect(source.match(/accessibilityLabel="Switch wallet account"/g)?.length).toBe(2);
  });

  it('pins the offline banner and the Mock Offline dev toggle', () => {
    expect(read('shared/providers/OfflineProvider.tsx')).toContain('testID="offline-banner"');
    const settings = read('features/settings/screens/SettingsScreen.tsx');
    expect(settings).toContain('testID="settings-version-row"');
    expect(settings).toContain('testID="settings-mock-offline-toggle"');
    expect(settings).toContain('testID="settings-mock-fail-melt-toggle"');
  });

  it('pins the DM composer testID plumbing', () => {
    expect(read('features/user/screens/UserMessagesScreen.tsx')).toContain(
      'composerTestID="dm-composer"'
    );
  });

  it('pins the seed reveal toggles on SettingsProfileScreen', () => {
    const source = read('features/settings/screens/SettingsProfileScreen.tsx');
    expect(source).toContain('testID={`profile-reveal-${fieldKey}`}');
  });

  it('pins the drawer menu row ids', () => {
    expect(read('app/(drawer)/_layout.tsx')).toContain(
      "testID={`drawer-menu-${label.toLowerCase().replace(/\\s+/g, '-')}`}"
    );
  });

  it('pins the wallet wallpaper probe and gallery card AX identity', () => {
    const probe = read('features/wallet/components/WalletWallpaperProbe.tsx');
    // Slug probe (persisted album selection) AND image-render probe (the
    // wallpaper actually decoded and painted) — the latter is what a scenario
    // must assert so a truncated download that renders black can't pass green.
    expect(probe).toContain('testID={`wallet-wallpaper:${slug}`}');
    expect(probe).toContain('testID={`wallet-wallpaper-image:${imageStatus}`}');
    expect(read('features/wallet/screens/WalletScreen.tsx')).toContain('<WalletWallpaperProbe />');
    // SpriteView must feed the image-render store from the <Image> callbacks.
    const sprite = read('shared/ui/composed/SpriteView.tsx');
    expect(sprite).toContain('markWallpaperLoaded(activeTheme)');
    expect(sprite).toContain('markWallpaperFailed(activeTheme)');
    // Gallery album cards are addressable only via the pressable wrapper —
    // the inner card View's testID never becomes an AX element.
    const card = read('features/theme/components/UnitPreviewCard.tsx');
    expect(card).toContain('accessible={!!testID}');
  });

  it('pins the mint-info KYM cache fallback', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    // Inspect-seeded entries carry no kymScore; the reviews header action must
    // read the cached review aggregate or it never renders on that path.
    expect(source).toContain('useCachedMintMetadata(mintUrl || null)');
  });
});

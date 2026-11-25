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
    // The 1×1 sibling probe mirrors the persisted selection into AX — the
    // native menu pill itself exposes no machine-readable currency code.
    expect(source).toContain('testID={`wallet-fiat-currency:${displayCurrency}`}');
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

  it('pins the Reviews and History circle actions on the mint info page', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    expect(source).toContain('testID="mint-info-reviews"');
    expect(source).toContain('testID="mint-info-history"');
    // The labels are load-bearing for the e2e selectors on liquid-glass iOS.
    expect(source).toContain('accessibilityLabel="View mint reviews"');
    expect(source).toContain('accessibilityLabel="View mint update history"');
    // The star left the header: the row is on the page, for every flow.
    expect(source).not.toContain('headerRight');
  });

  it('pins the mint-info Nostr contact row', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    expect(source).toMatch(/c\.isNostr\s*\?\s*'mint-info-contact-nostr'/);
  });

  it('pins the own/other profile screen probe', () => {
    expect(read('features/user/screens/UserProfileScreen.tsx')).toContain(
      "testID={isOwnProfile ? 'user-profile:own' : 'user-profile:other'}"
    );
  });

  it('pins profile-send-money on the user profile screen', () => {
    expect(read('features/user/screens/UserProfileScreen.tsx')).toContain(
      'testID="profile-send-money"'
    );
  });

  it('keeps profile-share-qr outside the follow gate', () => {
    const source = read('features/user/screens/UserProfileScreen.tsx');
    // capture.account-entry taps this on the viewer's OWN profile, where
    // Send Money and Message are absent — so the QR circle must sit in the
    // action row itself, not inside its `showFollowButton &&` branch.
    const row = source.slice(
      source.indexOf('<HStack justify="center" gap={28}'),
      source.indexOf('</HStack>', source.indexOf('<HStack justify="center" gap={28}'))
    );
    expect(row).toContain('testID="profile-share-qr"');
    expect(row.indexOf('testID="profile-share-qr"')).toBeGreaterThan(row.indexOf('</>'));
  });

  it('pins the P2PK lock row toggle and its state probe', () => {
    const source = read('features/receive/components/CreqCustomizationCard.tsx');
    // The HeroSwitch collapses inside the grouped ListGroup row on device, so
    // the row pressable owns the id and the toggle; the probe carries state.
    expect(source).toContain('testID="receive-creq-p2pk-toggle"');
    expect(source).toContain('testID="receive-creq-p2pk-state"');
    expect(source).toContain('testID={`receive-creq-p2pk-state:${p2pkStateValue.text}`}');
  });

  it('pins the tab ids and the Search tab field', () => {
    const tabs = read('app/(drawer)/(tabs)/_layout.tsx');
    for (const id of ['tab-wallet', 'tab-settings', 'tab-search']) {
      expect(tabs).toContain(`testID: '${id}',`);
    }
    // iOS 26 draws the Search item as the system search control.
    expect(tabs).toContain("role: 'search',");
    expect(read('shared/ui/composed/SearchLayout.tsx')).toContain('testID={searchTestID}');
    expect(read('app/(drawer)/(tabs)/search/_layout.tsx')).toContain('searchTestID="search-input"');
    expect(read('features/search/screens/SearchScreen.tsx')).toContain('testID="search-screen"');
    // Liquid-glass header buttons are accessible only WITH a label; the
    // HeaderIconButton must forward both identity props to HeaderGlassCircle.
    const header = read('navigation/nativeTabs.tsx');
    expect(header).toContain(
      '<HeaderGlassCircle onPress={onPress} testID={testID} accessibilityLabel={accessibilityLabel}>'
    );
  });

  it('pins the inline cashu-token bubble AX identity in chat threads', () => {
    // The interactive outer Pressable carries the id (inner Texts AX-flatten
    // into it); own vs incoming direction is the e2e-relevant distinction.
    const source = read('shared/ui/composed/chat/CashuTokenBubble.tsx');
    expect(source).toContain("testID={isOwn ? 'cashu-bubble-own' : 'cashu-bubble-incoming'}");
    expect(source).toContain(
      "accessibilityLabel={isOwn ? 'Sent ecash token' : 'Received ecash token'}"
    );
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
    expect(settings).toContain('testID="settings-mock-mode-toggle"');
    expect(settings).toContain('testID="settings-mock-fail-melt-toggle"');
    // Unconditional, not gated on `testID`: a screen reader needs the role and
    // the checked state on EVERY toggle, not only the three the e2e harness
    // happens to target. The toggle row is the shared Settings row.
    const rows = read('shared/ui/composed/SettingsRows.tsx');
    expect(settings).toContain("from '@/shared/ui/composed/SettingsRows'");
    expect(rows).toContain('accessibilityRole="switch"');
    expect(rows).toContain('{ checked: isSelected }');
    for (const state of ['mockOffline', 'mockFailSend', 'mockFailMelt']) {
      expect(settings).toContain(`isSelected={${state}}`);
    }
  });

  it('exposes mint distribution toggles as native checked controls', () => {
    const distribution = read('features/mint/components/distribution/MintDistributionCards.tsx');
    expect(distribution).toContain('isSelected={enabled}');
    expect(distribution).toContain('testID={`mint-distribution-toggle:${mintUrl}`}');
  });

  it.each([
    ['Segmented', 'segmented', 'segmentsAuto'],
    ['Timeline', 'timeline', 'timelineAuto'],
  ])('exposes the %s autoplay control as native checked state', (screen, id, state) => {
    const source = read(`features/settings/screens/SettingsDesignSystem${screen}Screen.tsx`);
    const control = source.slice(source.indexOf(`testID="design-system-${id}-auto"`));
    const props = control.slice(0, control.indexOf('onPress='));
    expect(props).toContain('accessibilityRole="switch"');
    expect(props).toContain(`accessibilityState={{ checked: ${state} }}`);
  });

  it('drives the Design System through actionable outer-row selectors', () => {
    const settings = read('features/settings/screens/SettingsScreen.tsx');
    expect(settings).toContain('testID="settings-design-system-row"');
    expect(settings).toContain('accessible');
    expect(settings).toContain('accessibilityRole="button"');

    const catalog = read('features/settings/screens/SettingsDesignSystemScreen.tsx');
    expect(catalog).toContain('testID={`design-system-family-${id}`}');
    expect(catalog).toContain('accessibilityLabel={`${title}, ${description}`}');
    expect(catalog).toContain('accessibilityRole="button"');
  });

  it('pins the seed reveal toggles on SettingsProfileScreen', () => {
    const source = read('features/settings/components/ProfileDetailsScreen.tsx');
    expect(source).toContain('testID={`profile-reveal-${fieldKey}`}');
    expect(source).toContain('testID={fieldKey ? `profile-secret-value-${fieldKey}` : undefined}');
    expect(source).toContain('accessibilityRole="switch"');
    expect(source).toContain('accessibilityState={{ checked: isVisible }}');
  });

  it('pins the picker sheet ids', () => {
    const sheet = read('shared/ui/composed/PickerSheet.tsx');
    expect(sheet).toContain('testID="picker-sheet"');
    expect(sheet).toContain('testID="picker-sheet-close"');
  });

  it('pins the geohash channel probe on GeohashChatScreen', () => {
    expect(read('features/bitchat/screens/GeohashChatScreen.tsx')).toContain(
      "testID={`geohash-chat:${geohash ?? 'unknown'}`}"
    );
  });

  it('pins the account switcher drawer ids', () => {
    const drawer = read('navigation/AccountSwitcherDrawer.tsx');
    // Keyed by the account's derivation index, its stable identity.
    expect(read('navigation/AccountRow.tsx')).toContain(
      'testID={`drawer-profile-switch-${profile.accountIndex}`}'
    );
    expect(drawer).toContain('testID="drawer-add-account"');
    expect(drawer).toContain('testID="drawer-import-account"');
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
    // the inner card View's testID never becomes an AX element — and are
    // announced by the album name with their selected state.
    const card = read('features/theme/components/UnitPreviewCard.tsx');
    expect(card).toContain('accessibilityLabel={accessibilityLabel ?? label ?? themeName}');
    expect(card).toContain('accessibilityState={{ selected: !!selected }}');
    expect(read('features/theme/screens/GalleryScreen.tsx')).toContain(
      'accessibilityLabel={album.displayName}'
    );
  });

  it('pins the mint-info KYM cache fallback', () => {
    const source = read('features/mint/screens/MintInfoScreen.tsx');
    // Inspect-seeded entries carry no kymScore; the reviews header action must
    // read the cached review aggregate or it never renders on that path.
    expect(source).toContain('useCachedMintMetadata(mintUrl || null)');
  });
});

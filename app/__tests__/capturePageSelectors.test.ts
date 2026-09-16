import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('capture page native selectors', () => {
  it('puts composer selectors on the real input and buttons', () => {
    const composer = source('features/composer/ui/PostComposer.tsx');
    expect(composer).toContain('<TextInput\n              testID="composer-input"');
    expect(composer).toContain('testID="composer-cancel"');
    expect(composer).toContain('testID="composer-publish"');
    expect(composer).toContain('isDisabled={!canPost}');
    expect(source('features/composer/ui/ComposeFab.tsx')).toContain('testID="composer-open"');
  });

  it('keeps claim and public-profile header actions accessible', () => {
    const claim = source('features/onboarding/screens/ClaimUsernameScreen.tsx');
    expect(claim).toContain('testID="claim-username-input"');
    expect(claim).toContain('accessibilityLabel="Username"');
    expect(claim).toContain('testID="claim-username-close"');
    expect(claim).toContain('accessibilityLabel="Close"');
    expect(claim).toContain("testID: 'claim-username-continue'");
    expect(claim).toContain('disabled: isClaiming || !selectedDomainAvailable');
    expect(source('features/user/screens/UserProfileScreen.tsx')).toContain(
      'accessibilityLabel="Show public profile QR"'
    );
  });

  it('does not call an errored keyring or rail read ready', () => {
    const keyring = source('features/settings/screens/SettingsKeyringScreen.tsx');
    expect(keyring).toContain('__DEV__ && !isLoading && loadSucceeded && !isKeyringActionPending');
    const load = keyring.slice(
      keyring.indexOf('async function loadKeypairsImpl'),
      keyring.indexOf('async function generateKeyImpl')
    );
    expect(load.indexOf('io.setLoadSucceeded(false)')).toBeLessThan(
      load.indexOf('await manager.keyring.getAllKeyPairs()')
    );
    expect(load.indexOf('io.setLoadSucceeded(true)')).toBeGreaterThan(
      load.indexOf('io.setKeypairs(allKeys)')
    );
    expect(load.slice(load.indexOf('catch (error)'))).not.toContain('setLoadSucceeded(true)');
    const rails = source('features/receive/screens/ReceiveRailListScreen.tsx');
    expect(rails).toContain('!state.loading && !state.failed && state.items.length === 0');
    expect(rails).toContain('setState({ loading: false, failed: true, items: [] })');
    expect(rails).toContain('setState({ loading: false, failed: false, items })');
  });

  it('requires resolved empty followers and an unbootstrapped local key-package count', () => {
    const followers = source('features/feed/screens/NotificationFollowersScreen.tsx');
    const guard = followers.slice(
      followers.indexOf('{__DEV__'),
      followers.indexOf('testID="notification-followers-empty"')
    );
    for (const condition of [
      'viewerPubkey',
      'page.result',
      '!isInitialLoading',
      '!isRefreshing',
      '!errorMessage',
      'followers.length === 0',
    ])
      expect(guard).toContain(condition);
    const setup = source('features/whitenoise/screens/WhitenoiseSetupScreen.tsx');
    expect(setup).toContain('!isLoading && !isBootstrapping && !error && keyPackageCount === 0');
    expect(setup).toContain('testID="whitenoise-setup-uninitialized"');
    expect(setup).toContain('onPress={bootstrap}');
    expect(source('features/settings/screens/SettingsStorageScreen.tsx')).toContain(
      '__DEV__ && !isLoading && !isRefreshing && !error'
    );
  });
});

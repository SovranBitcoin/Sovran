import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// The vendored BitChat Kotlin (modules/bitchat-module/android/vendor-src) is
// gitignored and only present after the vendor-patch step (locally / on EAS),
// so it is absent in a plain CI checkout. Guard the vendor-src guards on its
// presence: skip-with-warning rather than hard-fail (which would block the now-
// gating Jest suite on infrastructure, not on a real regression). The tests
// that read TRACKED native/bridge/script sources always run.
const vendorSrcAvailable = fs.existsSync(
  path.join(repoRoot, 'modules/bitchat-module/android/vendor-src')
);
if (!vendorSrcAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    '[bitchatAndroidNativeSource] vendor-src absent (gitignored; needs vendor-patch) — skipping vendor-src guards'
  );
}
const itVendor = vendorSrcAvailable ? it : it.skip;

describe('Android BitChat native source guards', () => {
  itVendor('does not require location for Android 12+ BLE startup', () => {
    const source = readSource(
      'modules/bitchat-module/android/vendor-src/com/bitchat/android/mesh/BluetoothPermissionManager.kt'
    );

    const android12Block = source.match(
      /if \(android\.os\.Build\.VERSION\.SDK_INT >= android\.os\.Build\.VERSION_CODES\.S\) \{\n([\s\S]*?)\n            \} else/
    )?.[1];

    expect(android12Block).toContain('Manifest.permission.BLUETOOTH_ADVERTISE');
    expect(android12Block).toContain('Manifest.permission.BLUETOOTH_CONNECT');
    expect(android12Block).toContain('Manifest.permission.BLUETOOTH_SCAN');
    expect(android12Block).not.toContain('ACCESS_FINE_LOCATION');
    expect(android12Block).not.toContain('ACCESS_COARSE_LOCATION');
  });

  itVendor('propagates Android mesh startup failure to the Expo bridge', () => {
    const meshSource = readSource(
      'modules/bitchat-module/android/vendor-src/com/bitchat/android/mesh/BluetoothMeshService.kt'
    );
    const bridgeSource = readSource(
      'modules/bitchat-module/android/src/main/java/expo/modules/bitchat/BitChatBLEBridge.kt'
    );

    expect(meshSource).toContain('fun startServices(): Boolean');
    expect(meshSource).toContain('return if (connectionManager.startServices())');
    expect(bridgeSource).toContain('if (!service.startServices())');
    expect(bridgeSource).toContain('throw BitChatStartFailedException()');
    expect(bridgeSource).toMatch(/mesh = service\s+isRunning = true/);
  });

  it('preserves baked vendor versions when EAS archives strip git metadata', () => {
    const iosPatcher = readSource('modules/bitchat-module/scripts/patch-bitchat-imports.js');
    const androidSync = readSource('modules/bitchat-module/scripts/sync-bitchat-android.js');

    expect(iosPatcher).toContain('readExistingVendorCommit');
    expect(iosPatcher).toContain('static let commit = "([^"]+)"');
    expect(iosPatcher).toContain("stdio: ['ignore', 'pipe', 'ignore']");
    expect(androidSync).toContain('readExistingVendorCommit');
    expect(androidSync).toContain('const val commit = "([^"]+)"');
    expect(androidSync).toContain("stdio: ['ignore', 'pipe', 'ignore']");
  });

  it('self-heals only profile-scoped Android BitChat encrypted identity prefs', () => {
    const installerSource = readSource(
      'modules/bitchat-module/android/src/main/java/expo/modules/bitchat/BitchatIdentityInstaller.kt'
    );
    const scopedContextSource = readSource(
      'modules/bitchat-module/android/src/main/java/expo/modules/bitchat/ProfileScopedContext.kt'
    );

    expect(installerSource).toContain('withSelfHealingEncryptedPrefs');
    expect(installerSource).toContain('AEADBadTagException');
    expect(installerSource).toContain('context.deleteSharedPreferences(name)');
    expect(installerSource).toContain('BitchatIdentityInstaller');
    expect(scopedContextSource).toContain('override fun deleteSharedPreferences(name: String)');
    expect(scopedContextSource).toContain(
      'super.deleteSharedPreferences(BitchatProfileScope.scopedPrefsName(suffix, name))'
    );
  });

  itVendor('keeps BitChat fragment frames below exact BLE boundary failures', () => {
    const androidProtocolSource = readSource(
      'modules/bitchat-module/android/vendor-src/com/bitchat/android/protocol/BinaryProtocol.kt'
    );
    const androidFragmentSource = readSource(
      'modules/bitchat-module/android/vendor-src/com/bitchat/android/mesh/FragmentManager.kt'
    );
    const iosPatcher = readSource('modules/bitchat-module/scripts/patch-bitchat-imports.js');

    expect(androidProtocolSource).toContain('private const val HEADER_SIZE_V1 = 14');
    expect(androidProtocolSource).toContain('private const val HEADER_SIZE_V2 = 16');
    expect(androidProtocolSource).toContain('exact-boundary 512-byte iOS fragments');
    expect(androidFragmentSource).toContain('val headerSize = if (version == 2) 16 else 14');
    expect(iosPatcher).toContain('FRAGMENT_CHUNK_HEADROOM');
    expect(iosPatcher).toContain('fragmentWireHeadroomBytes = 16');
  });
});

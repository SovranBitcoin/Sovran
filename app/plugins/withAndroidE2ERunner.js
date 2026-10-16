/** Release test builds connect to their host over adb-reversed loopback.
 * Generated files stay inactive unless Gradle is explicitly opted in. */
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const START = '// @generated begin sovran-e2e-runner';
const END = '// @generated end sovran-e2e-runner';
const GRADLE = `${START}
// Track both directions: test logging must not survive in a cached ordinary bundle.
tasks.matching { it.name == 'createBundleReleaseJsAndAssets' }.configureEach {
    inputs.property('sovranBundledE2e', gradle.startParameter.projectProperties.getOrDefault('sovranBundledE2e', '<unset>'))
    inputs.property('sovranE2eLogs', providers.environmentVariable('EXPO_PUBLIC_E2E_LOGS').getOrElse('<unset>'))
    inputs.property('sovranE2eDotenv', providers.environmentVariable('EXPO_NO_DOTENV').getOrElse('<unset>'))
    inputs.property('sovranE2eNodeEnv', providers.environmentVariable('NODE_ENV').getOrElse('<unset>'))
    inputs.files(fileTree(rootProject.projectDir.parentFile) { include '.env', '.env.*' }).withPropertyName('sovranE2eEnvFiles')
}
// startParameter excludes ambient gradle.properties and ORG_GRADLE_PROJECT_*.
def sovranE2eRequested = gradle.startParameter.projectProperties.get('sovranBundledE2e')
if (sovranE2eRequested != null) {
    if (sovranE2eRequested != 'true' || android.defaultConfig.applicationId != 'com.sovranbitcoin.dev') {
        throw new GradleException('Bundled E2E requires explicit -PsovranBundledE2e=true and the development application ID')
    }
    if (System.getenv('EXPO_PUBLIC_E2E_LOGS') != '1' || System.getenv('EXPO_NO_DOTENV') != '1') {
        throw new GradleException('Bundled E2E requires EXPO_PUBLIC_E2E_LOGS=1 and EXPO_NO_DOTENV=1')
    }
    if (android.sourceSets.release.manifest.srcFile.exists()) {
        throw new GradleException('Bundled E2E cannot replace an existing Release manifest')
    }
    android.sourceSets.release.manifest.srcFile('src/sovranBundledE2e/AndroidManifest.xml')
    android.sourceSets.release.res.srcDir('src/sovranBundledE2e/res')
}
${END}`;

module.exports = function withAndroidE2ERunner(config) {
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Android E2E requires Groovy Gradle');
    const source = mod.modResults.contents;
    const start = source.indexOf(START);
    const end = source.indexOf(END);
    if ((start === -1) !== (end === -1) || (end !== -1 && end < start))
      throw new Error('Incomplete Android E2E Gradle section');
    const retained =
      start === -1 ? source : source.slice(0, start) + source.slice(end + END.length);
    mod.modResults.contents = `${retained.trimEnd()}\n\n${GRADLE}\n`;
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const directory = join(mod.modRequest.platformProjectRoot, 'app/src/sovranBundledE2e');
      mkdirSync(join(directory, 'res/xml'), { recursive: true });
      writeFileSync(
        join(directory, 'AndroidManifest.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:networkSecurityConfig="@xml/sovran_e2e_network_security" />
</manifest>
`
      );
      // No tools:replace or trust-anchor override: conflicting app policy must fail.
      writeFileSync(
        join(directory, 'res/xml/sovran_e2e_network_security.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`
      );
      return mod;
    },
  ]);
};

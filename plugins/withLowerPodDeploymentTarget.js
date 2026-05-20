const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TARGET_DEPLOYMENT = '16.4';
const LOCAL_PODSPEC_RELATIVE_PATHS = {
  libsecp256k1: '../modules/bitchat-module/ios/podspecs/libsecp256k1.podspec',
  'swift-secp256k1': '../modules/bitchat-module/ios/podspecs/swift-secp256k1.podspec',
};
const PODS_TO_OVERRIDE = Object.keys(LOCAL_PODSPEC_RELATIVE_PATHS);

const POST_INSTALL_MARKER = '# >>> withLowerPodDeploymentTarget';
const POST_INSTALL_MARKER_END = '# <<< withLowerPodDeploymentTarget';
const PODSPEC_MARKER = '# >>> withLocalSwiftSecp256k1Podspec';
const PODSPEC_MARKER_END = '# <<< withLocalSwiftSecp256k1Podspec';

function buildPostInstallBlock() {
  const podNames = PODS_TO_OVERRIDE.map((n) => `'${n}'`).join(', ');
  return [
    `  ${POST_INSTALL_MARKER}`,
    `  installer.pods_project.targets.each do |t|`,
    `    if [${podNames}].include?(t.name)`,
    `      t.build_configurations.each do |config|`,
    `        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${TARGET_DEPLOYMENT}'`,
    `      end`,
    `    end`,
    `  end`,
    `  ${POST_INSTALL_MARKER_END}`,
  ].join('\n');
}

function buildLocalPodspecBlock() {
  const podLines = Object.entries(LOCAL_PODSPEC_RELATIVE_PATHS).map(
    ([podName, relativePath]) =>
      `  pod '${podName}', :podspec => File.expand_path('${relativePath}', __dir__)`
  );
  return [`  ${PODSPEC_MARKER}`, ...podLines, `  ${PODSPEC_MARKER_END}`].join('\n');
}

function injectLocalPodspecIntoTarget(podfile) {
  if (podfile.includes(PODSPEC_MARKER)) {
    return podfile;
  }

  const block = buildLocalPodspecBlock();
  const useExpoModulesRegex = /(\n\s*use_expo_modules!\s*\n)/;
  if (useExpoModulesRegex.test(podfile)) {
    return podfile.replace(useExpoModulesRegex, (match) => `${match}${block}\n`);
  }

  const firstTargetRegex = /(target ['"][^'"]+['"] do\s*\n)/;
  if (firstTargetRegex.test(podfile)) {
    return podfile.replace(firstTargetRegex, (match) => `${match}${block}\n`);
  }

  throw new Error(
    'Unable to inject local swift-secp256k1 podspec: no CocoaPods target found in Podfile.'
  );
}

function injectIntoPodfile(podfile) {
  let nextPodfile = injectLocalPodspecIntoTarget(podfile);

  const block = buildPostInstallBlock();
  const postInstallRegex = /post_install do \|installer\|\s*\n/;

  if (nextPodfile.includes(POST_INSTALL_MARKER)) {
    return nextPodfile;
  }

  if (postInstallRegex.test(nextPodfile)) {
    return nextPodfile.replace(postInstallRegex, (match) => `${match}${block}\n`);
  }

  const appended = `\npost_install do |installer|\n${block}\nend\n`;
  return `${nextPodfile.trimEnd()}\n${appended}`;
}

module.exports = function withLowerPodDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf8');
      const next = injectIntoPodfile(contents);
      if (next !== contents) {
        fs.writeFileSync(podfilePath, next);
      }
      return cfg;
    },
  ]);
};

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_ADD = 'add(expo.modules.liquidglassnative.LiquidButtonPackage())';

function findMainApplication(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainApplication(fullPath);
      if (found) return found;
      continue;
    }
    if (entry.name === 'MainApplication.kt') return fullPath;
  }
  return null;
}

module.exports = function withLiquidGlassMainApplication(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const javaSrcPath = path.join(projectRoot, 'app', 'src', 'main', 'java');
      if (!fs.existsSync(javaSrcPath)) return cfg;

      const mainApplicationPath = findMainApplication(javaSrcPath);
      if (!mainApplicationPath || !fs.existsSync(mainApplicationPath)) return cfg;

      const source = fs.readFileSync(mainApplicationPath, 'utf8');
      if (source.includes(PACKAGE_ADD)) return cfg;

      const applyMatch = source.match(/PackageList\(this\)\.packages\.apply\s*\{/);
      if (!applyMatch) return cfg;

      const insertIndex = applyMatch.index + applyMatch[0].length;
      const insertion = `\n          ${PACKAGE_ADD}`;
      const updated = source.slice(0, insertIndex) + insertion + source.slice(insertIndex);
      fs.writeFileSync(mainApplicationPath, updated);

      return cfg;
    },
  ]);
};

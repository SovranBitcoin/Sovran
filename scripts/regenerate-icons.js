#!/usr/bin/env node
/**
 * Regenerates .monicon/icons.js from the icons array in assets/icons/index.tsx.
 * Usage: node scripts/regenerate-icons.js
 */
const { loadIcons } = require('@monicon/core');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const iconsFile = path.join(ROOT, 'assets', 'icons', 'index.tsx');
const content = fs.readFileSync(iconsFile, 'utf-8');

// Extract the icons array from the TSX file
const match = content.match(/export const icons:\s*string\[\]\s*=\s*\[([\s\S]*?)\];/);
if (!match) {
  console.error('Could not find icons array in assets/icons/index.tsx');
  process.exit(1);
}

const icons = match[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
console.log(`Found ${icons.length} icons to load`);

loadIcons({
  icons,
  collections: ['circle-flags'],
  root: ROOT,
  type: 'cjs',
  outputFileName: 'icons',
  generateTypes: true,
})
  .then(() => {
    console.log('Done! .monicon/icons.js regenerated.');
  })
  .catch((err) => {
    console.error('Error regenerating icons:', err);
    process.exit(1);
  });

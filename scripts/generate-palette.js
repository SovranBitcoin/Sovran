/**
 * Palette Generation Script
 * 
 * Generates color palettes following the discovered patterns from existing themes.
 * 
 * Key Findings:
 * - Background image themes use IDENTICAL lightness values at each shade
 * - Hue is relatively constant across all shades
 * - Saturation follows a specific pattern (high at 950, lower in mid-tones)
 * - Shade 0 is always pure white (#FFFFFF)
 */

const chroma = require('chroma-js');
const fs = require('fs');
const path = require('path');

// The exact lightness values used by background image themes
// These were extracted from analyzing deepocean, cosmicpurple, mysticblue, royalpurple
const BACKGROUND_THEME_LIGHTNESS = {
  950: 3.7,
  900: 7.9,
  800: 9.4,
  700: 11.0,
  600: 12.5,
  500: 17.3,
  400: 32.2,
  300: 47.1,
  200: 65.9,
  100: 78.0,
  50: 92.0,
  0: 100.0,
};

// Saturation pattern for background themes
// At shade 950, saturation is high; it drops for other shades
const SATURATION_PATTERN = {
  950: 0.7,  // ~70% saturation at darkest
  // All other shades use the base saturation
};

/**
 * Generate a palette given a base hue and saturation
 * Following the background image theme pattern
 */
function generateBackgroundThemePalette(baseHue, baseSaturation, name = 'generated') {
  const palette = {};
  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];

  shades.forEach(shade => {
    const lightness = BACKGROUND_THEME_LIGHTNESS[shade] / 100;
    
    // Special handling for shade 0 - always white
    if (shade === 0) {
      palette[shade] = '#FFFFFF';
      return;
    }
    
    // Special handling for shade 950 - higher saturation
    let saturation = baseSaturation;
    if (shade === 950) {
      saturation = Math.min(0.9, baseSaturation * 2.5); // Boost saturation for darkest
    }
    
    // As lightness increases, reduce saturation towards 0 (white)
    // This creates a natural fade to white
    if (lightness > 0.5) {
      const fadeRatio = (lightness - 0.5) / 0.5;
      saturation = saturation * (1 - fadeRatio * 0.7);
    }
    
    try {
      const color = chroma.hsl(baseHue, saturation, lightness);
      palette[shade] = color.hex();
    } catch (e) {
      console.error(`Error generating shade ${shade}:`, e.message);
      palette[shade] = '#000000';
    }
  });

  return { name, palette };
}

/**
 * Generate a palette with constant saturation (like the existing background themes)
 */
function generateConstantSaturationPalette(baseHue, baseSaturation, name = 'generated') {
  const palette = {};
  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];

  shades.forEach(shade => {
    const lightness = BACKGROUND_THEME_LIGHTNESS[shade] / 100;
    
    // Shade 0 is always white
    if (shade === 0) {
      palette[shade] = '#FFFFFF';
      return;
    }
    
    // Shade 950 has boosted saturation
    let saturation = baseSaturation;
    if (shade === 950) {
      saturation = Math.min(0.9, baseSaturation * 2.5);
    }
    
    try {
      const color = chroma.hsl(baseHue, saturation, lightness);
      palette[shade] = color.hex();
    } catch (e) {
      palette[shade] = '#000000';
    }
  });

  return { name, palette };
}

/**
 * Validate a generated palette by comparing to expected patterns
 */
function validatePalette(palette) {
  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
  const issues = [];
  
  // Check shade 0 is white
  if (palette[0]?.toUpperCase() !== '#FFFFFF') {
    issues.push(`Shade 0 should be white, got: ${palette[0]}`);
  }
  
  // Check lightness progression
  let prevLightness = 0;
  shades.forEach(shade => {
    const color = palette[shade];
    if (color) {
      const [h, s, l] = chroma(color).hsl();
      if (l < prevLightness) {
        issues.push(`Lightness should increase: shade ${shade} (${(l*100).toFixed(1)}%) < previous (${(prevLightness*100).toFixed(1)}%)`);
      }
      prevLightness = l;
    }
  });
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Format palette for output
 */
function formatPalette(name, palette) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Generated Palette: ${name}`);
  console.log('='.repeat(60));
  
  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
  
  shades.forEach(shade => {
    const hex = palette[shade];
    if (hex) {
      try {
        const [h, s, l] = chroma(hex).hsl();
        console.log(`  ${shade.toString().padStart(3)}: ${hex.padEnd(9)} | HSL(${(h || 0).toFixed(0).padStart(3)}°, ${(s * 100).toFixed(1).padStart(5)}%, ${(l * 100).toFixed(1).padStart(5)}%)`);
      } catch (e) {
        console.log(`  ${shade}: ${hex}`);
      }
    }
  });
  
  // Validation
  const validation = validatePalette(palette);
  if (!validation.valid) {
    console.log('\n⚠️  Validation issues:');
    validation.issues.forEach(issue => console.log(`  - ${issue}`));
  } else {
    console.log('\n✓ Palette validation passed');
  }
}

/**
 * Export palette in themes.js format
 */
function exportAsThemeJS(name, palette) {
  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
  
  let output = `  '${name}': {\n`;
  shades.forEach((shade, i) => {
    const comma = i < shades.length - 1 ? ',' : '';
    output += `    ${shade}: '${palette[shade]}'${comma}\n`;
  });
  output += '  },';
  
  return output;
}

/**
 * Export palette in colorTheme.ts format (CSS variables)
 */
function exportAsColorThemeTS(name, palette) {
  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
  
  let output = `  // ${name} theme\n`;
  output += `  ${name}: vars({\n`;
  shades.forEach(shade => {
    output += `    '--color-primary-${shade}': '${palette[shade]}',\n`;
  });
  output += `    ...shadeColors,\n`;
  output += `  }),\n`;
  
  return output;
}

// ============================================================
// MAIN EXECUTION
// ============================================================

console.log('Palette Generator');
console.log('=================\n');

// Example: Generate palettes for different hues
const testPalettes = [
  { hue: 225, saturation: 0.25, name: 'test-blue' },       // Similar to deepocean
  { hue: 257, saturation: 0.27, name: 'test-purple' },     // Similar to cosmicpurple
  { hue: 246, saturation: 0.22, name: 'test-indigo' },     // Similar to mysticblue
  { hue: 249, saturation: 0.32, name: 'test-violet' },     // Similar to royalpurple
  { hue: 180, saturation: 0.30, name: 'test-teal' },       // New teal theme
  { hue: 320, saturation: 0.25, name: 'test-magenta' },    // New magenta theme
  { hue: 30, saturation: 0.35, name: 'test-warm' },        // New warm theme
];

const generatedPalettes = [];

testPalettes.forEach(({ hue, saturation, name }) => {
  const result = generateConstantSaturationPalette(hue, saturation, name);
  generatedPalettes.push(result);
  formatPalette(name, result.palette);
});

// Compare generated vs existing
console.log('\n' + '='.repeat(60));
console.log('COMPARISON: Generated vs Existing Themes');
console.log('='.repeat(60));

const { THEMES } = require('../themes.js');

const comparisons = [
  { generated: 'test-blue', existing: 'deepocean' },
  { generated: 'test-purple', existing: 'cosmicpurple' },
  { generated: 'test-indigo', existing: 'mysticblue' },
  { generated: 'test-violet', existing: 'royalpurple' },
];

comparisons.forEach(({ generated, existing }) => {
  console.log(`\n--- ${generated} vs ${existing} ---`);
  
  const genPalette = generatedPalettes.find(p => p.name === generated)?.palette;
  const existingPalette = THEMES[existing];
  
  if (!genPalette || !existingPalette) {
    console.log('  Could not compare');
    return;
  }
  
  const shades = [950, 500, 400, 200, 50, 0];
  shades.forEach(shade => {
    const genColor = genPalette[shade];
    const existColor = existingPalette[shade];
    
    if (genColor && existColor) {
      const [gh, gs, gl] = chroma(genColor).hsl();
      const [eh, es, el] = chroma(existColor).hsl();
      
      const hueDiff = Math.abs((gh || 0) - (eh || 0));
      const satDiff = Math.abs(gs - es) * 100;
      const lightDiff = Math.abs(gl - el) * 100;
      
      console.log(`  ${shade.toString().padStart(3)}: Gen=${genColor} Exist=${existColor} | ΔH=${hueDiff.toFixed(0)}° ΔS=${satDiff.toFixed(1)}% ΔL=${lightDiff.toFixed(1)}%`);
    }
  });
});

// Export generated palettes
console.log('\n' + '='.repeat(60));
console.log('EXPORT: themes.js format');
console.log('='.repeat(60));

generatedPalettes.forEach(({ name, palette }) => {
  console.log('\n' + exportAsThemeJS(name, palette));
});

console.log('\n' + '='.repeat(60));
console.log('EXPORT: colorTheme.ts format (CSS variables)');
console.log('='.repeat(60));

generatedPalettes.forEach(({ name, palette }) => {
  console.log('\n' + exportAsColorThemeTS(name, palette));
});

// Save results
const outputPath = path.join(__dirname, 'generated-palettes.json');
fs.writeFileSync(outputPath, JSON.stringify({
  palettes: generatedPalettes,
  lightnessTargets: BACKGROUND_THEME_LIGHTNESS,
  generatedAt: new Date().toISOString(),
}, null, 2));

console.log(`\n✓ Results saved to: ${outputPath}`);

// ============================================================
// EXPORT FUNCTIONS FOR USE AS MODULE
// ============================================================

module.exports = {
  generateBackgroundThemePalette,
  generateConstantSaturationPalette,
  validatePalette,
  formatPalette,
  exportAsThemeJS,
  exportAsColorThemeTS,
  BACKGROUND_THEME_LIGHTNESS,
};


/**
 * Color Palette Analysis Script
 *
 * Analyzes existing theme palettes to find patterns in:
 * - Lightness progression
 * - Hue consistency
 * - Saturation changes
 *
 * Outputs colors in multiple formats: HEX, RGB, HSL, HSV, Lab
 */

const chroma = require('chroma-js');
const { THEMES } = require('../themes');

// Shade levels in order from darkest to lightest (for dark themes)
const SHADE_LEVELS = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];

/**
 * Convert a hex color to multiple formats
 */
function convertColor(hex) {
  try {
    const color = chroma(hex);
    return {
      hex: hex,
      rgb: color.rgb(),
      hsl: color.hsl(),
      hsv: color.hsv(),
      lab: color.lab(),
      lch: color.lch(),
      luminance: color.luminance(),
    };
  } catch (e) {
    return { hex, error: e.message };
  }
}

/**
 * Analyze a single palette
 */
function analyzePalette(name, palette) {
  const analysis = {
    name,
    colors: {},
    progressions: {
      lightness: [],
      hue: [],
      saturation: [],
      luminance: [],
    },
    patterns: {},
  };

  // Convert each shade
  SHADE_LEVELS.forEach((shade) => {
    const hex = palette[shade];
    if (hex) {
      analysis.colors[shade] = convertColor(hex);
    }
  });

  // Calculate progressions
  let prevLightness = null;
  let prevHue = null;
  let prevSaturation = null;
  let prevLuminance = null;

  SHADE_LEVELS.forEach((shade) => {
    const color = analysis.colors[shade];
    if (color && !color.error) {
      const [h, s, l] = color.hsl;
      const luminance = color.luminance;

      // Track absolute values
      analysis.progressions.lightness.push({ shade, value: l });
      analysis.progressions.hue.push({ shade, value: h });
      analysis.progressions.saturation.push({ shade, value: s });
      analysis.progressions.luminance.push({ shade, value: luminance });

      // Calculate deltas
      if (prevLightness !== null) {
        const deltaL = l - prevLightness;
        const deltaH = h - prevHue;
        const deltaS = s - prevSaturation;
        const deltaLum = luminance - prevLuminance;

        analysis.colors[shade].delta = {
          lightness: deltaL,
          hue: deltaH,
          saturation: deltaS,
          luminance: deltaLum,
        };
      }

      prevLightness = l;
      prevHue = h;
      prevSaturation = s;
      prevLuminance = luminance;
    }
  });

  // Analyze patterns
  const lightnesses = analysis.progressions.lightness.map((p) => p.value);
  const saturations = analysis.progressions.saturation.map((p) => p.value);
  const hues = analysis.progressions.hue.filter((p) => !isNaN(p.value)).map((p) => p.value);

  analysis.patterns = {
    lightnessRange: {
      min: Math.min(...lightnesses),
      max: Math.max(...lightnesses),
      spread: Math.max(...lightnesses) - Math.min(...lightnesses),
    },
    saturationRange: {
      min: Math.min(...saturations),
      max: Math.max(...saturations),
      spread: Math.max(...saturations) - Math.min(...saturations),
    },
    hueRange:
      hues.length > 0
        ? {
            min: Math.min(...hues),
            max: Math.max(...hues),
            spread: Math.max(...hues) - Math.min(...hues),
            average: hues.reduce((a, b) => a + b, 0) / hues.length,
          }
        : null,
    isDarkTheme: lightnesses[0] < lightnesses[lightnesses.length - 1],
    endsWithWhite: analysis.colors[0]?.hex?.toUpperCase() === '#FFFFFF',
    endsWithBlack: analysis.colors[0]?.hex?.toUpperCase() === '#000000',
  };

  return analysis;
}

/**
 * Analyze lightness progression pattern (linear, exponential, etc.)
 */
function analyzeLightnessPattern(progressions) {
  const values = progressions.map((p) => p.value);
  const shades = progressions.map((p) => p.shade);

  // Calculate steps between consecutive values
  const steps = [];
  for (let i = 1; i < values.length; i++) {
    steps.push({
      from: shades[i - 1],
      to: shades[i],
      delta: values[i] - values[i - 1],
      ratio: values[i - 1] !== 0 ? values[i] / values[i - 1] : null,
    });
  }

  // Check if linear (constant delta)
  const avgDelta = steps.reduce((a, b) => a + b.delta, 0) / steps.length;
  const deltaVariance =
    steps.reduce((a, b) => a + Math.pow(b.delta - avgDelta, 2), 0) / steps.length;

  return {
    steps,
    avgDelta,
    deltaVariance,
    isLinear: deltaVariance < 0.01,
  };
}

/**
 * Format analysis for output
 */
function formatAnalysis(analysis) {
  console.log('\n' + '='.repeat(80));
  console.log(`THEME: ${analysis.name}`);
  console.log('='.repeat(80));

  console.log('\n--- Colors in Multiple Formats ---');
  SHADE_LEVELS.forEach((shade) => {
    const color = analysis.colors[shade];
    if (color && !color.error) {
      const [h, s, l] = color.hsl;
      const [hv, sv, v] = color.hsv;
      console.log(
        `  ${shade.toString().padStart(3)}: ${color.hex.padEnd(9)} | RGB(${color.rgb.map((v) => Math.round(v).toString().padStart(3)).join(',')}) | HSL(${Math.round(
          h || 0
        )
          .toString()
          .padStart(
            3
          )}°, ${(s * 100).toFixed(1).padStart(5)}%, ${(l * 100).toFixed(1).padStart(5)}%) | Lum: ${color.luminance.toFixed(4)}`
      );
    }
  });

  console.log('\n--- Patterns ---');
  console.log(`  Is Dark Theme: ${analysis.patterns.isDarkTheme}`);
  console.log(`  Ends with White: ${analysis.patterns.endsWithWhite}`);
  console.log(`  Ends with Black: ${analysis.patterns.endsWithBlack}`);
  console.log(
    `  Lightness Range: ${(analysis.patterns.lightnessRange.min * 100).toFixed(1)}% - ${(analysis.patterns.lightnessRange.max * 100).toFixed(1)}% (spread: ${(analysis.patterns.lightnessRange.spread * 100).toFixed(1)}%)`
  );
  console.log(
    `  Saturation Range: ${(analysis.patterns.saturationRange.min * 100).toFixed(1)}% - ${(analysis.patterns.saturationRange.max * 100).toFixed(1)}% (spread: ${(analysis.patterns.saturationRange.spread * 100).toFixed(1)}%)`
  );
  if (analysis.patterns.hueRange) {
    console.log(
      `  Hue Range: ${analysis.patterns.hueRange.min.toFixed(1)}° - ${analysis.patterns.hueRange.max.toFixed(1)}° (avg: ${analysis.patterns.hueRange.average.toFixed(1)}°, spread: ${analysis.patterns.hueRange.spread.toFixed(1)}°)`
    );
  }

  // Analyze lightness progression
  const lightnessPattern = analyzeLightnessPattern(analysis.progressions.lightness);
  console.log('\n--- Lightness Progression ---');
  console.log(`  Average Step: ${(lightnessPattern.avgDelta * 100).toFixed(2)}%`);
  console.log(`  Is Linear: ${lightnessPattern.isLinear}`);
  console.log(`  Step Details:`);
  lightnessPattern.steps.forEach((step) => {
    console.log(`    ${step.from} → ${step.to}: Δ${(step.delta * 100).toFixed(2)}%`);
  });
}

/**
 * Compare background image themes specifically
 */
function compareBackgroundThemes() {
  const bgThemes = ['deepocean', 'cosmicpurple', 'mysticblue', 'royalpurple'];

  console.log('\n' + '='.repeat(80));
  console.log('BACKGROUND IMAGE THEMES COMPARISON');
  console.log('='.repeat(80));

  const analyses = bgThemes.map((name) => analyzePalette(name, THEMES[name]));

  // Compare anchor points
  console.log('\n--- Anchor Point Comparison ---');
  console.log('Shade | ' + bgThemes.map((t) => t.padEnd(12)).join(' | '));
  console.log('-'.repeat(80));

  SHADE_LEVELS.forEach((shade) => {
    const row = analyses.map((a) => {
      const color = a.colors[shade];
      if (color && !color.error) {
        const [h, s, l] = color.hsl;
        return `L:${(l * 100).toFixed(0).padStart(3)}%`;
      }
      return 'N/A'.padEnd(12);
    });
    console.log(`${shade.toString().padStart(5)} | ${row.join(' | ')}`);
  });

  // Find common patterns
  console.log('\n--- Common Patterns ---');
  const avgLightnessPerShade = {};
  SHADE_LEVELS.forEach((shade) => {
    const lightnesses = analyses
      .map((a) => a.colors[shade]?.hsl?.[2])
      .filter((l) => l !== undefined);
    avgLightnessPerShade[shade] = lightnesses.reduce((a, b) => a + b, 0) / lightnesses.length;
  });

  console.log('Average Lightness per Shade (Background Themes):');
  SHADE_LEVELS.forEach((shade) => {
    console.log(
      `  ${shade.toString().padStart(3)}: ${(avgLightnessPerShade[shade] * 100).toFixed(1)}%`
    );
  });

  return analyses;
}

/**
 * Generate a summary of all themes
 */
function generateSummary(allAnalyses) {
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY OF ALL THEMES');
  console.log('='.repeat(80));

  // Categorize themes
  const darkThemes = allAnalyses.filter((a) => a.patterns.isDarkTheme);
  const lightThemes = allAnalyses.filter((a) => !a.patterns.isDarkTheme);

  console.log(`\nDark Themes (${darkThemes.length}): ${darkThemes.map((a) => a.name).join(', ')}`);
  console.log(`Light Themes (${lightThemes.length}): ${lightThemes.map((a) => a.name).join(', ')}`);

  // Average patterns for dark themes
  if (darkThemes.length > 0) {
    console.log('\n--- Average Patterns for Dark Themes ---');
    const avgLightnesses = {};
    SHADE_LEVELS.forEach((shade) => {
      const values = darkThemes
        .map((a) => a.colors[shade]?.hsl?.[2])
        .filter((v) => v !== undefined);
      avgLightnesses[shade] = values.reduce((a, b) => a + b, 0) / values.length;
    });
    SHADE_LEVELS.forEach((shade) => {
      console.log(
        `  ${shade.toString().padStart(3)}: ${(avgLightnesses[shade] * 100).toFixed(1)}%`
      );
    });
  }

  // Find the "typical" lightness curve
  console.log('\n--- Typical Lightness Values (as percentages) ---');
  console.log('These can be used as target values when generating new palettes:');
  console.log('const LIGHTNESS_TARGETS = {');
  SHADE_LEVELS.forEach((shade, i) => {
    const values = darkThemes.map((a) => a.colors[shade]?.hsl?.[2]).filter((v) => v !== undefined);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const comma = i < SHADE_LEVELS.length - 1 ? ',' : '';
    console.log(`  ${shade}: ${(avg * 100).toFixed(1)}${comma}`);
  });
  console.log('};');
}

// Main execution
console.log('Color Palette Analysis');
console.log('Analyzing themes from themes.js...\n');

const allAnalyses = [];

// Analyze all themes
Object.keys(THEMES).forEach((themeName) => {
  const analysis = analyzePalette(themeName, THEMES[themeName]);
  allAnalyses.push(analysis);
  formatAnalysis(analysis);
});

// Special comparison of background image themes
const bgAnalyses = compareBackgroundThemes();

// Generate overall summary
generateSummary(allAnalyses);

// Export analysis data for further processing
console.log('\n\n--- Raw Analysis Data (JSON) ---');
console.log('Writing detailed analysis to scripts/palette-analysis-results.json...');

const fs = require('fs');
const outputPath = require('path').join(__dirname, 'palette-analysis-results.json');
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      allAnalyses,
      backgroundThemes: bgAnalyses,
      metadata: {
        totalThemes: allAnalyses.length,
        shadelevels: SHADE_LEVELS,
        generatedAt: new Date().toISOString(),
      },
    },
    null,
    2
  )
);

console.log('Done!');

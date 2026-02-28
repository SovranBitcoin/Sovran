/**
 * Image Color Extraction Script
 *
 * Extracts colors from background images and compares them
 * to the existing theme palettes.
 */

const getColors = require('get-image-colors');
const chroma = require('chroma-js');
const path = require('path');
const fs = require('fs');
const { THEMES } = require('../themes');

// Background image themes and their images
const BACKGROUND_THEMES = {
  deepocean: 'deepocean.png',
  cosmicpurple: 'cosmicpurple.png',
  mysticblue: 'mysticblue.png',
  royalpurple: 'royalpurple.png',
};

// The discovered lightness targets from the analysis
const LIGHTNESS_TARGETS = {
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

/**
 * Extract colors from an image
 */
async function extractColors(imagePath) {
  try {
    const colors = await getColors(imagePath, { count: 10, type: 'image/png' });
    return colors.map((color) => ({
      hex: color.hex(),
      rgb: color.rgb(),
      hsl: [color.hsl()[0] * 360, color.hsl()[1], color.hsl()[2]],
      hsv: color.hsv(),
    }));
  } catch (error) {
    console.error(`Error extracting colors from ${imagePath}:`, error.message);
    return [];
  }
}

/**
 * Find the dominant hue from extracted colors
 */
function findDominantHue(colors) {
  // Filter out very light/dark colors and those with low saturation
  const validColors = colors.filter((c) => {
    const [h, s, l] = c.hsl;
    return s > 0.05 && l > 0.1 && l < 0.9;
  });

  if (validColors.length === 0) return null;

  // Average the hues (handling the circular nature of hue)
  let sinSum = 0;
  let cosSum = 0;
  validColors.forEach((c) => {
    const hueRad = (c.hsl[0] * Math.PI) / 180;
    sinSum += Math.sin(hueRad);
    cosSum += Math.cos(hueRad);
  });

  const avgHue =
    (Math.atan2(sinSum / validColors.length, cosSum / validColors.length) * 180) / Math.PI;
  return avgHue < 0 ? avgHue + 360 : avgHue;
}

/**
 * Find the average saturation from extracted colors
 */
function findAverageSaturation(colors) {
  const validColors = colors.filter((c) => {
    const [h, s, l] = c.hsl;
    return l > 0.1 && l < 0.9;
  });

  if (validColors.length === 0) return 0.2;

  return validColors.reduce((sum, c) => sum + c.hsl[1], 0) / validColors.length;
}

/**
 * Compare extracted colors to existing theme
 */
function compareToTheme(themeName, extractedColors) {
  const theme = THEMES[themeName];
  if (!theme) return null;

  console.log(`\n--- Comparing extracted colors to ${themeName} theme ---`);

  // Get the theme's anchor color (shade 500 or 600)
  const anchorColor = theme[500];
  const anchorChroma = chroma(anchorColor);
  const [anchorH, anchorS, anchorL] = anchorChroma.hsl();

  console.log(`Theme anchor (500): ${anchorColor}`);
  console.log(`  Hue: ${(anchorH || 0).toFixed(1)}°`);
  console.log(`  Saturation: ${(anchorS * 100).toFixed(1)}%`);
  console.log(`  Lightness: ${(anchorL * 100).toFixed(1)}%`);

  // Find dominant hue from extracted colors
  const dominantHue = findDominantHue(extractedColors);
  const avgSaturation = findAverageSaturation(extractedColors);

  console.log(`\nExtracted dominant hue: ${dominantHue?.toFixed(1) || 'N/A'}°`);
  console.log(`Extracted avg saturation: ${(avgSaturation * 100).toFixed(1)}%`);

  if (dominantHue !== null) {
    const hueDiff = Math.abs(dominantHue - (anchorH || 0));
    console.log(`Hue difference from theme: ${hueDiff.toFixed(1)}°`);
  }

  return {
    themeName,
    themeHue: anchorH,
    themeSaturation: anchorS,
    extractedHue: dominantHue,
    extractedSaturation: avgSaturation,
  };
}

/**
 * Analyze the saturation pattern in a theme
 */
function analyzeSaturationPattern(themeName) {
  const theme = THEMES[themeName];
  if (!theme) return null;

  console.log(`\n--- Saturation pattern for ${themeName} ---`);

  const shades = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
  const saturations = [];

  shades.forEach((shade) => {
    const color = theme[shade];
    if (color) {
      try {
        const c = chroma(color);
        const [h, s, l] = c.hsl();
        saturations.push({ shade, saturation: s, hue: h });
        console.log(
          `  ${shade.toString().padStart(3)}: H=${(h || 0).toFixed(0).padStart(3)}° S=${(s * 100).toFixed(1).padStart(5)}%`
        );
      } catch (e) {
        console.log(`  ${shade}: Error parsing color`);
      }
    }
  });

  return saturations;
}

/**
 * Main analysis
 */
async function main() {
  console.log('Image Color Extraction Analysis');
  console.log('================================\n');

  const imagesDir = path.join(__dirname, '..', 'assets', 'images', 'backgrounds');
  const results = {};

  // Extract colors from each image
  for (const [themeName, imageName] of Object.entries(BACKGROUND_THEMES)) {
    const imagePath = path.join(imagesDir, imageName);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`ANALYZING: ${themeName} (${imageName})`);
    console.log('='.repeat(60));

    if (!fs.existsSync(imagePath)) {
      console.log(`Image not found: ${imagePath}`);
      continue;
    }

    // Extract colors
    const extractedColors = await extractColors(imagePath);

    console.log('\nExtracted colors from image:');
    extractedColors.forEach((c, i) => {
      console.log(
        `  ${i + 1}. ${c.hex} | HSL(${c.hsl[0].toFixed(0)}°, ${(c.hsl[1] * 100).toFixed(1)}%, ${(c.hsl[2] * 100).toFixed(1)}%)`
      );
    });

    // Compare to existing theme
    const comparison = compareToTheme(themeName, extractedColors);

    // Analyze saturation pattern
    const saturationPattern = analyzeSaturationPattern(themeName);

    results[themeName] = {
      extractedColors,
      comparison,
      saturationPattern,
    };
  }

  // Summary of findings
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY: SATURATION PATTERN ANALYSIS');
  console.log('='.repeat(60));

  // Check if saturation follows a pattern
  console.log('\nSaturation at key anchor points across all background themes:');
  console.log('Shade | ' + Object.keys(BACKGROUND_THEMES).join(' | '));

  const keyShades = [950, 500, 400, 200, 50];
  keyShades.forEach((shade) => {
    const row = Object.keys(BACKGROUND_THEMES).map((themeName) => {
      const theme = THEMES[themeName];
      if (!theme || !theme[shade]) return 'N/A';
      try {
        const [h, s, l] = chroma(theme[shade]).hsl();
        return `${(s * 100).toFixed(0)}%`.padEnd(12);
      } catch (e) {
        return 'Err'.padEnd(12);
      }
    });
    console.log(`${shade.toString().padStart(4)} | ${row.join(' | ')}`);
  });

  // Output the formula
  console.log('\n' + '='.repeat(60));
  console.log('DISCOVERED FORMULA');
  console.log('='.repeat(60));

  console.log(`
Based on analysis, the background themes appear to follow this pattern:

1. LIGHTNESS: Fixed values at each shade level:
   const LIGHTNESS_TARGETS = {
     950: 3.7, 900: 7.9, 800: 9.4, 700: 11.0, 600: 12.5,
     500: 17.3, 400: 32.2, 300: 47.1, 200: 65.9, 100: 78.0,
     50: 92.0, 0: 100.0
   };

2. HUE: Relatively constant across shades (varies only ~3-5°)
   - Derived from dominant image color

3. SATURATION: Follows a pattern tied to lightness
   - Higher saturation at dark end (950: ~65-90%)
   - Lower saturation in mid-tones (~12-32%)
   - Near-zero at light end (approaches white)

4. SHADE 0: Always pure white (#FFFFFF)
`);

  // Save results
  const outputPath = path.join(__dirname, 'image-extraction-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(console.error);

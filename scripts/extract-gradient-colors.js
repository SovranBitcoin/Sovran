#!/usr/bin/env node
/**
 * Gradient Color Extraction Script
 *
 * Extracts a gradient palette from background images - finding representative
 * colors at different lightness levels to create smooth gradients.
 *
 * Output: 3 colors from light → mid → dark that can be used for CSS gradients.
 *
 * Example result for cosmic-purple:
 * - #3E88AF (light blue, ~69% brightness)
 * - #3B2E88 (mid purple, ~53% brightness)
 * - #0D0621 (dark purple, ~13% brightness)
 *
 * Usage: node scripts/extract-gradient-colors.js [imageName]
 */

const fs = require('fs');
const path = require('path');
const chroma = require('chroma-js');
const getColors = require('get-image-colors');

const BACKGROUNDS_DIR = path.join(__dirname, '..', 'assets', 'images', 'backgrounds');

/**
 * Calculate color distance using Delta E (CIE76)
 */
function colorDistance(hex1, hex2) {
  try {
    const lab1 = chroma(hex1).lab();
    const lab2 = chroma(hex2).lab();
    return Math.sqrt(
      Math.pow(lab1[0] - lab2[0], 2) +
        Math.pow(lab1[1] - lab2[1], 2) +
        Math.pow(lab1[2] - lab2[2], 2)
    );
  } catch (e) {
    return 0;
  }
}

/**
 * Get HSB (HSV) values from a hex color
 * Returns { hue, saturation, brightness } in degrees and percentages
 */
function getHSB(hex) {
  try {
    const [h, s, v] = chroma(hex).hsv();
    return {
      hue: Math.round(h || 0),
      saturation: Math.round((s || 0) * 100),
      brightness: Math.round((v || 0) * 100),
    };
  } catch (e) {
    return { hue: 0, saturation: 0, brightness: 0 };
  }
}

/**
 * Find the best representative color for a lightness band
 * For light colors: prioritize prevalence and saturation (allow hue variety)
 * For mid/dark colors: prefer cohesion with dominant hue
 */
function findBestColorInBand(colors, dominantHue, targetBrightness, bandType = 'mid') {
  if (colors.length === 0) return null;

  // Score each color based on different criteria depending on band type
  const scored = colors.map((c) => {
    const hsb = getHSB(c.hex);

    // Brightness proximity score (closer to target is better)
    const brightnessDiff = Math.abs(hsb.brightness - targetBrightness);
    const brightnessScore = 1 - brightnessDiff / 100;

    // Saturation score (prefer saturated colors)
    const saturationScore = hsb.saturation / 100;

    // Hue cohesion score
    let hueDiff = Math.abs(hsb.hue - dominantHue);
    if (hueDiff > 180) hueDiff = 360 - hueDiff;
    const hueScore = hueDiff < 60 ? 1 - hueDiff / 120 : 0.3;

    // Prevalence bonus (earlier colors are more common in image)
    const prevalenceScore = 1 - c.prevalence / 100;

    // Different scoring weights based on band type
    let score;
    if (bandType === 'light') {
      // For light band: heavily prioritize prevalence (what's actually visible in light areas)
      // This captures sky colors, highlights, atmospheric colors
      // Saturation still matters but don't over-weight it
      score =
        brightnessScore * 0.2 +
        saturationScore * 0.2 +
        prevalenceScore * 0.55 + // Most common light color wins
        hueScore * 0.05;
    } else if (bandType === 'dark') {
      // For dark band: prioritize darkness, saturation, and hue cohesion
      score =
        brightnessScore * 0.3 + saturationScore * 0.25 + prevalenceScore * 0.2 + hueScore * 0.25;
    } else {
      // Mid band: balanced approach, slight hue cohesion preference
      score =
        brightnessScore * 0.25 + saturationScore * 0.25 + prevalenceScore * 0.25 + hueScore * 0.25;
    }

    return { ...c, hsb, score };
  });

  // Sort by score and return the best
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

/**
 * Extract gradient colors from an image
 * Returns 3 colors: light, mid, dark - suitable for gradient backgrounds
 */
async function extractGradientColors(imagePath, options = {}) {
  const { extractCount = 60 } = options;

  try {
    // Extract many colors from the image
    const rawColors = await getColors(imagePath, {
      count: extractCount,
      type: 'image/png',
    });

    // Convert to our format with HSB data
    const colors = rawColors.map((c, index) => {
      const hex = c.hex().toUpperCase();
      const hsb = getHSB(hex);
      return {
        hex,
        ...hsb,
        prevalence: index,
      };
    });

    // Find the dominant hue (most common hue among saturated colors)
    const saturatedColors = colors.filter((c) => c.saturation > 30 && c.brightness > 10);
    let dominantHue = 0;
    if (saturatedColors.length > 0) {
      // Use circular mean for hue
      let sinSum = 0,
        cosSum = 0;
      saturatedColors.slice(0, 10).forEach((c) => {
        const rad = (c.hue * Math.PI) / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
      });
      dominantHue = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
      if (dominantHue < 0) dominantHue += 360;
    }

    // Define brightness bands for gradient extraction
    // Light: 55-85%, Mid: 35-60%, Dark: 5-25%
    const lightBand = colors.filter((c) => c.brightness >= 55 && c.brightness <= 85);
    const midBand = colors.filter((c) => c.brightness >= 35 && c.brightness <= 60);
    const darkBand = colors.filter((c) => c.brightness >= 5 && c.brightness <= 25);

    // Find best color in each band (passing band type for different scoring)
    const lightColor = findBestColorInBand(lightBand, dominantHue, 70, 'light');
    const midColor = findBestColorInBand(midBand, dominantHue, 50, 'mid');
    const darkColor = findBestColorInBand(darkBand, dominantHue, 15, 'dark');

    // Build gradient array (filter out nulls)
    const gradient = [];

    if (lightColor) {
      gradient.push({
        hex: lightColor.hex,
        position: 'light',
        hsb: lightColor.hsb,
      });
    }

    if (midColor) {
      gradient.push({
        hex: midColor.hex,
        position: 'mid',
        hsb: midColor.hsb,
      });
    }

    if (darkColor) {
      gradient.push({
        hex: darkColor.hex,
        position: 'dark',
        hsb: darkColor.hsb,
      });
    }

    return {
      gradient,
      dominantHue: Math.round(dominantHue),
    };
  } catch (error) {
    console.error(`Error extracting gradient from ${imagePath}:`, error.message);
    return { gradient: [], dominantHue: 0 };
  }
}

/**
 * Format gradient as CSS
 */
function formatGradientCSS(gradient) {
  if (gradient.length === 0) return 'none';
  if (gradient.length === 1) return gradient[0].hex;

  const colors = gradient.map((c) => c.hex).join(', ');
  return `linear-gradient(to bottom, ${colors})`;
}

/**
 * Main function - process all backgrounds or a specific one
 */
async function main() {
  const targetImage = process.argv[2];

  let files;
  if (targetImage) {
    const fullPath = path.join(BACKGROUNDS_DIR, targetImage);
    if (!fs.existsSync(fullPath)) {
      const extensions = ['.png', '.jpg', '.jpeg', '.webp'];
      const found = extensions.find((ext) =>
        fs.existsSync(path.join(BACKGROUNDS_DIR, targetImage + ext))
      );
      if (found) {
        files = [targetImage + found];
      } else {
        console.error(`Image not found: ${targetImage}`);
        process.exit(1);
      }
    } else {
      files = [targetImage];
    }
  } else {
    files = fs.readdirSync(BACKGROUNDS_DIR).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  }

  console.log('='.repeat(70));
  console.log('Gradient Color Extraction');
  console.log('='.repeat(70) + '\n');

  const results = {};

  for (const file of files) {
    const imagePath = path.join(BACKGROUNDS_DIR, file);
    const themeName = path
      .basename(file, path.extname(file))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    console.log(`Processing: ${file}`);
    console.log('-'.repeat(50));

    const { gradient, dominantHue } = await extractGradientColors(imagePath);

    results[themeName] = {
      filename: file,
      dominantHue,
      gradient,
    };

    // Display results
    console.log(`  Dominant Hue: ${dominantHue}°`);
    console.log('  Gradient Colors:');
    gradient.forEach((color) => {
      const { hue, saturation, brightness } = color.hsb;
      console.log(
        `    ${color.position.padEnd(6)}: ${color.hex}  HSB(${hue}°, ${saturation}%, ${brightness}%)`
      );
    });
    console.log(`  CSS: ${formatGradientCSS(gradient)}`);
    console.log('');
  }

  // Output for copying
  console.log('='.repeat(70));
  console.log('Results Summary:');
  console.log('='.repeat(70) + '\n');

  for (const [themeName, data] of Object.entries(results)) {
    console.log(`${themeName}:`);
    console.log(`  dominantHue: ${data.dominantHue},`);
    console.log(`  gradientColors: [`);
    data.gradient.forEach((c) => {
      console.log(
        `    { hex: '${c.hex}', position: '${c.position}', hue: ${c.hsb.hue}, saturation: ${c.hsb.saturation}, brightness: ${c.hsb.brightness} },`
      );
    });
    console.log(`  ],`);
    console.log('');
  }

  // Save results
  const outputPath = path.join(__dirname, 'gradient-colors-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to: ${outputPath}`);

  return results;
}

main().catch(console.error);

module.exports = { extractGradientColors, getHSB, formatGradientCSS };

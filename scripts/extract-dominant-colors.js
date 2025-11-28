#!/usr/bin/env node
/**
 * Dominant Color Extraction Script
 *
 * Extracts the top N visually distinct dominant colors from background images,
 * similar to online color palette generators.
 *
 * This produces colors like the website results:
 * - #262473 (dark purple/blue)
 * - #423FA6 (medium purple/blue)
 * - #4679A6 (blue-teal)
 * - #3C92A6 (teal)
 * - #04D976 (accent green)
 *
 * Usage: node scripts/extract-dominant-colors.js [imageName]
 */

const fs = require('fs');
const path = require('path');
const chroma = require('chroma-js');
const getColors = require('get-image-colors');

const BACKGROUNDS_DIR = path.join(__dirname, '..', 'assets', 'images', 'backgrounds');

/**
 * Calculate color distance using Delta E (CIE76)
 * Lower values = more similar colors
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
 * Filter colors to get visually distinct ones
 * Removes colors that are too similar to each other
 */
function filterDistinctColors(colors, minDistance = 15) {
  const distinct = [];

  for (const color of colors) {
    // Check if this color is distinct from all already selected colors
    const isTooSimilar = distinct.some((existingColor) => {
      return colorDistance(color.hex, existingColor.hex) < minDistance;
    });

    if (!isTooSimilar) {
      distinct.push(color);
    }
  }

  return distinct;
}

/**
 * Extract dominant colors from an image
 * Returns array of hex colors sorted by visual prominence
 * 
 * Strategy: Extract many colors, then select a diverse set that:
 * 1. Covers the main hue ranges present in the image
 * 2. Includes both mid-tones and accent colors
 * 3. Avoids near-black and near-white
 */
async function extractDominantColors(imagePath, options = {}) {
  const {
    count = 5, // Number of dominant colors to return
    extractCount = 50, // Number of colors to extract before filtering
    minDistance = 22, // Minimum Delta E distance between colors
  } = options;

  try {
    // Extract many colors from the image
    const rawColors = await getColors(imagePath, {
      count: extractCount,
      type: 'image/png',
    });

    // Convert to our format with metadata
    const colors = rawColors.map((c, index) => {
      const hex = c.hex().toUpperCase();
      const [h, s, l] = chroma(hex).hsl();
      return {
        hex,
        hue: h || 0,
        saturation: s || 0,
        lightness: l || 0,
        prevalence: index, // Lower = more common in image
      };
    });

    // Filter out very dark (near black) and very light (near white) colors
    const filtered = colors.filter((c) => {
      return c.lightness > 0.10 && c.lightness < 0.80;
    });

    // Score each color for selection
    // We want colors that are: prevalent, saturated, and mid-lightness
    const scored = filtered.map(c => {
      // Base score from prevalence (first colors are most common)
      const prevalenceScore = 1 - (c.prevalence / extractCount);
      
      // Saturation boost - highly saturated colors are accent colors we want
      let saturationBoost = 0;
      if (c.saturation >= 0.8) saturationBoost = 0.4; // Very saturated accent
      else if (c.saturation >= 0.5) saturationBoost = 0.25;
      else if (c.saturation >= 0.35) saturationBoost = 0.15;
      
      // Lightness boost - prefer mid-tones (20-55% lightness)
      let lightnessBoost = 0;
      if (c.lightness >= 0.20 && c.lightness <= 0.55) lightnessBoost = 0.2;
      else if (c.lightness >= 0.15 && c.lightness <= 0.65) lightnessBoost = 0.1;
      
      return {
        ...c,
        score: prevalenceScore + saturationBoost + lightnessBoost,
      };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Filter to get visually distinct colors
    const distinct = filterDistinctColors(scored, minDistance);

    // Return the top N distinct colors, sorted by lightness (darkest first like website)
    const result = distinct.slice(0, count);
    result.sort((a, b) => a.lightness - b.lightness);

    return result.map((c) => ({
      hex: c.hex,
      hue: Math.round(c.hue),
      saturation: Math.round(c.saturation * 100),
      lightness: Math.round(c.lightness * 100),
    }));
  } catch (error) {
    console.error(`Error extracting colors from ${imagePath}:`, error.message);
    return [];
  }
}

/**
 * Get a categorized description of a color based on its hue/saturation
 */
function getColorCategory(hex) {
  const [h, s, l] = chroma(hex).hsl();
  const hue = h || 0;
  const sat = s || 0;
  const light = l || 0;

  if (sat < 0.1) {
    if (light < 0.2) return 'near-black';
    if (light > 0.8) return 'near-white';
    return 'gray';
  }

  // Color categories based on hue
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 75) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 195) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 285) return 'purple';
  return 'magenta';
}

/**
 * Main function - process all backgrounds or a specific one
 */
async function main() {
  const targetImage = process.argv[2];

  let files;
  if (targetImage) {
    // Process specific image
    const fullPath = path.join(BACKGROUNDS_DIR, targetImage);
    if (!fs.existsSync(fullPath)) {
      // Try adding common extensions
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
    // Process all images
    files = fs.readdirSync(BACKGROUNDS_DIR).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  }

  console.log('='.repeat(70));
  console.log('Dominant Color Extraction');
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

    const dominantColors = await extractDominantColors(imagePath, {
      count: 5,
      extractCount: 30,
      minDistance: 18,
    });

    results[themeName] = {
      filename: file,
      dominantColors,
    };

    // Display results
    dominantColors.forEach((color, i) => {
      const category = getColorCategory(color.hex);
      console.log(
        `  ${i + 1}. ${color.hex}  H:${String(color.hue).padStart(3)}° S:${String(color.saturation).padStart(3)}% L:${String(color.lightness).padStart(3)}%  [${category}]`
      );
    });

    console.log('');
  }

  // Output in a format suitable for copying
  console.log('='.repeat(70));
  console.log('Results Summary (for copying):');
  console.log('='.repeat(70) + '\n');

  for (const [themeName, data] of Object.entries(results)) {
    console.log(`${themeName}:`);
    console.log(`  dominantColors: [`);
    data.dominantColors.forEach((c) => {
      console.log(`    '${c.hex}',`);
    });
    console.log(`  ],`);
    console.log('');
  }

  // Save results
  const outputPath = path.join(__dirname, 'dominant-colors-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to: ${outputPath}`);

  return results;
}

main().catch(console.error);

module.exports = { extractDominantColors, filterDistinctColors, colorDistance };


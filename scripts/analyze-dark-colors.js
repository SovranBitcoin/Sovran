#!/usr/bin/env node
/**
 * Analyze Dark Colors Script
 * 
 * Analyzes background images to find the dominant dark color
 * that should be used as shade 900.
 */

const getColors = require('get-image-colors');
const chroma = require('chroma-js');
const path = require('path');
const fs = require('fs');

const BACKGROUNDS_DIR = path.join(__dirname, '..', 'assets', 'images', 'backgrounds');

/**
 * Extract colors and find the dominant dark color
 */
async function analyzeDarkColors(imagePath) {
  const colors = await getColors(imagePath, { count: 20, type: 'image/png' });
  
  const analyzed = colors.map((c) => {
    const chromaColor = chroma(c.hex());
    const [h, s, l] = chromaColor.hsl();
    return {
      hex: c.hex(),
      hue: h || 0,
      saturation: s,
      lightness: l,
    };
  });

  // Sort by lightness to see the distribution
  const sorted = [...analyzed].sort((a, b) => a.lightness - b.lightness);
  
  // Find dark colors (lightness < 20%)
  const darkColors = analyzed.filter((c) => c.lightness < 0.20 && c.lightness > 0.02);
  
  // Find the most saturated dark color (this is likely the dominant dark hue)
  const dominantDark = darkColors.length > 0
    ? darkColors.reduce((best, c) => (c.saturation > best.saturation ? c : best))
    : sorted[0];

  // Also find colors in the 5-12% lightness range (typical shade 900 range)
  const shade900Candidates = analyzed.filter((c) => c.lightness >= 0.05 && c.lightness <= 0.12);
  
  return {
    allColors: analyzed,
    sortedByLightness: sorted,
    darkColors,
    dominantDark,
    shade900Candidates,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Dark Color Analysis for Background Images');
  console.log('='.repeat(60));
  console.log('\nGoal: Find the dominant dark color to use as shade 900\n');

  const files = fs.readdirSync(BACKGROUNDS_DIR).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));

  for (const file of files) {
    const imagePath = path.join(BACKGROUNDS_DIR, file);
    const themeName = path.basename(file, path.extname(file));
    
    console.log('\n' + '='.repeat(60));
    console.log(`IMAGE: ${file}`);
    console.log('='.repeat(60));

    const analysis = await analyzeDarkColors(imagePath);
    
    console.log('\nAll extracted colors (sorted by lightness):');
    analysis.sortedByLightness.forEach((c, i) => {
      const marker = c.lightness >= 0.05 && c.lightness <= 0.12 ? ' <-- shade 900 range' : '';
      console.log(`  ${c.hex} | H:${c.hue.toFixed(0).padStart(3)}° S:${(c.saturation * 100).toFixed(0).padStart(2)}% L:${(c.lightness * 100).toFixed(1).padStart(5)}%${marker}`);
    });

    console.log('\nDark colors (L < 20%):');
    if (analysis.darkColors.length === 0) {
      console.log('  None found');
    } else {
      analysis.darkColors.forEach((c) => {
        console.log(`  ${c.hex} | H:${c.hue.toFixed(0).padStart(3)}° S:${(c.saturation * 100).toFixed(0).padStart(2)}% L:${(c.lightness * 100).toFixed(1).padStart(5)}%`);
      });
    }

    console.log('\nShade 900 candidates (L: 5-12%):');
    if (analysis.shade900Candidates.length === 0) {
      console.log('  None found');
    } else {
      analysis.shade900Candidates.forEach((c) => {
        console.log(`  ${c.hex} | H:${c.hue.toFixed(0).padStart(3)}° S:${(c.saturation * 100).toFixed(0).padStart(2)}% L:${(c.lightness * 100).toFixed(1).padStart(5)}%`);
      });
    }

    console.log('\n>>> RECOMMENDED shade 900:');
    if (analysis.dominantDark) {
      const d = analysis.dominantDark;
      console.log(`    ${d.hex} | H:${d.hue.toFixed(0)}° S:${(d.saturation * 100).toFixed(0)}% L:${(d.lightness * 100).toFixed(1)}%`);
      
      // Generate what the palette might look like with this as anchor
      console.log('\n>>> Suggested palette anchored to this dark color:');
      const palette = generatePaletteFromDark(d.hue, d.saturation, d.lightness);
      Object.entries(palette).forEach(([shade, color]) => {
        const c = chroma(color);
        const [h, s, l] = c.hsl();
        console.log(`    ${shade.padStart(3)}: ${color} | L:${(l * 100).toFixed(1)}%`);
      });
    }
  }
}

/**
 * Generate a palette where shade 900 is anchored to the dominant dark color
 */
function generatePaletteFromDark(hue, saturation, lightness900) {
  const palette = {};
  
  // The lightness ratios relative to shade 900 (based on original targets)
  // Original: 900=7.9%, so we scale everything relative to that
  const ORIGINAL_900 = 7.9;
  const lightnessRatios = {
    950: 3.7 / ORIGINAL_900,   // darker
    900: 1.0,                   // anchor
    800: 9.4 / ORIGINAL_900,
    700: 11.0 / ORIGINAL_900,
    600: 12.5 / ORIGINAL_900,
    500: 17.3 / ORIGINAL_900,
    400: 32.2 / ORIGINAL_900,
    300: 47.1 / ORIGINAL_900,
    200: 65.9 / ORIGINAL_900,
    100: 78.0 / ORIGINAL_900,
    50: 92.0 / ORIGINAL_900,
    0: 100 / ORIGINAL_900,      // will be clamped to white
  };

  const shadeOrder = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
  
  shadeOrder.forEach((shade) => {
    if (shade === 0) {
      palette[shade] = '#FFFFFF';
      return;
    }

    let targetLightness = lightness900 * lightnessRatios[shade];
    // Clamp lightness to valid range
    targetLightness = Math.max(0.01, Math.min(0.99, targetLightness));

    // Adjust saturation: lower for lighter shades
    let targetSaturation = saturation;
    if (shade < 500) {
      // Lighter shades have less saturation
      targetSaturation = saturation * (targetLightness / lightness900) * 0.5;
    } else if (shade === 950) {
      // Darkest shade can be more saturated
      targetSaturation = Math.min(0.9, saturation * 1.5);
    }
    targetSaturation = Math.max(0.05, Math.min(0.9, targetSaturation));

    try {
      const color = chroma.hsl(hue, targetSaturation, targetLightness);
      palette[shade] = color.hex().toUpperCase();
    } catch (e) {
      palette[shade] = '#000000';
    }
  });

  return palette;
}

main().catch(console.error);


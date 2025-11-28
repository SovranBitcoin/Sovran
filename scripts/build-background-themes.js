#!/usr/bin/env node
/**
 * Build Background Themes Script
 *
 * Automatically scans the backgrounds folder, extracts dominant colors from images,
 * generates color palettes, and updates the source of truth files.
 *
 * Usage: npm run build:themes
 *
 * This script updates only 2 files (single source of truth):
 * - themes.js (adds theme color palette definitions)
 * - config/backgroundImageThemes.ts (image paths, display names, theme list)
 *
 * All other files derive their data from these two sources automatically.
 *
 * File naming convention:
 * - Filename uses kebab-case (e.g., "deep-ocean.png")
 * - Display name = Title Case from filename (e.g., "Deep Ocean")
 * - Theme name = lowercase without hyphens (e.g., "deepocean")
 */

const fs = require('fs');
const path = require('path');
const chroma = require('chroma-js');
const getColors = require('get-image-colors');

// Configuration
const BACKGROUNDS_DIR = path.join(__dirname, '..', 'assets', 'images', 'backgrounds');
const ROOT_DIR = path.join(__dirname, '..');

const SHADE_ORDER = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];

/**
 * Convert filename to theme name (for code use)
 * "Deep Ocean.png" -> "deepocean"
 */
function fileToThemeName(filename) {
  return path
    .basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Get display name from filename (what users see)
 * "deep-ocean.png" -> "Deep Ocean"
 * Converts kebab-case to Title Case
 */
function fileToDisplayName(filename) {
  return path
    .basename(filename, path.extname(filename))
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract the dominant dark color from an image.
 * This finds the most prevalent dark color in the 5-12% lightness range
 * to use as shade 900 - the key anchor color for background overlays.
 *
 * Priority: Prevalence (order from get-image-colors) > Darkness > Saturation
 */
async function extractDominantDarkColor(imagePath) {
  try {
    const colors = await getColors(imagePath, { count: 20, type: 'image/png' });

    // Convert to chroma objects, keeping original order (prevalence)
    const chromaColors = colors.map((c, index) => {
      const chromaColor = chroma(c.hex());
      const [h, s, l] = chromaColor.hsl();
      return {
        hex: c.hex(),
        hue: h || 0,
        saturation: s,
        lightness: l,
        prevalence: index, // Lower = more prevalent in image
      };
    });

    // Target range for shade 900: 5-12% lightness (the "dominant dark" range)
    // This is darker than 900's typical 8% but gives room for the anchor
    const idealDarkColors = chromaColors.filter((c) => {
      return c.saturation > 0.15 && c.lightness >= 0.05 && c.lightness <= 0.12;
    });

    // If we found colors in the ideal range, pick the most prevalent (first in list)
    // that's also reasonably dark
    if (idealDarkColors.length > 0) {
      // Sort by: darkness first, then prevalence
      idealDarkColors.sort((a, b) => {
        // Prefer darker colors
        const darkDiff = a.lightness - b.lightness;
        if (Math.abs(darkDiff) > 0.02) return darkDiff;
        // Then prefer more prevalent
        return a.prevalence - b.prevalence;
      });
      const best = idealDarkColors[0];
      return {
        hue: best.hue,
        saturation: best.saturation,
        lightness: best.lightness,
        hex: best.hex,
      };
    }

    // Fallback: expand range to 5-20% and find darkest with good saturation
    const darkColors = chromaColors.filter((c) => {
      return c.saturation > 0.1 && c.lightness >= 0.03 && c.lightness <= 0.2;
    });

    if (darkColors.length > 0) {
      // Sort by darkness, then saturation
      darkColors.sort((a, b) => {
        const darkDiff = a.lightness - b.lightness;
        if (Math.abs(darkDiff) > 0.03) return darkDiff;
        return b.saturation - a.saturation;
      });
      const best = darkColors[0];
      return {
        hue: best.hue,
        saturation: best.saturation,
        lightness: best.lightness,
        hex: best.hex,
      };
    }

    // Ultimate fallback: any dark color
    const anyDark = chromaColors
      .filter((c) => c.lightness < 0.25)
      .sort((a, b) => a.lightness - b.lightness)[0];

    if (anyDark) {
      return {
        hue: anyDark.hue,
        saturation: Math.max(0.3, anyDark.saturation),
        lightness: anyDark.lightness,
        hex: anyDark.hex,
      };
    }

    return { hue: 220, saturation: 0.5, lightness: 0.08, hex: '#0D1520' };
  } catch (error) {
    console.error(`Error extracting colors from ${imagePath}:`, error.message);
    return { hue: 220, saturation: 0.5, lightness: 0.08, hex: '#0D1520' };
  }
}

/**
 * Generate a palette anchored to the dominant dark color (shade 900).
 * This ensures shade 900 matches the image's dominant dark color.
 */
function generatePalette(dominantDark) {
  const { hue, saturation, lightness: l900 } = dominantDark;
  const palette = {};

  // Lightness targets relative to shade 900
  // shade 900 is our anchor, other shades are calculated from it
  const lightnessMap = {
    950: l900 * 0.5, // Darker than 900
    900: l900, // Anchor - dominant dark color
    800: l900 * 1.2, // Slightly lighter
    700: l900 * 1.4,
    600: l900 * 1.6,
    500: l900 * 2.2, // Mid-dark
    400: Math.min(0.35, l900 * 4), // Transitioning to mid
    300: Math.min(0.5, l900 * 6), // Mid-light
    200: Math.min(0.68, l900 * 8.5), // Light
    100: Math.min(0.8, l900 * 10), // Very light
    50: Math.min(0.92, l900 * 12), // Near white
    0: 1.0, // White
  };

  // Saturation adjustments - darker shades are more saturated
  const saturationMap = {
    950: Math.min(0.95, saturation * 1.3),
    900: saturation,
    800: saturation * 0.95,
    700: saturation * 0.9,
    600: saturation * 0.85,
    500: saturation * 0.8,
    400: saturation * 0.6,
    300: saturation * 0.45,
    200: saturation * 0.3,
    100: saturation * 0.2,
    50: saturation * 0.1,
    0: 0,
  };

  SHADE_ORDER.forEach((shade) => {
    if (shade === 0) {
      palette[shade] = '#FFFFFF';
      return;
    }

    const targetL = Math.max(0.02, Math.min(0.98, lightnessMap[shade]));
    const targetS = Math.max(0.05, Math.min(0.95, saturationMap[shade]));

    try {
      const color = chroma.hsl(hue, targetS, targetL);
      palette[shade] = color.hex().toUpperCase();
    } catch (e) {
      palette[shade] = '#000000';
    }
  });

  return palette;
}

/**
 * Scan backgrounds folder and generate theme data
 */
async function scanBackgrounds() {
  const files = fs.readdirSync(BACKGROUNDS_DIR).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));

  console.log(`Found ${files.length} background images:`);

  const themes = [];

  for (const file of files) {
    const themeName = fileToThemeName(file);
    const displayName = fileToDisplayName(file);
    const imagePath = path.join(BACKGROUNDS_DIR, file);

    console.log(`  Processing: ${file} -> "${displayName}" (${themeName})`);

    const dominantDark = await extractDominantDarkColor(imagePath);
    const palette = generatePalette(dominantDark);

    console.log(
      `    -> Dominant dark: ${dominantDark.hex} (H:${Math.round(dominantDark.hue)}° S:${Math.round(dominantDark.saturation * 100)}% L:${Math.round(dominantDark.lightness * 100)}%)`
    );

    themes.push({
      name: themeName,
      displayName,
      filename: file,
      hue: Math.round(dominantDark.hue),
      saturation: Math.round(dominantDark.saturation * 100),
      lightness: Math.round(dominantDark.lightness * 100),
      dominantDarkHex: dominantDark.hex,
      palette,
    });
  }

  return themes;
}

/**
 * Generate themes.js content for background themes
 */
function generateThemesJSContent(themes) {
  let content = '';

  themes.forEach((theme) => {
    content += `  ${theme.name}: {\n`;
    SHADE_ORDER.forEach((shade) => {
      content += `    ${shade}: '${theme.palette[shade]}',\n`;
    });
    content += `  },\n`;
  });

  return content;
}

/**
 * Update themes.js file (SOURCE OF TRUTH #1)
 */
function updateThemesJS(themes) {
  const filePath = path.join(ROOT_DIR, 'themes.js');
  let content = fs.readFileSync(filePath, 'utf8');

  // Find the marker for background themes or the end of THEMES object
  const bgMarker = '// === BACKGROUND IMAGE THEMES (AUTO-GENERATED) ===';
  const bgEndMarker = '// === END BACKGROUND IMAGE THEMES ===';

  // Generate new background themes content
  const newContent = generateThemesJSContent(themes);
  const fullBlock = `\n  ${bgMarker}\n${newContent}  ${bgEndMarker}`;

  // Check if markers exist
  if (content.includes(bgMarker)) {
    // Replace existing block
    const regex = new RegExp(
      `\\s*${bgMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${bgEndMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'g'
    );
    content = content.replace(regex, fullBlock);
  } else {
    // Insert before closing of THEMES object
    const insertPoint = content.lastIndexOf('};');
    if (insertPoint !== -1) {
      content = content.slice(0, insertPoint) + fullBlock + content.slice(insertPoint);
    }
  }

  fs.writeFileSync(filePath, content);
  console.log(`✓ Updated themes.js`);
}

/**
 * Generate config/backgroundImageThemes.ts content (SOURCE OF TRUTH #2)
 */
function generateBackgroundConfigContent(themes) {
  const themeNames = themes.map((t) => `'${t.name}'`).join(', ');

  let content = `import { ImageSource } from 'expo-image';

/**
 * Background Image Themes Configuration
 *
 * AUTO-GENERATED by \`npm run build:themes\`
 * Do not edit manually - changes will be overwritten.
 *
 * This is the single source of truth for all background image theme configuration.
 * Other files import from here to get background image paths, display names, etc.
 */

/**
 * Background image require() mappings.
 * Maps theme name to the image asset.
 */
export const backgroundImageThemes: Record<string, ImageSource> = {
`;

  themes.forEach((theme) => {
    content += `  ${theme.name}: require('assets/images/backgrounds/${theme.filename}'),\n`;
  });

  content += `};

/**
 * Array of all background image theme names.
 */
export const BACKGROUND_THEME_NAMES = [${themeNames}];

/**
 * Display names for background image themes (from filename).
 */
export const backgroundThemeDisplayNames: Record<string, string> = {
`;

  themes.forEach((theme) => {
    content += `  ${theme.name}: '${theme.displayName}',\n`;
  });

  content += `};

/**
 * Check if a theme is a background image theme.
 */
export const isBackgroundImageTheme = (themeName: string): boolean => {
  return BACKGROUND_THEME_NAMES.includes(themeName);
};

/**
 * Get the background image for a theme, or null if not a background theme.
 */
export const getBackgroundImage = (themeName: string): ImageSource | null => {
  return backgroundImageThemes[themeName] ?? null;
};

/**
 * Get the display name for a background theme.
 */
export const getBackgroundThemeDisplayName = (themeName: string): string | undefined => {
  return backgroundThemeDisplayNames[themeName];
};
`;

  return content;
}

/**
 * Update config/backgroundImageThemes.ts file (SOURCE OF TRUTH #2)
 */
function updateBackgroundConfig(themes) {
  const filePath = path.join(ROOT_DIR, 'config', 'backgroundImageThemes.ts');
  const content = generateBackgroundConfigContent(themes);
  fs.writeFileSync(filePath, content);
  console.log(`✓ Updated config/backgroundImageThemes.ts`);
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Building Background Themes');
  console.log('='.repeat(60) + '\n');

  // Scan and generate themes
  const themes = await scanBackgrounds();

  console.log('\n' + '='.repeat(60));
  console.log('Generated Palettes:');
  console.log('='.repeat(60));

  themes.forEach((theme) => {
    console.log(`\n"${theme.displayName}" (${theme.name})`);
    console.log(
      `  Anchor (900): ${theme.dominantDarkHex} (H:${theme.hue}° S:${theme.saturation}% L:${theme.lightness}%)`
    );
    console.log(
      `  Generated: 950:${theme.palette[950]} 900:${theme.palette[900]} 500:${theme.palette[500]}`
    );
  });

  console.log('\n' + '='.repeat(60));
  console.log('Updating Source Files:');
  console.log('='.repeat(60) + '\n');

  // Update the two source of truth files
  updateThemesJS(themes);
  updateBackgroundConfig(themes);

  // Save metadata for reference
  const metadataPath = path.join(__dirname, 'background-themes-metadata.json');
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        themes: themes.map((t) => ({
          name: t.name,
          displayName: t.displayName,
          filename: t.filename,
          dominantDarkHex: t.dominantDarkHex,
          hue: t.hue,
          saturation: t.saturation,
          lightness: t.lightness,
        })),
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(`\n✓ Metadata saved to scripts/background-themes-metadata.json`);
  console.log('\n' + '='.repeat(60));
  console.log('Done! Files updated:');
  console.log('  - themes.js (color palettes)');
  console.log('  - config/backgroundImageThemes.ts (image paths, display names)');
  console.log('\nTo add a new theme: use kebab-case filename');
  console.log('  e.g., "midnight-blue.png" -> displays as "Midnight Blue"');
  console.log('='.repeat(60));
}

main().catch(console.error);

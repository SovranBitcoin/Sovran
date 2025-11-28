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

// The discovered lightness curve from reverse-engineering existing themes
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
 * Extract dominant color from image using chroma-js for consistent color handling
 */
async function extractDominantColor(imagePath) {
  try {
    const colors = await getColors(imagePath, { count: 10, type: 'image/png' });

    // Convert to chroma objects for consistent handling
    const chromaColors = colors.map((c) => {
      const chromaColor = chroma(c.hex());
      const [h, s, l] = chromaColor.hsl();
      return {
        hex: c.hex(),
        hue: h || 0, // hue can be NaN for grayscale
        saturation: s,
        lightness: l,
        score: 0,
      };
    });

    // Filter for colors with good saturation and mid-range lightness
    const validColors = chromaColors.filter((c) => {
      return c.saturation > 0.05 && c.lightness > 0.05 && c.lightness < 0.7;
    });

    if (validColors.length === 0) {
      // Fallback: use first color with any saturation
      const fallback = chromaColors.find((c) => c.saturation > 0.01);
      if (fallback) {
        return { hue: fallback.hue, saturation: Math.max(0.2, fallback.saturation) };
      }
      return { hue: 240, saturation: 0.25 }; // Default blue
    }

    // Score colors by saturation and preference for darker colors
    validColors.forEach((c) => {
      c.score = c.saturation * (1 - c.lightness) * 2;
    });

    validColors.sort((a, b) => b.score - a.score);
    const best = validColors[0];

    // Use saturation from image but constrain to reasonable range for our palette
    const targetSaturation = Math.max(0.15, Math.min(0.35, best.saturation * 0.8 + 0.1));

    return {
      hue: best.hue,
      saturation: targetSaturation,
    };
  } catch (error) {
    console.error(`Error extracting colors from ${imagePath}:`, error.message);
    return { hue: 240, saturation: 0.25 };
  }
}

/**
 * Generate a palette from hue and saturation
 */
function generatePalette(hue, baseSaturation) {
  const palette = {};

  SHADE_ORDER.forEach((shade) => {
    const lightness = LIGHTNESS_TARGETS[shade] / 100;

    // Shade 0 is always white
    if (shade === 0) {
      palette[shade] = '#FFFFFF';
      return;
    }

    // Boost saturation at shade 950
    let saturation = baseSaturation;
    if (shade === 950) {
      saturation = Math.min(0.9, baseSaturation * 2.5);
    }

    try {
      const color = chroma.hsl(hue, saturation, lightness);
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

    const { hue, saturation } = await extractDominantColor(imagePath);
    const palette = generatePalette(hue, saturation);

    themes.push({
      name: themeName,
      displayName,
      filename: file,
      hue: Math.round(hue),
      saturation: Math.round(saturation * 100),
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
  const fullBlock = `  ${bgMarker}\n${newContent}  ${bgEndMarker}`;

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
    console.log(
      `\n"${theme.displayName}" (${theme.name}) - Hue: ${theme.hue}°, Sat: ${theme.saturation}%`
    );
    console.log(`  950: ${theme.palette[950]} ... 0: ${theme.palette[0]}`);
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
          hue: t.hue,
          saturation: t.saturation,
        })),
        generatedAt: new Date().toISOString(),
        lightnessTargets: LIGHTNESS_TARGETS,
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

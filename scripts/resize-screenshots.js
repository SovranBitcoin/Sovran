const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Apple App Store required dimensions (portrait)
const TARGET_DIMENSIONS = [
  { width: 1242, height: 2688, name: '1242x2688' }, // iPhone XS Max, 11 Pro Max (6.5")
  { width: 1284, height: 2778, name: '1284x2778' }, // iPhone 12/13/14/15 Pro Max (6.7")
];

const INPUT_DIR = path.join(__dirname, 'screenshots-input');
const OUTPUT_DIR = path.join(__dirname, 'screenshots-output');

async function resizeScreenshots() {
  // Get all image files from input directory
  const files = fs.readdirSync(INPUT_DIR).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.png', '.jpg', '.jpeg'].includes(ext);
  });

  if (files.length === 0) {
    console.log('No image files found in screenshots-input folder');
    return;
  }

  console.log(`Found ${files.length} image(s) to process\n`);

  // Create output directories for each dimension
  for (const dim of TARGET_DIMENSIONS) {
    const dimDir = path.join(OUTPUT_DIR, dim.name);
    if (!fs.existsSync(dimDir)) {
      fs.mkdirSync(dimDir, { recursive: true });
      console.log(`Created output directory: ${dim.name}/`);
    }
  }
  console.log('');

  // Process each image
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    
    for (const dim of TARGET_DIMENSIONS) {
      const outputPath = path.join(OUTPUT_DIR, dim.name, file);
      
      try {
        await sharp(inputPath)
          .resize(dim.width, dim.height, {
            fit: 'fill', // Stretch to fill exact dimensions (no letterboxing)
            withoutEnlargement: false, // Allow upscaling
          })
          .png({ quality: 100 }) // High quality output
          .toFile(outputPath);
        
        console.log(`✓ ${file} → ${dim.name}/`);
        processed++;
      } catch (err) {
        console.error(`✗ Error processing ${file} for ${dim.name}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Done! Processed ${processed} images (${errors} errors)`);
  console.log(`Output saved to: scripts/screenshots-output/`);
}

resizeScreenshots().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


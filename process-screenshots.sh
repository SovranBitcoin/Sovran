#!/bin/bash

# Process Screenshots for App Store
# Copies images from old/ to new/ and scales them from 960×2079 to 1320×2868

# Check if on macOS
if [ "$(uname)" != "Darwin" ]; then
    echo "Error: This script requires macOS (uses sips command)"
    exit 1
fi

# Check if old directory exists
if [ ! -d "old" ]; then
    echo "Error: 'old' directory not found"
    exit 1
fi

# Create new directory
mkdir -p new
echo "Created/verified 'new' directory"

# Copy and scale all PNG images
count=0
for file in old/*.png; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        echo "Processing: $filename"
        
        # Copy to new directory
        cp "$file" "new/$filename"
        
        # Scale from 960×2079 to 1320×2868
        sips --resampleHeightWidth 2868 1320 "new/$filename" >/dev/null 2>&1
        
        count=$((count+1))
    fi
done

if [ $count -eq 0 ]; then
    echo "No PNG files found in 'old' directory"
    exit 1
fi

echo "✅ Processed $count images"
echo "✅ Images copied from 'old/' to 'new/'"
echo "✅ Scaled from 960×2079 to 1320×2868 (App Store ready)" 
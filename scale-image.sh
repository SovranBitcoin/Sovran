#!/bin/bash

# Image Scaling Script
# This script scales multiple PNG images from 945×2048 to 1320×2868px
# Uses built-in macOS sips command, no external dependencies required

# Check if on macOS
if [ "$(uname)" != "Darwin" ]; then
    echo "Error: This script uses the 'sips' command which is only available on macOS."
    echo "For Linux or other systems, consider using ImageMagick (convert) or another solution."
    exit 1
fi

# Display help message if no arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 [options] <image_files_or_directories>"
    echo "Options:"
    echo "  -o <output_dir>   Specify output directory (default: creates 'scaled' subdirectory)"
    echo "  -i                Modify images in place (be careful!)"
    echo "  -t <type>         Process only specific file types (default: png)"
    echo "  -r                Process directories recursively"
    echo "  -h                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 *.png                    # Scale all PNGs in current directory"
    echo "  $0 -o resized *.png         # Scale all PNGs and save to 'resized' subdirectory"
    echo "  $0 -i *.jpg                 # Scale all JPGs in place (modifies original files)"
    echo "  $0 -t jpg images/           # Scale all JPGs in 'images' directory"
    echo "  $0 -r -t png screenshots/   # Scale all PNGs in screenshots directory and subdirectories"
    exit 1
fi

# Default settings
OUTPUT_DIR="scaled"
IN_PLACE=false
FILE_TYPE="jpeg"
RECURSIVE=false

# Parse options
while getopts ":o:it:rh" opt; do
    case $opt in
        o)
            OUTPUT_DIR="$OPTARG"
            ;;
        i)
            IN_PLACE=true
            ;;
        t)
            FILE_TYPE="$OPTARG"
            ;;
        r)
            RECURSIVE=true
            ;;
        h)
            echo "Usage: $0 [options] <image_files_or_directories>"
            echo "Options:"
            echo "  -o <output_dir>   Specify output directory (default: creates 'scaled' subdirectory)"
            echo "  -i                Modify images in place (be careful!)"
            echo "  -t <type>         Process only specific file types (default: png)"
            echo "  -r                Process directories recursively"
            echo "  -h                Show this help message"
            exit 0
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
        :)
            echo "Option -$OPTARG requires an argument." >&2
            exit 1
            ;;
    esac
done

# Skip over the options we've processed
shift $((OPTIND-1))

# Check if we have paths to process
if [ $# -eq 0 ]; then
    echo "Error: No image files or directories specified."
    echo "Try: $0 *.png or $0 directory/"
    exit 1
fi

# Create output directory if not modifying in place
if [ "$IN_PLACE" = false ]; then
    mkdir -p "$OUTPUT_DIR"
    if [ $? -ne 0 ]; then
        echo "Error: Could not create output directory '$OUTPUT_DIR'"
        exit 1
    fi
    echo "Created output directory: $OUTPUT_DIR"
fi

# Function to process a single file
process_file() {
    local file="$1"
    
    # Check if file exists
    if [ ! -f "$file" ]; then
        return 1
    fi
    
    # Check file extension
    if [[ ! "$file" =~ \.$FILE_TYPE$ ]]; then
        return 2
    fi
    
    # Get file info and check if it's an image
    if ! sips -g format "$file" &>/dev/null; then
        return 3
    fi
    
    # Get just the filename without path
    local filename=$(basename "$file")
    
    # Get relative path if needed
    local rel_path=""
    if [ "$RECURSIVE" = true ] && [ "$IN_PLACE" = false ]; then
        # Extract directory structure relative to the base dir
        local dir=$(dirname "$file")
        local basedir=$(dirname "$1")
        rel_path="${dir#$basedir/}"
        
        # Create subdirectory in output if it doesn't exist
        if [ "$rel_path" != "." ] && [ "$rel_path" != "$dir" ]; then
            mkdir -p "$OUTPUT_DIR/$rel_path"
        fi
    fi
    
    if [ "$IN_PLACE" = true ]; then
        # Scale in place
        echo "Scaling: $file (in place) from 945×2048 to 1320×2868px"
        sips --resampleHeightWidth 2868 1320 "$file" >/dev/null 2>&1
    else
        # Scale to output directory, preserving directory structure if recursive
        local outpath="$OUTPUT_DIR"
        if [ "$rel_path" != "." ] && [ "$rel_path" != "" ]; then
            outpath="$OUTPUT_DIR/$rel_path"
        fi
        
        echo "Scaling: $file -> $outpath/$filename from 945×2048 to 1320×2868px"
        cp "$file" "$outpath/$filename"
        sips --resampleHeightWidth 2868 1320 "$outpath/$filename" >/dev/null 2>&1
    fi
    
    return $?
}

# Find all matching files, including in directories
declare -a FILES_TO_PROCESS
for path in "$@"; do
    if [ -d "$path" ]; then
        # It's a directory - find all matching files
        if [ "$RECURSIVE" = true ]; then
            while IFS= read -r -d '' file; do
                FILES_TO_PROCESS+=("$file")
            done < <(find "$path" -type f -name "*.$FILE_TYPE" -print0)
        else
            while IFS= read -r -d '' file; do
                FILES_TO_PROCESS+=("$file")
            done < <(find "$path" -maxdepth 1 -type f -name "*.$FILE_TYPE" -print0)
        fi
    elif [ -f "$path" ]; then
        # It's a file
        FILES_TO_PROCESS+=("$path")
    else
        echo "Warning: '$path' is not a valid file or directory, skipping."
    fi
done

# Count metrics
TOTAL_FILES=${#FILES_TO_PROCESS[@]}
SUCCESS_COUNT=0
SKIPPED_COUNT=0

if [ $TOTAL_FILES -eq 0 ]; then
    echo "No matching .$FILE_TYPE files found!"
    exit 1
fi

echo "Found $TOTAL_FILES .$FILE_TYPE files to process"
echo "Scaling images from 945×2048 to 1320×2868px..."

# Process each file
for file in "${FILES_TO_PROCESS[@]}"; do
    process_file "$file"
    result=$?
    
    if [ $result -eq 0 ]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT+1))
    elif [ $result -eq 1 ]; then
        echo "Warning: File '$file' does not exist, skipping."
        SKIPPED_COUNT=$((SKIPPED_COUNT+1))
    elif [ $result -eq 2 ]; then
        echo "Warning: File '$file' is not a .$FILE_TYPE file, skipping."
        SKIPPED_COUNT=$((SKIPPED_COUNT+1))
    elif [ $result -eq 3 ]; then
        echo "Warning: File '$file' is not a valid image file, skipping."
        SKIPPED_COUNT=$((SKIPPED_COUNT+1))
    else
        echo "Error: Failed to scale '$file'"
        SKIPPED_COUNT=$((SKIPPED_COUNT+1))
    fi
done

echo "Finished! Successfully scaled $SUCCESS_COUNT out of $TOTAL_FILES images ($SKIPPED_COUNT skipped)."
if [ "$IN_PLACE" = false ]; then
    echo "Scaled images saved to: $OUTPUT_DIR/"
fi
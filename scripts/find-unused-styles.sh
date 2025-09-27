#!/bin/bash

# Script to find unused style keys in createStyles functions
# Usage: ./scripts/find-unused-styles.sh [file_pattern]
# Example: ./scripts/find-unused-styles.sh "app/**/*.tsx"

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default pattern if none provided
PATTERN="${1:-**/*.tsx}"

# Counter for stats
total_files=0
files_with_unused=0
total_unused=0

echo -e "${BLUE}🔍 Scanning for unused style keys in createStyles functions...${NC}"
echo -e "${BLUE}Pattern: ${PATTERN}${NC}"
echo ""

# Function to extract style keys from a createStyles function
extract_style_keys() {
    local file="$1"
    
    # Find createStyles function and extract the StyleSheet.create block
    # Only extract top-level style keys, not nested CSS properties
    awk '
    /createStyles.*=.*\(/ { in_function = 1; next }
    /StyleSheet\.create\(\{/ { 
        if (in_function) {
            in_stylesheet = 1
            brace_count = 1
            next
        }
    }
    in_function && /StyleSheet\.create\(\{/ { 
        in_stylesheet = 1
        brace_count = 1
        next
    }
    in_stylesheet && /\{/ { 
        brace_count += gsub(/\{/, "&")
    }
    in_stylesheet && /\}/ { 
        brace_count -= gsub(/\}/, "&")
        if (brace_count == 0) {
            in_stylesheet = 0
            in_function = 0
            next
        }
    }
    # Only extract keys at the top level of the stylesheet that are followed by an object
    # But exclude CSS properties that have object values (like textShadowOffset: { width: 0, height: 0 })
    in_stylesheet && brace_count == 2 && /^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*:[[:space:]]*\{/ {
        # Check if this looks like a CSS property with object value
        if ($0 ~ /^[[:space:]]*(textShadow|shadow|border|margin|padding|transform|flex|align|justify|position|top|left|right|bottom|width|height|maxWidth|minWidth|maxHeight|minHeight|font|color|backgroundColor|opacity|zIndex|overflow|borderRadius|borderWidth|borderColor|lineHeight|letterSpacing|textTransform|elevation|gap|flexWrap|flexDirection|alignSelf|flexGrow|flexShrink|flexBasis)[A-Za-z]*[[:space:]]*:[[:space:]]*\{/) {
            next  # Skip CSS properties with object values
        }
        gsub(/^[[:space:]]*/, "")
        gsub(/:.*$/, "")
        if (length($0) > 0) print $0
    }
    ' "$file"
}

# Function to check if a style key is used in the file
is_style_used() {
    local file="$1"
    local style_key="$2"
    
    # Look for styles.keyName or styles[keyName] or styles['keyName'] or styles["keyName"]
    if grep -q "styles\\.${style_key}\\|styles\\[${style_key}\\]\\|styles\\[\\['\"]${style_key}\\['\"]\\]" "$file"; then
        return 0  # Used
    else
        return 1  # Unused
    fi
}

# Function to analyze a single file
analyze_file() {
    local file="$1"
    
    # Skip if file doesn't contain createStyles
    if ! grep -q "createStyles" "$file"; then
        return
    fi
    
    total_files=$((total_files + 1))
    
    # Extract style keys
    local style_keys
    style_keys=$(extract_style_keys "$file")
    
    if [[ -z "$style_keys" ]]; then
        return
    fi
    
    local unused_keys=()
    local used_count=0
    local total_keys=0
    
    # Check each style key
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        total_keys=$((total_keys + 1))
        
        if is_style_used "$file" "$key"; then
            used_count=$((used_count + 1))
        else
            unused_keys+=("$key")
        fi
    done <<< "$style_keys"
    
    # Report results for this file
    if [[ ${#unused_keys[@]} -gt 0 ]]; then
        files_with_unused=$((files_with_unused + 1))
        total_unused=$((total_unused + ${#unused_keys[@]}))
        
        echo -e "${RED}📄 $file${NC}"
        echo -e "${YELLOW}   Found ${#unused_keys[@]} unused style(s) out of $total_keys total:${NC}"
        
        for unused_key in "${unused_keys[@]}"; do
            echo -e "${RED}   ❌ $unused_key${NC}"
        done
        
        echo -e "${GREEN}   ✅ $used_count style(s) are used${NC}"
        echo ""
    else
        echo -e "${GREEN}✅ $file - All $total_keys style(s) are used${NC}"
    fi
}

# Main execution
main() {
    # Find all TypeScript/TSX files in the project
    echo -e "${BLUE}🔍 Discovering files...${NC}"
    
    if command -v fd >/dev/null 2>&1; then
        # Use fd if available (faster)
        echo -e "${BLUE}Using fd for file discovery${NC}"
        while IFS= read -r file; do
            [[ -f "$file" ]] && analyze_file "$file"
        done < <(fd -e tsx -e ts . 2>/dev/null)
    else
        # Fallback to find
        echo -e "${BLUE}Using find for file discovery${NC}"
        while IFS= read -r file; do
            [[ -f "$file" ]] && analyze_file "$file"
        done < <(find . -name "*.tsx" -o -name "*.ts" 2>/dev/null | grep -v node_modules | grep -v .git)
    fi
    
    # Summary
    echo ""
    echo -e "${BLUE}📊 Summary:${NC}"
    echo -e "${BLUE}   Files analyzed: $total_files${NC}"
    echo -e "${BLUE}   Files with unused styles: $files_with_unused${NC}"
    echo -e "${BLUE}   Total unused style keys: $total_unused${NC}"
    
    if [[ $total_unused -gt 0 ]]; then
        echo ""
        echo -e "${YELLOW}💡 Tip: You can remove these unused style keys to clean up your code!${NC}"
        exit 1
    else
        echo ""
        echo -e "${GREEN}🎉 No unused style keys found! Your styles are clean.${NC}"
        exit 0
    fi
}

# Run main function
main "$@"

#!/bin/bash

# Simple script to find potentially unused exports and functions
# This is a faster but less accurate alternative to the Node.js script

echo "🔍 Finding potentially unused code..."
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Directories to search
SEARCH_DIRS="app components helper hooks hocs"

# Function to check if a name is used
check_usage() {
    local name="$1"
    local file="$2"
    
    # Count occurrences (excluding the definition line)
    local count=$(grep -r "\b$name\b" $SEARCH_DIRS --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | grep -v "$file" | wc -l)
    echo $count
}

echo -e "${BLUE}Scanning exported functions...${NC}"

# Find exported functions
grep -r "export.*function\s\+\w\+" $SEARCH_DIRS --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | while IFS= read -r line; do
    file=$(echo "$line" | cut -d':' -f1)
    func_name=$(echo "$line" | sed -n 's/.*export.*function\s\+\([a-zA-Z_][a-zA-Z0-9_]*\).*/\1/p')
    
    if [ ! -z "$func_name" ]; then
        usage_count=$(check_usage "$func_name" "$file")
        if [ "$usage_count" -eq 0 ]; then
            echo -e "${RED}Unused export function:${NC} $func_name in $file"
        fi
    fi
done

echo -e "\n${BLUE}Scanning exported constants...${NC}"

# Find exported constants
grep -r "export const \w\+" $SEARCH_DIRS --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | while IFS= read -r line; do
    file=$(echo "$line" | cut -d':' -f1)
    const_name=$(echo "$line" | sed -n 's/.*export const \([a-zA-Z_][a-zA-Z0-9_]*\).*/\1/p')
    
    if [ ! -z "$const_name" ]; then
        usage_count=$(check_usage "$const_name" "$file")
        if [ "$usage_count" -eq 0 ]; then
            echo -e "${RED}Unused export const:${NC} $const_name in $file"
        fi
    fi
done

echo -e "\n${BLUE}Scanning internal functions...${NC}"

# Find internal functions (not exported)
grep -r "^[[:space:]]*function\s\+\w\+" $SEARCH_DIRS --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | grep -v "export" | while IFS= read -r line; do
    file=$(echo "$line" | cut -d':' -f1)
    func_name=$(echo "$line" | sed -n 's/.*function\s\+\([a-zA-Z_][a-zA-Z0-9_]*\).*/\1/p')
    
    if [ ! -z "$func_name" ]; then
        usage_count=$(check_usage "$func_name" "$file")
        if [ "$usage_count" -eq 0 ]; then
            echo -e "${YELLOW}Unused internal function:${NC} $func_name in $file"
        fi
    fi
done

echo -e "\n${BLUE}Scanning internal constants...${NC}"

# Find internal constants (not exported)
grep -r "^[[:space:]]*const\s\+\w\+" $SEARCH_DIRS --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | grep -v "export" | while IFS= read -r line; do
    file=$(echo "$line" | cut -d':' -f1)
    const_name=$(echo "$line" | sed -n 's/.*const\s\+\([a-zA-Z_][a-zA-Z0-9_]*\).*/\1/p')
    
    if [ ! -z "$const_name" ]; then
        # Skip destructuring assignments
        if [[ "$const_name" != *"{"* ]] && [[ "$const_name" != *"["* ]]; then
            usage_count=$(check_usage "$const_name" "$file")
            if [ "$usage_count" -eq 0 ]; then
                echo -e "${YELLOW}Unused internal const:${NC} $const_name in $file"
            fi
        fi
    fi
done

echo -e "\n${GREEN}Analysis complete!${NC}"
echo -e "${BLUE}Note:${NC} This is a basic analysis. Please review each item carefully before removing."

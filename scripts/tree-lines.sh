#!/bin/bash

# Project tree with line counts
# Usage: ./scripts/tree-lines.sh [directory]
# Shows project structure excluding node_modules, ios, build with line counts per file

# Check if NO_COLOR environment variable is set or if output is not a terminal
if [[ -n "$NO_COLOR" || ! -t 1 ]]; then
    # No color codes
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    MAGENTA=''
    CYAN=''
    WHITE=''
    DIM=''
    BOLD=''
    NC=''
else
    # Color codes
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    MAGENTA='\033[0;35m'
    CYAN='\033[0;36m'
    WHITE='\033[1;37m'
    DIM='\033[2m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
fi

# File size thresholds
SMALL_THRESHOLD=50
MEDIUM_THRESHOLD=150
LARGE_THRESHOLD=300

# Directories/files to ignore (like .gitignore)
IGNORE_PATTERNS="node_modules|ios|android|build|dist|\.expo|\.git|__tests__|coverage|\.next|patches|unscaled|old|new|\.DS_Store|yarn\.lock|package-lock\.json"

# Statistics variables
total_files=0
total_lines=0
large_files_list=""

# Function to check if path should be ignored
should_ignore() {
    local path="$1"
    echo "$path" | grep -E "$IGNORE_PATTERNS" > /dev/null
}

# Function to count lines in a file
count_lines() {
    local file="$1"
    if [ -f "$file" ] && [ -r "$file" ]; then
        wc -l < "$file" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Function to get file color and symbol based on line count
get_file_info() {
    local lines="$1"
    local is_dir="$2"
    
    if [ "$is_dir" = "true" ]; then
        echo "DIR|${BLUE}"
    elif [ "$lines" -eq 0 ]; then
        echo " - |${DIM}"
    elif [ "$lines" -le $SMALL_THRESHOLD ]; then
        echo " ✓ |${GREEN}"
    elif [ "$lines" -le $MEDIUM_THRESHOLD ]; then
        echo " • |${YELLOW}"
    elif [ "$lines" -le $LARGE_THRESHOLD ]; then
        echo " ! |${RED}"
    else
        echo "!!!|${MAGENTA}"
    fi
}

# Function to format file size
format_size() {
    local lines="$1"
    if [ "$lines" -gt 0 ]; then
        echo "${DIM}(${lines}L)${NC}"
    else
        echo ""
    fi
}

# Function to create indentation
create_indent() {
    local depth="$1"
    local result=""
    for ((i=0; i<depth; i++)); do
        result+="│  "
    done
    echo "$result"
}

# Function to display tree recursively
display_tree() {
    local dir="$1"
    local depth="${2:-0}"
    local max_depth="${3:-8}"
    
    # Prevent infinite recursion
    if [ "$depth" -gt "$max_depth" ]; then
        local indent=$(create_indent "$depth")
        echo "${indent}├── ${DIM}... (max depth reached)${NC}"
        return
    fi
    
    # Check if directory exists and is readable
    if [ ! -d "$dir" ] || [ ! -r "$dir" ]; then
        return
    fi
    
    # Get all items in directory, sort directories first
    local items=$(find "$dir" -maxdepth 1 -mindepth 1 2>/dev/null | while read -r item; do
        local basename=$(basename "$item")
        if ! should_ignore "$basename" && ! should_ignore "$item"; then
            if [ -d "$item" ]; then
                echo "0|$item"  # 0 for directory (sort first)
            else
                echo "1|$item"  # 1 for file (sort second)
            fi
        fi
    done | sort | cut -d'|' -f2)
    
    # Process each item
    while IFS= read -r item; do
        [ -z "$item" ] && continue
        
        local basename=$(basename "$item")
        local indent=$(create_indent "$depth")
        
        if [ -d "$item" ]; then
            # Directory
            local info=$(get_file_info 0 "true")
            local symbol=$(echo "$info" | cut -d'|' -f1)
            local color=$(echo "$info" | cut -d'|' -f2)
            
            echo "${indent}├── ${symbol} ${color}${basename}${NC}/"
            
            # Recurse into directory
            display_tree "$item" $((depth + 1)) "$max_depth"
        else
            # File
            local lines=$(count_lines "$item")
            local info=$(get_file_info "$lines" "false")
            local symbol=$(echo "$info" | cut -d'|' -f1)
            local color=$(echo "$info" | cut -d'|' -f2)
            local size_info=$(format_size "$lines")
            
            echo "${indent}├── ${symbol} ${color}${basename}${NC} ${size_info}"
            
            # Update statistics
            total_files=$((total_files + 1))
            total_lines=$((total_lines + lines))
            
            # Track large files
            if [ "$lines" -ge $LARGE_THRESHOLD ]; then
                local relative_path=$(realpath --relative-to="$(pwd)" "$item" 2>/dev/null || echo "$item")
                large_files_list="${large_files_list}${lines}|${relative_path}\n"
            fi
        fi
    done <<< "$items"
}

# Function to display summary statistics
display_summary() {
    echo ""
    echo -e "${BOLD}PROJECT ANALYSIS SUMMARY${NC}"
    echo -e "${CYAN}========================${NC}"
    echo ""
    
    echo -e "Total Files: ${BOLD}${total_files}${NC}"
    echo -e "Total Lines: ${BOLD}$(printf "%'d" $total_lines)${NC}"
    
    if [ "$total_files" -gt 0 ]; then
        local avg_lines=$((total_lines / total_files))
        echo -e "Average Lines/File: ${BOLD}${avg_lines}${NC}"
    fi
    echo ""
    
    # Show large files that may need refactoring
    if [ -n "$large_files_list" ]; then
        echo -e "${YELLOW}FILES THAT MAY NEED REFACTORING:${NC}"
        echo -e "$large_files_list" | head -10 | sort -nr | while IFS='|' read -r lines file_path; do
            [ -z "$lines" ] && continue
            local relative_path=$(echo "$file_path" | sed "s|$(pwd)/||")
            if [ "$lines" -ge 500 ]; then
                echo -e "  !!! ${MAGENTA}${relative_path}${NC} (${lines}L)"
            else
                echo -e "   !  ${RED}${relative_path}${NC} (${lines}L)"
            fi
        done
        echo ""
    fi
    
    # File type breakdown
    echo -e "${BLUE}FILE TYPES:${NC}"
    find "${target_dir}" -type f 2>/dev/null | while read -r file; do
        should_ignore "$(basename "$file")" || should_ignore "$file" && continue
        echo "${file##*.}"
    done | sort | uniq -c | sort -nr | head -8 | while read -r count ext; do
        [ -z "$ext" ] && ext="(no extension)"
        echo -e "  .${ext}: ${BOLD}${count}${NC} files"
    done
    
    echo ""
    echo -e "${DIM}Legend: ✓ Small (<50L) | • Medium (50-150L) | ! Large (150-300L) | !!! Huge (300L+)${NC}"
}

# Main execution
main() {
    local target_dir="${1:-.}"
    
    # Convert to absolute path
    target_dir=$(realpath "$target_dir" 2>/dev/null || echo "$target_dir")
    
    if [ ! -d "$target_dir" ]; then
        echo -e "${RED}Error: Directory '$target_dir' does not exist${NC}" >&2
        exit 1
    fi
    
    echo -e "${BOLD}PROJECT STRUCTURE WITH LINE COUNTS${NC}"
    echo -e "${CYAN}===================================${NC}"
    echo ""
    
    local project_name=$(basename "$target_dir")
    echo -e "${BOLD}${project_name}/${NC}"
    
    # Display the tree
    display_tree "$target_dir"
    
    # Display summary
    display_summary
}

# Show help if requested
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0 [directory]"
    echo ""
    echo "Display project structure with line counts, excluding common build/dependency directories."
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0            # Analyze current directory"
    echo "  $0 ./src      # Analyze src directory"
    echo ""
    echo "Ignores: node_modules, ios, build, dist, .git, etc."
    exit 0
fi

# Run main function
main "$@"

#!/bin/bash

# YouTubePlus Build Script
# Creates browser-specific builds for Chrome and Firefox

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/SourceCode"
DIST_DIR="$SCRIPT_DIR/dist"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔨 Building YouTubePlus Extension...${NC}"

# Clean and create dist directories
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/chrome"
mkdir -p "$DIST_DIR/firefox"

# Files/folders to copy
SHARED_ITEMS=(
    "assets"
    "background"
    "content"
    "popup"
    "config.example.json"
)

# Function to copy shared files
copy_shared() {
    local target_dir=$1
    for item in "${SHARED_ITEMS[@]}"; do
        if [ -e "$SOURCE_DIR/$item" ]; then
            cp -r "$SOURCE_DIR/$item" "$target_dir/"
        fi
    done
}

# Build Chrome version
echo -e "${BLUE}📦 Building Chrome version...${NC}"
copy_shared "$DIST_DIR/chrome"
cp "$SOURCE_DIR/manifest.chrome.json" "$DIST_DIR/chrome/manifest.json"
echo -e "${GREEN}✓ Chrome build complete: dist/chrome/${NC}"

# Build Firefox version
echo -e "${BLUE}📦 Building Firefox version...${NC}"
copy_shared "$DIST_DIR/firefox"
cp "$SOURCE_DIR/manifest.firefox.json" "$DIST_DIR/firefox/manifest.json"
echo -e "${GREEN}✓ Firefox build complete: dist/firefox/${NC}"

# Create zip files for store submission
echo -e "${BLUE}📦 Creating zip files...${NC}"
cd "$DIST_DIR/chrome" && zip -r "$DIST_DIR/YouTubePlus-chrome.zip" . -x "*.DS_Store"
cd "$DIST_DIR/firefox" && zip -r "$DIST_DIR/YouTubePlus-firefox.zip" . -x "*.DS_Store"

echo -e "${GREEN}✓ Zip files created:${NC}"
echo "  - dist/YouTubePlus-chrome.zip"
echo "  - dist/YouTubePlus-firefox.zip"

echo -e "${GREEN}🎉 Build complete!${NC}"
echo ""
echo "To test:"
echo "  Chrome: Load 'dist/chrome' in chrome://extensions (Developer mode)"
echo "  Firefox: Load 'dist/firefox/manifest.json' in about:debugging"

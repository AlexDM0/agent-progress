#!/usr/bin/env bash
# Renders a README roughly as github.com shows it and screenshots the whole page, to check the graphics in
# place before pushing. Needs network access for github-markdown-css.
#
# Usage: .readme-graphics/preview-readme.sh [README file, default README.md] [light|dark, default light]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY="$(cd "$HERE/.." && pwd)"
README_FILE="$(cd "$REPOSITORY" && realpath "${1:-README.md}")"
THEME="${2:-light}"
BUILD="$HERE/build/preview"
mkdir -p "$BUILD"

NAME="$(basename "$README_FILE" .md)-$THEME"
( cd "$REPOSITORY" && bun "$HERE/render-readme.js" "$README_FILE" "$BUILD/$NAME.html" "$THEME" )
printf '[{"html":"%s","output":"%s","width":1280,"height":900,"scale":1,"colorScheme":"%s","fullPage":true,"waitMilliseconds":2500}]' \
  "$BUILD/$NAME.html" "$BUILD/$NAME.png" "$THEME" > "$BUILD/$NAME.json"
bun "$HERE/shoot.js" "$BUILD/$NAME.json" > /dev/null
echo "$BUILD/$NAME.png"

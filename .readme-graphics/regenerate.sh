#!/usr/bin/env bash
# Regenerates every README graphic that shows the dashboard, from a synthetic board that this checkout's
# own CLI builds, and copies the ones README.md shows into docs/images/. Run it after any change to how the page looks.
#
# Usage: .readme-graphics/regenerate.sh [--no-copy] [--keep-demo]
#   --no-copy    build into .readme-graphics/build/ only; docs/images/ is left alone
#   --keep-demo  keep the temporary demo repository and print where it is
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
COPY_INTO_DOCS=1
KEEP_DEMO=0
for argument in "$@"; do
  case "$argument" in
    --no-copy) COPY_INTO_DOCS=0 ;;
    --keep-demo) KEEP_DEMO=1 ;;
    *) printf "Unknown option: %s\nUsage: %s [--no-copy] [--keep-demo]\n" "$argument" "$0" >&2; exit 1 ;;
  esac
done

step() { printf "\n\033[1m%s\033[0m\n" "$1"; }

command -v bun >/dev/null || { echo "bun is required" >&2; exit 1; }
python3 -c 'import PIL' 2>/dev/null || { echo "python3 with Pillow is required (pip install Pillow)" >&2; exit 1; }
[[ -d "$REPOSITORY/node_modules/marked" ]] || { echo "run bun install in $REPOSITORY first" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/agent-progress-readme-graphics.XXXXXX")"
if [[ "$KEEP_DEMO" == "1" ]]; then
  trap 'echo "demo repository kept at $WORK/example-storefront"' EXIT
else
  trap 'rm -rf "$WORK"' EXIT
fi
rm -rf "$BUILD"
mkdir -p "$BUILD"

step "1/5 Seeding the synthetic board through this checkout's CLI"
bash "$HERE/seed-demo.sh" "$WORK" "$BUILD/snapshots"

step "2/5 Screenshots of the final board, light and dark, with element measurements"
python3 "$HERE/compose.py" base-jobs "$BUILD"
bun "$HERE/shoot.js" "$BUILD/jobs/base.json" "$BUILD/measurements.json"

step "3/5 Store panels, window frames, the icon, the story strips and the animation frames"
python3 "$HERE/compose.py" pages "$BUILD"
bun "$HERE/shoot.js" "$BUILD/jobs/pages.json"
bun "$HERE/shoot.js" "$BUILD/jobs/frames.json"

step "4/5 The animated day"
python3 "$HERE/compose.py" gif "$BUILD"
python3 "$HERE/compose.py" hero-gif "$BUILD"
python3 "$HERE/compose.py" optimise "$BUILD"
python3 "$HERE/compose.py" sheet "$BUILD"

step "5/5 docs/images/"
if [[ "$COPY_INTO_DOCS" == "1" ]]; then
  # Only what README.md shows: the frames, story strips and board-day.gif stay in the build.
  copied=0
  for image_name in $(grep -o 'docs/images/[A-Za-z0-9._-]*' "$REPOSITORY/README.md" | sed 's|docs/images/||' | sort -u); do
    if [[ -f "$BUILD/images/$image_name" ]]; then
      cp "$BUILD/images/$image_name" "$REPOSITORY/docs/images/"
      copied=$((copied + 1))
    fi
  done
  echo "copied the $copied images README.md shows into docs/images/; review with: git -C \"$REPOSITORY\" status docs/images"
else
  echo "left docs/images/ alone; the new images are in $BUILD/images"
fi

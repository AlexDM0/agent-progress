#!/usr/bin/env bash
# Regenerates every README graphic that shows the Bridge: seeds a synthetic board in a scratch tracker through this
# checkout's own CLI, starts its Overseer there with the fake agent adapter, shoots each view, and copies the ones
# README.md shows into docs/images/. Run it after any change to how the Bridge looks.
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
[[ -d "$REPOSITORY/node_modules/react" ]] || { echo "run bun install in $REPOSITORY first" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/agent-progress-readme-graphics.XXXXXX")"
if [[ "$KEEP_DEMO" == "1" ]]; then
  trap 'echo "demo repository kept at $WORK/example-storefront"' EXIT
else
  trap 'rm -rf "$WORK"' EXIT
fi
rm -rf "$BUILD"
mkdir -p "$BUILD"

step "1/3 Seeding the synthetic board in a scratch tracker through this checkout's CLI"
bash "$HERE/seed-demo.sh" "$WORK"

step "2/3 Starting the Overseer with the fake agent adapter and shooting each view of the Bridge"
bash "$HERE/bridge-demo.sh" "$WORK" "$BUILD/images"

step "3/3 docs/images/"
if [[ "$COPY_INTO_DOCS" == "1" ]]; then
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

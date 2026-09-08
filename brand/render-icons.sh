#!/usr/bin/env bash
# Regenerate the PNG app icons from brand/icon.svg into static/.
# Requires rsvg-convert (brew install librsvg).
set -euo pipefail

cd "$(dirname "$0")/.."
src=brand/icon.svg

# iOS apple-touch-icon sizes (iPhone @3x / iPad Pro / iPad / iPhone @2x) plus
# the manifest's any+maskable pair and a PNG favicon fallback.
for size in 120 152 167 180 192 512; do
	rsvg-convert -w "$size" -h "$size" "$src" -o "static/icon-${size}.png"
	echo "static/icon-${size}.png"
done

rsvg-convert -w 32 -h 32 "$src" -o static/favicon-32.png
echo "static/favicon-32.png"

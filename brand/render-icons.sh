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

# Root-path fallbacks. Safari probes /apple-touch-icon.png and
# /apple-touch-icon-precomposed.png even when the <link> tags are present, and
# every browser probes /favicon.ico — without these the server log fills with
# 404s and iOS may fall back to a screenshot for the home-screen icon.
cp static/icon-180.png static/apple-touch-icon.png
cp static/icon-180.png static/apple-touch-icon-precomposed.png
echo "static/apple-touch-icon.png"
echo "static/apple-touch-icon-precomposed.png"

# favicon.ico as a real ICO container wrapping PNG frames at 16/32/48. (ICO has
# supported PNG-compressed frames since Vista, so no BMP encoding needed.)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for size in 16 32 48; do
	rsvg-convert -w "$size" -h "$size" "$src" -o "$tmp/${size}.png"
done
python3 - "$tmp" static/favicon.ico <<'PY'
import struct, sys

tmp, out = sys.argv[1], sys.argv[2]
sizes = [16, 32, 48]
blobs = [open(f"{tmp}/{s}.png", "rb").read() for s in sizes]

# ICONDIR: reserved, type=1 (icon), image count
header = struct.pack("<HHH", 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries, data = b"", b""
for size, blob in zip(sizes, blobs):
    # ICONDIRENTRY: w, h, palette, reserved, planes, bpp, bytes, offset
    entries += struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(blob), offset)
    data += blob
    offset += len(blob)

with open(out, "wb") as f:
    f.write(header + entries + data)
PY
echo "static/favicon.ico"

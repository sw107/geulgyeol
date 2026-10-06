#!/bin/sh
# Seal the whole macOS bundle after packaging. This is ad-hoc signing,
# not Developer ID signing or Apple notarization.
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo "macOS bundle signing requires macOS." >&2
  exit 1
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || [ ! -d "$1/Contents" ]; then
  echo "Usage: sign-mac-bundle.sh path/to/app.app [bundle-id]" >&2
  exit 1
fi
codesign --force --deep --sign - --identifier "${2:-org.geulgyeol.beta}" "$1"
codesign --verify --deep --strict --verbose=2 "$1"
echo "Bundle signature verified. Developer ID signing and Apple notarization are not provided."

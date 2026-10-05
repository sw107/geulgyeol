#!/bin/sh
# Seal the whole macOS bundle after packaging. This is ad-hoc signing,
# not Developer ID signing or Apple notarization.
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo "macOS bundle signing requires macOS." >&2
  exit 1
fi
if [ "$#" -ne 1 ] || [ ! -d "$1/Contents" ]; then
  echo "Usage: sign-mac-bundle.sh path/to/GeulgyeolBeta.app" >&2
  exit 1
fi
codesign --force --deep --sign - --identifier org.geulgyeol.beta "$1"
codesign --verify --deep --strict --verbose=2 "$1"
echo "Bundle signature verified. Developer ID signing and Apple notarization are not provided."

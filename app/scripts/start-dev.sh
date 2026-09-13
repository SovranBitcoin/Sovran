#!/usr/bin/env bash
# Start the installed development client from this checkout, including on a phone.
set -euo pipefail

cd "$(dirname "$0")/.."
export EXPO_PUBLIC_ENV=development
exec bunx --no-install expo start --dev-client --clear "$@"

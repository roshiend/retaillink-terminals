#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$SCRIPT_DIR/app/libs"
DEST="$DEST_DIR/FTSDK_api_V1.0.0.71_20220401.jar"
EXPECTED_SHA256="d755e63fd5f520a0920b857b8f5e285961b52c0e45aa68c1da30007047f7766c"
DEFAULT_URL="https://raw.githubusercontent.com/avinashtilekar/CollectionApp/c57a4bc1f02e775732cde57ebdd87346e13a7518/app/libs/FTSDK_api_V1.0.0.71_20220401.jar"
SOURCE_URL="${FTSDK_SOURCE_URL:-$DEFAULT_URL}"

mkdir -p "$DEST_DIR"

verify() {
  local file="$1"
  echo "$EXPECTED_SHA256  $file" | sha256sum --check --status
}

if [[ -f "$DEST" ]] && verify "$DEST"; then
  echo "FEITIAN FTSDK already present and verified: $DEST"
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl --fail --location --retry 3 --silent --show-error "$SOURCE_URL" --output "$TMP"

if ! verify "$TMP"; then
  echo "ERROR: downloaded FEITIAN FTSDK does not match the expected SHA-256." >&2
  sha256sum "$TMP" >&2
  exit 1
fi

mv "$TMP" "$DEST"
trap - EXIT

echo "Verified FEITIAN FTSDK v1.0.0.71"
sha256sum "$DEST"

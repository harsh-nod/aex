#!/usr/bin/env bash
set -euo pipefail

# Rewrites file: dependencies to versioned references before npm publish.
# Usage: ./scripts/prepublish.sh [version]
# Restore with: git checkout -- packages/*/package.json

VERSION="${1:-0.0.1}"

for pkg in packages/*/package.json; do
  sed -i "s|\"file:../aex-[^\"]*\"|\"^${VERSION}\"|g" "$pkg"
  echo "Updated $pkg"
done

echo "Dependencies rewritten to ^${VERSION}"
echo "Run 'npm publish -w packages/aex-parser -w packages/aex-validator -w packages/aex-runtime -w packages/aex-cli -w packages/aex-openai-agents -w packages/aex-mcp-gateway -w packages/aex-langgraph' to publish."
echo "Restore with: git checkout -- packages/*/package.json"

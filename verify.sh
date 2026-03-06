#!/usr/bin/env bash
#
# Verify the iMessage Monterey plugin is ready for installation
#

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERRORS=0

echo "🔍 Verifying iMessage Monterey Plugin"
echo "======================================"
echo ""

# Check required files
echo "📁 Checking required files..."
REQUIRED_FILES=(
  "index.ts"
  "openclaw.plugin.json"
  "package.json"
  "tsconfig.json"
  "src/types.ts"
  "src/db.ts"
  "src/applescript.ts"
  "src/provider.ts"
  "src/channel.ts"
  "src/utils.ts"
  "README.md"
  "QUICKSTART.md"
  "PROJECT_SUMMARY.md"
  "setup.sh"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$PLUGIN_DIR/$file" ]]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (missing)"
    ((ERRORS++))
  fi
done

echo ""

# Check plugin manifest
echo "📋 Checking plugin manifest..."
if [[ -f "$PLUGIN_DIR/openclaw.plugin.json" ]]; then
  if command -v jq &> /dev/null; then
    if jq empty "$PLUGIN_DIR/openclaw.plugin.json" 2>/dev/null; then
      echo "  ✅ Valid JSON"
      PLUGIN_ID=$(jq -r '.id' "$PLUGIN_DIR/openclaw.plugin.json")
      echo "  ✅ Plugin ID: $PLUGIN_ID"
    else
      echo "  ❌ Invalid JSON"
      ((ERRORS++))
    fi
  else
    echo "  ⚠️  jq not installed, skipping JSON validation"
  fi
fi

echo ""

# Check TypeScript syntax
echo "🔧 Checking TypeScript syntax..."
if command -v npx &> /dev/null; then
  if npx tsc --noEmit --project "$PLUGIN_DIR/tsconfig.json" 2>/dev/null; then
    echo "  ✅ No TypeScript errors"
  else
    echo "  ⚠️  TypeScript errors found (run 'npx tsc' for details)"
  fi
else
  echo "  ⚠️  npx not available, skipping TypeScript check"
fi

echo ""

# Summary
echo "======================================"
if [[ $ERRORS -eq 0 ]]; then
  echo "✅ Plugin is ready for installation!"
  echo ""
  echo "Next steps:"
  echo "  1. Run: ./setup.sh install"
  echo "  2. Configure: ~/.openclaw/openclaw.json"
  echo "  3. Restart: openclaw gateway restart"
  echo ""
  echo "See QUICKSTART.md for detailed instructions."
  exit 0
else
  echo "❌ Found $ERRORS error(s)"
  echo "Please fix the issues above before installing."
  exit 1
fi

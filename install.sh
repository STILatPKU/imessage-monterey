#!/bin/bash
# Install iMessage Monterey Plugin
# Run this script to install the plugin to OpenClaw

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_APPS="$HOME/Applications"
EXT_DIR="$HOME/.openclaw/extensions/imessage-monterey"

echo "🦞 iMessage Monterey Plugin Installer"
echo "======================================"
echo ""

# Step 1: Build Swift Helper
echo "📦 Step 1: Building Swift Helper..."
cd "$SCRIPT_DIR/helper"
if ! swiftc -o imessage-helper Sources/main.swift -O -framework Cocoa -lsqlite3 2>&1; then
    echo "❌ Failed to build Swift helper"
    exit 1
fi
echo "✅ Swift helper built"
echo ""

# Step 2: Install Helper App
echo "📦 Step 2: Installing Helper App..."
mkdir -p "$HOME_APPS/IMessageHelper.app/Contents/MacOS"
mkdir -p "$HOME_APPS/IMessageHelper.app/Contents/Resources"
cp imessage-helper "$HOME_APPS/IMessageHelper.app/Contents/MacOS/"

# Create Info.plist
cat > "$HOME_APPS/IMessageHelper.app/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>imessage-helper</string>
    <key>CFBundleIdentifier</key>
    <string>com.openclaw.imessage-helper</string>
    <key>CFBundleName</key>
    <string>IMessageHelper</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSBackgroundOnly</key>
    <true/>
</dict>
</plist>
EOF
echo "✅ Helper app installed to $HOME_APPS/IMessageHelper.app"
echo ""

# Step 3: Test Helper
echo "📦 Step 3: Testing Helper..."
if ! "$HOME_APPS/IMessageHelper.app/Contents/MacOS/imessage-helper" check 2>&1 | grep -q '"ok"'; then
    echo "⚠️  Helper cannot access Messages database"
    echo ""
    echo "You need to grant Full Disk Access to IMessageHelper.app:"
    echo "  1. Open System Preferences → Privacy → Full Disk Access"
    echo "  2. Click the lock and authenticate"
    echo "  3. Click + and add: $HOME_APPS/IMessageHelper.app"
    echo ""
    read -p "Press Enter after granting Full Disk Access..."
    
    if ! "$HOME_APPS/IMessageHelper.app/Contents/MacOS/imessage-helper" check 2>&1 | grep -q '"ok"'; then
        echo "❌ Still cannot access database. Please grant Full Disk Access and run again."
        exit 1
    fi
fi
echo "✅ Helper can access Messages database"
echo ""

# Step 4: Build TypeScript Plugin
echo "📦 Step 4: Building TypeScript Plugin..."
cd "$SCRIPT_DIR"
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --silent
fi
npm run build
echo "✅ Plugin built"
echo ""

# Step 5: Deploy Plugin
echo "📦 Step 5: Deploying Plugin..."
mkdir -p "$EXT_DIR/dist"
cp -r dist/src "$EXT_DIR/dist/"
cp index.ts "$EXT_DIR/"
cp package.json "$EXT_DIR/"
echo "✅ Plugin deployed to $EXT_DIR"
echo ""

# Step 6: Configure
echo "📦 Step 6: Configuration..."
echo ""
echo "Add this to your ~/.openclaw/openclaw.json:"
echo ""
cat << 'JSON'
{
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "allowFrom": ["+1234567890"],
      "adminList": ["+1234567890"]
    }
  }
}
JSON
echo ""
echo "Replace +1234567890 with your phone number(s)."
echo ""

# Step 7: Restart Gateway
read -p "Restart OpenClaw gateway now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Restarting gateway..."
    openclaw gateway restart 2>/dev/null || openclaw gateway start 2>/dev/null || echo "Please restart manually: openclaw gateway restart"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Test by sending '/help' from your admin phone number."

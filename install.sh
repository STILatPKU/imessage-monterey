#!/bin/bash
# Install iMessage Monterey Plugin
# Run this script to install the plugin to OpenClaw

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_APPS="$HOME/Applications"
EXT_DIR="$HOME/.openclaw/extensions/imessage-monterey"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[INSTALL]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_usage() {
    echo "iMessage Monterey Plugin Installer"
    echo ""
    echo "Usage: ./install.sh [command]"
    echo ""
    echo "Commands:"
    echo "  check       Check prerequisites only (no installation)"
    echo "  install     Full installation (default)"
    echo "  build       Build only (no deployment)"
    echo "  clean       Remove build artifacts"
    echo ""
}

# Check macOS version
check_macos() {
    log "Checking macOS version..."
    
    if [[ "$(uname)" != "Darwin" ]]; then
        error "This plugin only works on macOS"
        exit 1
    fi
    
    local version=$(sw_vers -productVersion)
    local major=$(echo "$version" | cut -d. -f1)
    
    if [[ "$major" -lt 12 ]]; then
        error "macOS 12+ required. Found: $version"
        exit 1
    fi
    
    success "macOS $version"
}

# Check Messages database
check_database() {
    log "Checking Messages database..."
    
    local db_path="$HOME/Library/Messages/chat.db"
    
    if [[ ! -f "$db_path" ]]; then
        error "Messages database not found: $db_path"
        error "Make sure Messages.app has been used"
        exit 1
    fi
    
    success "Database found at $db_path"
}

# Check Messages.app
check_messages_app() {
    log "Checking Messages.app..."
    
    if ! pgrep -x "Messages" > /dev/null; then
        warn "Messages.app not running (messages may not send immediately)"
    else
        success "Messages.app is running"
    fi
}

# Build Swift helper
build_helper() {
    log "Building Swift helper..."
    
    cd "$SCRIPT_DIR/helper"
    
    if ! swiftc -o imessage-helper Sources/main.swift -O -framework Cocoa -lsqlite3 2>&1; then
        error "Failed to build Swift helper"
        exit 1
    fi
    
    success "Swift helper built"
}

# Install helper app
install_helper() {
    log "Installing helper app..."
    
    mkdir -p "$HOME_APPS/IMessageHelper.app/Contents/MacOS"
    mkdir -p "$HOME_APPS/IMessageHelper.app/Contents/Resources"
    
    cp "$SCRIPT_DIR/helper/imessage-helper" "$HOME_APPS/IMessageHelper.app/Contents/MacOS/"
    
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
    
    success "Helper installed to $HOME_APPS/IMessageHelper.app"
}

# Test helper
test_helper() {
    log "Testing helper..."
    
    if ! "$HOME_APPS/IMessageHelper.app/Contents/MacOS/imessage-helper" check 2>&1 | grep -q '"ok"'; then
        warn "Helper cannot access Messages database"
        echo ""
        echo "You need to grant Full Disk Access to IMessageHelper.app:"
        echo "  1. Open System Preferences → Privacy → Full Disk Access"
        echo "  2. Click the lock and authenticate"
        echo "  3. Click + and add: $HOME_APPS/IMessageHelper.app"
        echo ""
        read -p "Press Enter after granting Full Disk Access..."
        
        if ! "$HOME_APPS/IMessageHelper.app/Contents/MacOS/imessage-helper" check 2>&1 | grep -q '"ok"'; then
            error "Still cannot access database. Grant Full Disk Access and run again."
            exit 1
        fi
    fi
    
    success "Helper can access database"
}

# Build TypeScript plugin
build_plugin() {
    log "Building TypeScript plugin..."
    
    cd "$SCRIPT_DIR"
    
    if [ ! -d "node_modules" ]; then
        log "Installing dependencies..."
        npm install --silent
    fi
    
    npm run build
    
    success "Plugin built"
}

# Deploy plugin
deploy_plugin() {
    log "Deploying plugin..."
    
    # Create extension directory
    mkdir -p "$EXT_DIR/dist/src"
    
    # Copy compiled code
    cp -r "$SCRIPT_DIR/dist/src/"* "$EXT_DIR/dist/src/"
    cp "$SCRIPT_DIR/dist/index.js" "$EXT_DIR/dist/"
    
    # Copy required files
    cp "$SCRIPT_DIR/openclaw.plugin.json" "$EXT_DIR/"
    cp "$SCRIPT_DIR/package.json" "$EXT_DIR/"
    
    success "Plugin deployed to $EXT_DIR"
}

# Show config example
show_config() {
    echo ""
    log "Configuration"
    echo ""
    echo "You need to add this to ~/.openclaw/openclaw.json:"
    echo ""
    echo '  "plugins": {'
    echo '    "allow": ["imessage-monterey"]'
    echo '  },'
    echo '  "channels": {'
    echo '    "imessage-monterey": {'
    echo '      "enabled": true,'
    echo '      "dmPolicy": "pairing",'
    echo '      "groupPolicy": "allowlist",'
    echo '      "allowFrom": ["+YOUR_PHONE_HERE"],'
    echo '      "adminList": ["+YOUR_PHONE_HERE"]'
    echo '    }'
    echo '  }'
    echo ""
    echo "Replace +YOUR_PHONE_HERE with your phone number (e.g., +8613800138000)."
}

# Verify config exists and is correct
verify_config() {
    local config_file="$HOME/.openclaw/openclaw.json"
    local has_plugin=false
    local has_channel=false
    local warnings=()
    
    if [[ ! -f "$config_file" ]]; then
        warn "OpenClaw config not found at $config_file"
        show_config
        return 1
    fi
    
    # Check if imessage-monterey is in plugins.allow
    if grep -q '"plugins"' "$config_file" 2>/dev/null; then
        if grep -q '"allow".*"imessage-monterey"\|"imessage-monterey".*"allow"' "$config_file" 2>/dev/null; then
            has_plugin=true
        else
            warnings+=("plugins.allow does not include imessage-monterey")
        fi
    else
        warnings+=("plugins section not found")
    fi
    
    # Check if there's a channel config for imessage-monterey
    if grep -q '"imessage-monterey"' "$config_file" 2>/dev/null; then
        if grep -A5 '"imessage-monterey"' "$config_file" | grep -q '"enabled"'; then
            has_channel=true
        else
            warnings+=("imessage-monterey channel config incomplete")
        fi
    else
        warnings+=("imessage-monterey channel not configured")
    fi
    
    # Report results
    if $has_plugin && $has_channel; then
        success "Configuration looks good"
        return 0
    fi
    
    # Show warnings
    echo ""
    warn "Configuration issues found:"
    for w in "${warnings[@]}"; do
        echo "  - $w"
    done
    
    show_config
    return 1
}

# Clean artifacts
clean() {
    log "Cleaning build artifacts..."
    
    rm -rf "$SCRIPT_DIR/dist"
    rm -rf "$SCRIPT_DIR/node_modules"
    rm -f "$SCRIPT_DIR/helper/imessage-helper"
    
    success "Cleaned"
}

# Main
case "${1:-install}" in
    check)
        check_macos
        check_database
        check_messages_app
        echo ""
        success "Prerequisites OK"
        ;;
    install)
        echo "🦞 iMessage Monterey Plugin Installer"
        echo "======================================"
        echo ""
        check_macos
        check_database
        check_messages_app
        build_helper
        install_helper
        test_helper
        build_plugin
        deploy_plugin
        echo ""
        verify_config
        echo ""
        read -p "Restart OpenClaw gateway now? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            openclaw gateway restart 2>/dev/null || openclaw gateway start 2>/dev/null || warn "Restart manually: openclaw gateway restart"
        fi
        echo ""
        success "Installation complete!"
        echo ""
        echo "Test by sending '/help' from your admin phone number."
        ;;
    build)
        build_helper
        build_plugin
        success "Build complete"
        ;;
    clean)
        clean
        ;;
    help|--help|-h)
        print_usage
        ;;
    *)
        error "Unknown command: $1"
        print_usage
        exit 1
        ;;
esac

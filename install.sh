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
    echo "  verify      Verify installation after deployment"
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

# Check Messages.app - with option to open and wait
check_messages_app() {
    log "Checking Messages.app..."
    
    while ! pgrep -x "Messages" > /dev/null; do
        warn "Messages.app is not running!"
        echo ""
        echo "── MESSAGES.APP NOT RUNNING ──"
        echo ""
        echo "The plugin can receive messages but CANNOT send replies."
        echo "Keep Messages.app open for full functionality."
        echo ""
        echo "Options:"
        echo "  1) Open Messages.app now"
        echo "  2) Skip (sending will NOT work)"
        echo "  3) Abort install"
        read -p "Choice (1/2/3): " -n 1 choice
        echo ""
        
        case $choice in
            1)
                open -a Messages
                sleep 2
                ;;  # Re-check the loop
            2)
                warn "Skipping. Plugin CANNOT SEND messages without Messages.app running."
                return 1
                ;;
            3)
                error "Install aborted"
                exit 1
                ;;
        esac
    done
    
    success "Messages.app is running"
    return 0
}

# Check Automation permission for AppleScript - with loop to let user grant
check_automation_permission() {
    log "Checking Automation permission for Messages.app..."
    
    while true; do
        # Try to interact with Messages via AppleScript
        local result
        result=$(osascript -e '
            tell application "Messages"
                try
                    set targetService to 1st service whose service type = iMessage
                    return "ok"
                on error errMsg
                    return "error: " & errMsg
                end try
            end tell
        ' 2>&1)
        
        if [[ "$result" != *"Not authorized"* ]] && [[ "$result" != *"-1743"* ]]; then
            success "Automation permission OK"
            return 0
        fi
        
        error "Automation permission NOT granted"
        echo ""
        echo "── AUTOMATION PERMISSION REQUIRED ──"
        echo ""
        echo "1. Open System Preferences → Privacy → Automation"
        echo "2. Find your terminal app (Terminal, iTerm, etc.)"
        echo "3. Enable the 'Messages' checkbox"
        echo ""
        echo "Options:"
        echo "  1) I've granted it - re-check"
        echo "  2) Skip for now (plugin CANNOT SEND messages)"
        echo "  3) Abort install"
        read -p "Choice (1/2/3): " -n 1 choice
        echo ""
        
        case $choice in
            1)
                continue  # Re-check
                ;;
            2)
                warn "Skipping. Plugin CANNOT SEND messages without Automation permission."
                return 1
                ;;
            3)
                error "Install aborted"
                exit 1
                ;;
        esac
    done
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

# Test helper - with loop to let user grant Full Disk Access
test_helper() {
    log "Testing helper database access..."
    
    local helper_binary="$HOME_APPS/IMessageHelper.app/Contents/MacOS/imessage-helper"
    
    while ! "$helper_binary" check 2>&1 | grep -q '"ok"'; do
        error "Helper cannot access Messages database"
        echo ""
        echo "── FULL DISK ACCESS REQUIRED ──"
        echo ""
        echo "1. Open System Preferences → Privacy → Full Disk Access"
        echo "2. Click the lock and authenticate"
        echo "3. Click + and add: $HOME_APPS/IMessageHelper.app"
        echo "4. You may need to restart Terminal after granting"
        echo ""
        echo "Options:"
        echo "  1) I've granted it - re-check"
        echo "  2) Skip for now (plugin will NOT work)"
        echo "  3) Abort install"
        read -p "Choice (1/2/3): " -n 1 choice
        echo ""
        
        case $choice in
            1)
                continue  # Re-check
                ;;
            2)
                warn "Skipping. Plugin will NOT work without Full Disk Access."
                return 1
                ;;
            3)
                error "Install aborted"
                exit 1
                ;;
        esac
    done
    
    success "Helper has database access"
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
    
    # Verify build succeeded
    if [[ ! -f "$SCRIPT_DIR/dist/index.js" ]]; then
        error "Build failed - dist/index.js not found"
        exit 1
    fi
    
    success "Plugin built"
}

# Deploy plugin to OpenClaw extensions directory
# Uses Option B: openclaw.extensions in package.json
deploy_plugin() {
    log "Deploying plugin..."
    
    # Create extension directory structure
    mkdir -p "$EXT_DIR/dist/src"
    
    # Copy compiled code to dist/
    cp -r "$SCRIPT_DIR/dist/src/"* "$EXT_DIR/dist/src/" || {
        error "Failed to copy plugin files"
        exit 1
    }
    cp "$SCRIPT_DIR/dist/index.js" "$EXT_DIR/dist/"
    
    # Copy manifest
    cp "$SCRIPT_DIR/openclaw.plugin.json" "$EXT_DIR/"
    
    # Create package.json with openclaw.extensions entry point
    # This tells OpenClaw where to find the plugin entry point
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        # Use Node.js to merge openclaw.extensions into package.json
        node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
pkg.openclaw = pkg.openclaw || {};
pkg.openclaw.extensions = ["./dist/index.js"];
fs.writeFileSync(process.argv[2], JSON.stringify(pkg, null, 2));
' "$SCRIPT_DIR/package.json" "$EXT_DIR/package.json"
    else
        # Create minimal package.json with entry point
        cat > "$EXT_DIR/package.json" << 'PKGEOF'
{
  "name": "imessage-monterey",
  "version": "1.0.0",
  "openclaw": {
    "extensions": ["./dist/index.js"]
  }
}
PKGEOF
    fi
    
    success "Plugin deployed to $EXT_DIR"
}

# Verify plugin installation
# Checks all requirements for OpenClaw to discover and load the plugin
verify_installation() {
    log "Verifying plugin installation..."
    echo ""
    
    local errors=0
    local warnings=0
    
    # Check 1: Extension directory exists
    echo "1. Extension directory"
    if [[ -d "$EXT_DIR" ]]; then
        success "   Directory exists: $EXT_DIR"
    else
        error "   Directory missing: $EXT_DIR"
        ((errors++))
    fi
    
    # Check 2: Manifest file exists and is valid JSON
    echo "2. Plugin manifest (openclaw.plugin.json)"
    local manifest="$EXT_DIR/openclaw.plugin.json"
    if [[ -f "$manifest" ]]; then
        if node -e "JSON.parse(require('fs').readFileSync('$manifest'))" 2>/dev/null; then
            success "   Manifest is valid JSON"
            # Check required fields
            if node -e "const m=JSON.parse(require('fs').readFileSync('$manifest'));if(!m.id||!m.name||!m.version)process.exit(1)" 2>/dev/null; then
                success "   Required fields present (id, name, version)"
            else
                warn "   Missing required fields (id, name, or version)"
                ((warnings++))
            fi
        else
            error "   Manifest is not valid JSON"
            ((errors++))
        fi
    else
        error "   Manifest not found: $manifest"
        ((errors++))
    fi
    
    # Check 3: Entry point is discoverable
    echo "3. Entry point discovery"
    local entry_found=false
    
    # Option A: index.js at root
    if [[ -f "$EXT_DIR/index.js" ]]; then
        success "   Found: index.js at root"
        entry_found=true
    fi
    
    # Option B: package.json with openclaw.extensions
    local pkg="$EXT_DIR/package.json"
    if [[ -f "$pkg" ]]; then
        if node -e "const p=JSON.parse(require('fs').readFileSync('$pkg'));if(p.openclaw&&p.openclaw.extensions&&p.openclaw.extensions.length>0)process.exit(0);process.exit(1)" 2>/dev/null; then
            local entry=$(node -e "const p=JSON.parse(require('fs').readFileSync('$pkg'));console.log(p.openclaw.extensions[0])")
            local entry_path="$EXT_DIR/$entry"
            if [[ -f "$entry_path" ]]; then
                success "   Found via openclaw.extensions: $entry"
                entry_found=true
            else
                error "   openclaw.extensions points to missing file: $entry_path"
                ((errors++))
            fi
        fi
    fi
    
    # Option C: index.ts at root
    if [[ -f "$EXT_DIR/index.ts" ]]; then
        success "   Found: index.ts at root"
        entry_found=true
    fi
    
    if ! $entry_found; then
        error "   No entry point found!"
        error "   OpenClaw looks for one of:"
        error "     - index.js at extension root"
        error "     - index.ts at extension root"
        error "     - openclaw.extensions in package.json"
        ((errors++))
    fi
    
    # Check 4: package.json exists
    echo "4. Package configuration (package.json)"
    if [[ -f "$pkg" ]]; then
        success "   package.json exists"
        if grep -q '"openclaw"' "$pkg" 2>/dev/null; then
            success "   Contains openclaw configuration"
        else
            warn "   No openclaw configuration section"
            ((warnings++))
        fi
    else
        warn "   package.json not found (optional but recommended)"
        ((warnings++))
    fi
    
    # Check 5: Compiled plugin files
    echo "5. Compiled plugin files"
    local dist_index="$EXT_DIR/dist/index.js"
    local dist_channel="$EXT_DIR/dist/src/channel.js"
    
    if [[ -f "$dist_index" ]]; then
        success "   dist/index.js exists"
    else
        error "   dist/index.js missing"
        ((errors++))
    fi
    
    if [[ -f "$dist_channel" ]]; then
        success "   dist/src/channel.js exists"
    else
        error "   dist/src/channel.js missing"
        ((errors++))
    fi
    
    # Check 6: Helper app
    echo "6. Helper application"
    local helper_app="$HOME_APPS/IMessageHelper.app"
    local helper_binary="$helper_app/Contents/MacOS/imessage-helper"
    
    if [[ -d "$helper_app" ]]; then
        success "   Helper app installed: $helper_app"
        
        if [[ -f "$helper_binary" ]]; then
            success "   Binary exists"
            
            # Test if helper can access database
            if "$helper_binary" check 2>&1 | grep -q '"ok"'; then
                success "   Helper has database access"
            else
                warn "   Helper cannot access Messages database"
                warn "   Grant Full Disk Access: System Preferences → Privacy → Full Disk Access"
                ((warnings++))
            fi
        else
            error "   Binary missing: $helper_binary"
            ((errors++))
        fi
    else
        error "   Helper app not installed: $helper_app"
        ((errors++))
    fi
    
    # Check 7: Helper app Info.plist
    echo "7. Helper app configuration"
    local helper_plist="$helper_app/Contents/Info.plist"
    if [[ -f "$helper_plist" ]]; then
        success "   Info.plist exists"
        
        if grep -q "com.openclaw.imessage-helper" "$helper_plist" 2>/dev/null; then
            success "   Correct bundle identifier"
        else
            warn "   Unexpected bundle identifier"
            ((warnings++))
        fi
    else
        error "   Info.plist missing"
        ((errors++))
    fi
    
    # Check 8: Automation permission
    echo "8. Automation permission"
    local auto_result
    auto_result=$(osascript -e '
        tell application "Messages"
            try
                set targetService to 1st service whose service type = iMessage
                return "ok"
            on error errMsg
                return "error: " & errMsg
            end try
        end tell
    ' 2>&1)
    
    if [[ "$auto_result" == *"Not authorized"* ]] || [[ "$auto_result" == *"-1743"* ]]; then
        error "   Automation permission NOT granted"
        error "   Grant in: System Preferences → Privacy → Automation"
        error "   Enable 'Messages' for your terminal app"
        ((errors++))
    else
        success "   Automation permission OK"
    fi
    
    # Summary
    echo ""
    echo "======================================"
    if [[ $errors -eq 0 ]]; then
        success "Verification passed with $warnings warning(s)"
        echo ""
        echo "Plugin is ready to use. Restart OpenClaw gateway:"
        echo "  openclaw gateway restart"
        return 0
    else
        error "Verification failed with $errors error(s) and $warnings warning(s)"
        echo ""
        echo "Fix the errors above and run again:"
        echo "  ./install.sh install"
        return 1
    fi
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

# Verify config exists and is correct - with loop to let user fix
verify_config() {
    local config_file="$HOME/.openclaw/openclaw.json"
    
    while true; do
        local has_plugin=false
        local has_channel=false
        local warnings=()
        
        if [[ ! -f "$config_file" ]]; then
            warn "OpenClaw config not found at $config_file"
            show_config
        else
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
        fi
        
        # Give user options
        echo ""
        echo "── CONFIGURATION REQUIRED ──"
        echo ""
        echo "Options:"
        echo "  1) Edit config now and re-verify"
        echo "  2) Skip for now (plugin will not work)"
        echo "  3) Abort install"
        read -p "Choice (1/2/3): " -n 1 choice
        echo ""
        
        case $choice in
            1)
                ${EDITOR:-nano} "$config_file"
                continue  # Re-check
                ;;
            2)
                warn "Skipping. Plugin will NOT work without proper configuration."
                return 1
                ;;
            3)
                error "Install aborted"
                exit 1
                ;;
        esac
    done
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
        check_automation_permission
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
        check_automation_permission
        build_helper
        install_helper
        test_helper
        build_plugin
        deploy_plugin
        echo ""
        verify_installation
        local install_ok=$?
        echo ""
        verify_config
        local config_ok=$?
        
        if [[ $install_ok -ne 0 || $config_ok -ne 0 ]]; then
            error "Installation incomplete. Fix issues above."
            echo ""
            echo "After fixing, run: ./install.sh install"
            exit 1
        fi
        
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
    verify)
        verify_installation
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

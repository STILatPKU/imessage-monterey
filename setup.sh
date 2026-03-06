#!/usr/bin/env bash
#
# Setup script for iMessage Monterey plugin
# This script helps configure the plugin and checks prerequisites
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS_DIR="$HOME/.openclaw/extensions"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

log() {
    echo -e "${BLUE}[SETUP]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check macOS
check_macos() {
    log "Checking operating system..."
    
    if [[ "$(uname)" != "Darwin" ]]; then
        error "This plugin only works on macOS"
        exit 1
    fi
    
    local version
    version=$(sw_vers -productVersion)
    local major
    major=$(echo "$version" | cut -d. -f1)
    
    if [[ "$major" -lt 12 ]]; then
        error "macOS 12+ required. Found: $version"
        exit 1
    fi
    
    success "macOS $version detected"
}

# Check Messages database access
check_database() {
    log "Checking Messages database access..."
    
    local db_path="$HOME/Library/Messages/chat.db"
    
    if [[ ! -f "$db_path" ]]; then
        error "Messages database not found at: $db_path"
        error "Make sure Messages.app is installed and has been used"
        exit 1
    fi
    
    # Try to read from database
    if sqlite3 "$db_path" "SELECT COUNT(*) FROM message" &>/dev/null; then
        success "Database is accessible"
    else
        warn "Database access denied"
        warn "You need to grant Full Disk Access to Terminal"
        warn ""
        warn "To fix:"
        warn "1. Open System Preferences → Security & Privacy → Privacy"
        warn "2. Select 'Full Disk Access' from the left sidebar"
        warn "3. Click the lock and authenticate"
        warn "4. Add Terminal.app (or your terminal app) to the list"
        warn "5. Restart your terminal"
        echo ""
        read -p "Press Enter to continue anyway, or Ctrl+C to exit..."
    fi
}

# Check Messages.app status
check_messages_app() {
    log "Checking Messages.app..."
    
    if ! pgrep -x "Messages" > /dev/null; then
        warn "Messages.app is not running"
        warn "The plugin will still work, but messages may not send immediately"
    else
        success "Messages.app is running"
    fi
    
    # Check if signed in
    local imessage_status
    imessage_status=$(osascript -e 'tell application "Messages" to return (count of services) > 0' 2>/dev/null || echo "false")
    
    if [[ "$imessage_status" == "false" ]]; then
        warn "Messages.app may not be signed in to iMessage"
        warn "Open Messages.app and sign in to use this plugin"
    else
        success "Messages.app appears to be signed in"
    fi
}

# Install dependencies
install_deps() {
    log "Installing dependencies..."
    
    cd "$PLUGIN_DIR"
    
    if command -v pnpm &> /dev/null; then
        pnpm install
    elif command -v npm &> /dev/null; then
        npm install
    else
        error "Neither pnpm nor npm found. Please install Node.js and npm."
        exit 1
    fi
    
    success "Dependencies installed"
}

# Build plugin
build_plugin() {
    log "Building plugin..."
    
    cd "$PLUGIN_DIR"
    
    if command -v pnpm &> /dev/null; then
        pnpm run build
    else
        npm run build
    fi
    
    success "Plugin built successfully"
}

# Install to OpenClaw
install_plugin() {
    log "Installing plugin to OpenClaw..."
    
    mkdir -p "$EXTENSIONS_DIR"
    
    local target_dir="$EXTENSIONS_DIR/imessage-monterey"
    
    # Remove old installation if exists
    if [[ -d "$target_dir" ]]; then
        log "Removing old installation..."
        rm -rf "$target_dir"
    fi
    
    # Copy plugin files
    cp -r "$PLUGIN_DIR" "$target_dir"
    
    # Remove development files
    rm -rf "$target_dir/node_modules"
    rm -rf "$target_dir/.git"
    rm -rf "$target_dir/src"
    
    success "Plugin installed to: $target_dir"
}

# Update OpenClaw config
update_config() {
    log "Checking OpenClaw configuration..."
    
    if [[ ! -f "$CONFIG_FILE" ]]; then
        warn "OpenClaw config not found at: $CONFIG_FILE"
        warn "Please create the config file first"
        return
    fi
    
    # Check if iMessage Monterey is already configured
    if grep -q "imessage-monterey" "$CONFIG_FILE" 2>/dev/null; then
        warn "iMessage Monterey already configured in openclaw.json"
        warn "Please review and update manually if needed"
        return
    fi
    
    log "To enable the plugin, add this to your openclaw.json:"
    echo ""
    cat << 'EOF'
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "dbPath": "~/Library/Messages/chat.db",
      "pollIntervalMs": 10000,
      "dmPolicy": "allowlist",
      "allowFrom": ["+1234567890"],
      "groupPolicy": "allowlist"
    }
  }
EOF
    echo ""
}

# Print usage
print_usage() {
    echo "iMessage Monterey Plugin Setup"
    echo ""
    echo "Usage: ./setup.sh [command]"
    echo ""
    echo "Commands:"
    echo "  check       Check prerequisites only"
    echo "  install     Full installation (check + deps + build + install)"
    echo "  build       Build the plugin only"
    echo "  clean       Clean build artifacts"
    echo ""
    echo "Examples:"
    echo "  ./setup.sh check     # Check if your system is ready"
    echo "  ./setup.sh install   # Full installation"
    echo ""
}

# Clean build artifacts
clean() {
    log "Cleaning build artifacts..."
    cd "$PLUGIN_DIR"
    rm -rf dist/
    rm -rf node_modules/
    success "Cleaned"
}

# Main
case "${1:-install}" in
    check)
        check_macos
        check_database
        check_messages_app
        ;;
    install)
        check_macos
        check_database
        check_messages_app
        install_deps
        build_plugin
        install_plugin
        update_config
        echo ""
        success "Installation complete!"
        echo ""
        log "Next steps:"
        echo "1. Review the example config in config.example.json"
        echo "2. Add the channel config to ~/.openclaw/openclaw.json"
        echo "3. Restart OpenClaw Gateway: openclaw gateway restart"
        echo "4. Check status: openclaw doctor"
        echo ""
        ;;
    build)
        build_plugin
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

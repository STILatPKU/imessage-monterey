# Quick Start Guide - iMessage Monterey Plugin

Get iMessage working with OpenClaw on macOS 12 in 5 minutes.

## Prerequisites

- macOS 12 Monterey or later
- Messages.app signed in with iMessage
- Node.js 18+ installed
- Terminal with Full Disk Access (see step 3)

## Installation

### Step 1: Install the Plugin

```bash
cd ~/.openclaw/workspace/imessage-monterey
./install.sh install
```

This will:
- Check your system
- Install dependencies
- Build the plugin
- Install to OpenClaw extensions

### Step 2: Configure OpenClaw

Add this to your `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "allowFrom": ["+1234567890"],
      "groupPolicy": "allowlist"
    }
  }
}
```

**Replace `+1234567890` with your phone number.**

### Step 3: Grant Permissions

The plugin needs Full Disk Access to read the Messages database:

1. Open **System Preferences** → **Security & Privacy** → **Privacy**
2. Click **Full Disk Access** in the left sidebar
3. Click the **lock** icon and authenticate
4. Click **+** and add **IMessageHelper.app** from `~/Applications/`
5. **Restart your terminal** (if needed)

### Step 4: Restart OpenClaw

```bash
openclaw gateway restart
```

### Step 5: Test It

1. Send an iMessage from your iPhone to your Mac
2. The message should appear in OpenClaw logs
3. OpenClaw should respond based on your configuration

## Configuration Options

### Minimal (Open to everyone)

```json
{
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "dmPolicy": "open"
    }
  }
}
```

### Secure (Allowlist only)

```json
{
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "allowFrom": ["+1234567890", "+9876543210"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["+1234567890"],
      "adminList": ["+1234567890"]
    }
  }
}
```

### With Command Prefix

Require `!claw` prefix for all commands:

```json
{
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "prefix": "!claw",
      "dmPolicy": "allowlist",
      "allowFrom": ["+1234567890"]
    }
  }
}
```

Then send: `!claw What time is it?`

## Troubleshooting

### "Database access denied"

**Solution:** Grant Full Disk Access (Step 3 above)

### "Messages.app is not running"

**Solution:** Open Messages.app and sign in to iMessage

### "Plugin not loading"

Check if plugin is installed:
```bash
openclaw plugins list
```

Should show: `imessage-monterey`

### "Messages not being detected"

1. Check the helper can access the database (requires Full Disk Access on IMessageHelper.app):
```bash
~/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper check
```

2. Check OpenClaw logs:
```bash
openclaw gateway logs
```

3. Verify config is correct:
```bash
openclaw doctor
```

## Common Commands

### Check Plugin Status
```bash
openclaw doctor
```

### View Gateway Logs
```bash
openclaw gateway logs
```

### Restart Gateway
```bash
openclaw gateway restart
```

### List Plugins
```bash
openclaw plugins list
```

## Admin Commands

The following admin commands can be sent to the bot:

### `/reset` - Clear conversation history

Send `/reset` to start a fresh conversation. This clears:
- Session context (conversation history)
- Processed message IDs
- Session preferences

**Example:** 
```
/reset
```

The bot will confirm the reset was successful.

## Model Compatibility

All OpenClaw models work with this plugin, including:
- Standard chat models (GLM-5, Kimi, etc.)
- Reasoning models

No special configuration needed.

## Security Best Practices

1. **Use allowlist** - Don't use `dmPolicy: "open"` unless necessary
2. **Add prefix** - Use `prefix: "!claw"` to prevent accidental triggers
3. **Limit group access** - Use `groupAllowFrom` to restrict group chat access
4. **Monitor logs** - Regularly check logs for unexpected activity

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check [config.example.json](config.example.json) for all options
- Review [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for architecture details

## Getting Help

If you encounter issues:

1. Check [Troubleshooting](#troubleshooting) above
2. Review the logs: `openclaw gateway logs`
3. Run doctor: `openclaw doctor`
4. Check the README for detailed documentation

---

**You're all set!** Send an iMessage and OpenClaw should respond. 🦞

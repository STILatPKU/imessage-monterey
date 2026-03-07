# Quick Start Guide - iMessage Monterey Plugin

Get iMessage working with OpenClaw on macOS 12 in 5 minutes.

## Prerequisites

- macOS 12 Monterey or later
- Messages.app signed in with iMessage
- Node.js 18+ installed

## Quick Start

### Step 1: Run Installer

```bash
git clone https://github.com/STILatPKU/imessage-monterey.git
cd imessage-monterey
./install.sh install
```

The installer will:
- Check your macOS version
- Check Messages.app (offer to open if not running)
- Prompt for **Automation permission** (needed to send messages)
- Build and install the helper app
- Prompt for **Full Disk Access** (needed to read database)
- Build and deploy the plugin
- Verify configuration

### Step 2: Grant Permissions When Prompted

During install, you'll be prompted for TWO permissions:

**a) Automation Permission**
- When: After "Checking Automation permission..."
- Where: System Preferences → Privacy → Automation
- What: Enable "Messages" for Terminal

**b) Full Disk Access**
- When: After "Testing helper..."
- Where: System Preferences → Privacy → Full Disk Access
- What: Add `~/Applications/IMessageHelper.app`

The installer will pause and wait for you to grant each permission.

### Step 3: Configure OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["imessage-monterey"]
  },
  "channels": {
    "imessage-monterey": {
      "enabled": true,
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "allowFrom": ["+YOUR_PHONE"],
      "adminList": ["+YOUR_PHONE"]
    }
  }
}
```

The installer will verify this config and pause if it's incomplete.

### Step 4: Restart Gateway

```bash
openclaw gateway restart
```

### Step 5: Test

Send a message from your phone to test!

## Configuration Options

### Minimal (Open to everyone)

```json
{
  "plugins": {
    "allow": ["imessage-monterey"]
  },
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
  "plugins": {
    "allow": ["imessage-monterey"]
  },
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
  "plugins": {
    "allow": ["imessage-monterey"]
  },
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

**Solution:** Grant Full Disk Access (Step 2b above)

### "Not authorized to send Apple events" or "-1743"

**Solution:** Grant Automation permission (Step 2a above)

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

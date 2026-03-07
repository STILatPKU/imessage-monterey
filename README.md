# iMessage Monterey Channel Plugin

A native OpenClaw channel plugin for iMessage on macOS 12 Monterey.

> [!WARNING]
> **This project is built by OpenClaw agent WITHOUT human review**.
>
> It currently works on macOS 12.7.6. Use at one's own risk.

## Capabilities

| Feature | Supported |
|---------|-----------|
| Direct Messages (DMs) | ✅ |
| Group Chats | ✅ (fixed in v1.0.3) |
| iMessages | ✅ |
| SMS/MMS | ❌ (requires SIM card) |
| Media Attachments | ❌ |
| Reactions | ❌ |
| Reply/Thread | ❌ |

**Note:** This plugin only supports iMessages (Apple's messaging service). SMS/MMS messages require a cellular connection and SIM card, which macOS does not have.

## Why This Plugin?

macOS 12 Monterey doesn't have the `imsg` CLI tool (requires macOS 14+). This plugin enables iMessage support by:
- Polling the Messages database directly
- Using AppleScript for sending messages
- Providing admin slash commands for gateway control

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   iMessage  │────▶│  Messages DB     │────▶│  Swift Helper   │
│   (Phone)   │     │  (chat.db)       │     │  (IMessageHelper│
└─────────────┘     └──────────────────┘     │   .app)         │
                                              └────────┬────────┘
                                                       │ spawnSync()
                                              ┌────────▼────────┐
                                              │  TypeScript     │
                                              │  Plugin         │
                                              │  (channel.ts)   │
                                              └────────┬────────┘
                                                       │ HTTP API
                                              ┌────────▼────────┐
                                              │  OpenClaw       │
                                              │  Gateway        │
                                              └────────┬────────┘
                                                       │ AI Response
                                              ┌────────▼────────┐
                                              │  AppleScript    │
                                              │  (Messages.app) │
                                              └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │   iMessage      │
                                              │   (Phone)       │
                                              └─────────────────┘
```

## Components

### 1. Swift Helper (`~/Applications/IMessageHelper.app`)

A compiled Swift app that reads the Messages database. Requires **Full Disk Access**.

**Commands:**
```bash
# Check database access
~/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper check

# Query recent messages
~/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper query --limit 10

# Get max ROWID
~/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper maxrowid
```

### 2. TypeScript Plugin (`~/.openclaw/extensions/imessage-monterey/`)

The OpenClaw channel plugin that:
- Polls for new messages every 10 seconds
- Filters out messages sent by the computer (`is_from_me = 1`)
- Delivers to gateway via HTTP API
- Sends responses via AppleScript

## Installation

### Prerequisites
- macOS 12 Monterey
- OpenClaw installed
- Full Disk Access for IMessageHelper.app

### Steps

1. **Build the Swift Helper:**
```bash
cd ~/.openclaw/workspace/imessage-monterey/helper
swiftc -o imessage-helper Sources/main.swift -O -framework Cocoa -lsqlite3
```

2. **Install Helper App:**
```bash
mkdir -p ~/Applications/IMessageHelper.app/Contents/MacOS
cp imessage-helper ~/Applications/IMessageHelper.app/Contents/MacOS/
```

3. **Grant Full Disk Access:**
   - System Preferences → Privacy → Full Disk Access
   - Add `~/Applications/IMessageHelper.app`

4. **Build Plugin:**
```bash
cd ~/.openclaw/workspace/imessage-monterey
npm install
npm run build
```

5. **Deploy to OpenClaw:**
```bash
cp -r dist/* ~/.openclaw/extensions/imessage-monterey/dist/
cp index.ts ~/.openclaw/extensions/imessage-monterey/
```

6. **Configure:**
```json
// ~/.openclaw/openclaw.json
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
```

7. **Restart Gateway:**
```bash
openclaw gateway restart
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable channel |
| `dmPolicy` | string | "pairing" | DM access policy: open, pairing, allowlist, disabled |
| `groupPolicy` | string | "allowlist" | Group access policy |
| `allowFrom` | string[] | [] | Allowed phone numbers for DMs |
| `groupAllowFrom` | string[] | [] | Allowed numbers for groups |
| `adminList` | string[] | [] | Admin numbers (slash command access) |
| `prefix` | string | "" | Required message prefix |
| `pollIntervalMs` | number | 10000 | Poll interval in milliseconds |
| `textChunkLimit` | number | 4000 | Max chars per message |

## Conversation Context

The plugin maintains proper conversation context for both DMs and group chats:

- **DMs**: Session keyed by sender phone number (`agent:main:imessage-monterey:direct:{senderId}`)
- **Groups**: Session keyed by chat GUID (`agent:main:imessage-monterey:group:{chatGuid}`)

## Admin Slash Commands

Send these commands from an admin number:

### Core Commands
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/status` | Gateway status |
| `/agent [id]` | List/switch agents |
| `/session [key]` | List sessions |
| `/model [name]` | List/set model |

### Session Controls
| Command | Description |
|---------|-------------|
| `/think <level>` | Set thinking: off, minimal, low, medium, high |
| `/verbose <mode>` | Set verbose: on, full, off |
| `/reasoning <mode>` | Set reasoning: on, off, stream |
| `/usage <mode>` | Set usage display: off, tokens, full |
| `/elevated <mode>` | Set elevated: on, off, ask, full |

### Gateway Management
| Command | Description |
|---------|-------------|
| `/channels` | List all channels |
| `/restart` | Restart gateway |
| `/logs [n]` | Show last n log lines |
| `/config get/set` | Manage configuration |
| `/allowlist add/remove/list` | Manage allowlist |
| `/reset` | Reset conversation context (clears history, processed IDs, preferences) |
| `/abort` | Abort active run |
| `/version` | Show OpenClaw version |

## Troubleshooting

### Database Access Denied
```
Error: SQLITE_AUTH (23) - authorization denied
```
**Solution:** Grant Full Disk Access to IMessageHelper.app in System Preferences.

### Messages Not Being Detected
1. Check provider is running: `openclaw status`
2. Check logs: `/logs 20` or `tail -f /tmp/openclaw/openclaw-*.log`
3. Verify ROWID is advancing: `~/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper maxrowid`

### Infinite Loop (Bot Responding to Itself)
This is prevented by the `is_from_me = 1` filter in provider.ts. If this happens:
1. Check logs for "Skipping message sent by me"
2. Verify the filter is working

### AppleScript Errors
Special characters (quotes, newlines, etc.) can break AppleScript. The plugin uses a temp file approach to handle this.

## Limitations

### Media Sending Not Supported

Media attachments (images, videos, files) cannot be sent via this plugin. This is a limitation of macOS 12 Monterey:

- Messages.app AppleScript dictionary does not expose attachment sending
- GUI automation would be required (unreliable, requires Accessibility permissions)

**Workaround:** For media sharing, use the Messages app directly.

## File Locations

| Component | Path |
|-----------|------|
| Plugin source | `~/.openclaw/workspace/imessage-monterey/` |
| Installed plugin | `~/.openclaw/extensions/imessage-monterey/` |
| Swift helper | `~/Applications/IMessageHelper.app` |
| Session preferences | `~/.openclaw/imessage-monterey-prefs.json` |
| Processed IDs cache | `~/.openclaw/imessage-monterey-{accountId}.processed` (accountId is "default" or custom) |

## Development

### Rebuild Swift Helper
```bash
cd ~/.openclaw/workspace/imessage-monterey/helper
swiftc -o imessage-helper Sources/main.swift -O -framework Cocoa -lsqlite3
cp imessage-helper ~/Applications/IMessageHelper.app/Contents/MacOS/
```

### Rebuild TypeScript Plugin
```bash
cd ~/.openclaw/workspace/imessage-monterey
npm run build
cp -r dist/* ~/.openclaw/extensions/imessage-monterey/dist/
openclaw gateway restart
```

## License

MIT

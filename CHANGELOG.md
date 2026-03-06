# Changelog

All notable changes to the iMessage Monterey plugin.

## [1.0.0] - 2026-02-21

### Added
- Initial release
- Swift helper app for Messages database access
- TypeScript channel plugin for OpenClaw
- Database polling (10 second interval)
- HTTP API delivery to gateway
- AppleScript-based message sending
- Admin slash commands (TUI-compatible)
- Session preferences persistence
- Full Disk Access support

### Security
- `is_from_me = 1` filter prevents infinite loop
- DM vs Group detection via chat GUID format
- Admin-only slash command execution

### Fixed
- AppleScript escaping using temp file approach
- isGroup detection (DMs have `-;` in GUID, not just `;`)
- Shell escaping issues with special characters

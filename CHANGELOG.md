# Changelog

All notable changes to the iMessage Monterey plugin.

## [1.0.2] - 2026-03-07

### Changed
- Removed `mediaMaxMb` and `includeAttachments` from configSchema (media not supported on macOS 12)
- Added `adminList` to configSchema for admin command authorization

### Fixed
- `chunkText()` now properly enforces character limit using `forceSplitChunk()`
- Simplified tool call handling by removing unnecessary iteration loop

## [1.0.1] - 2026-03-07

### Fixed
- Use gateway sessions.reset API for proper /reset command behavior
- Add conversation context and tool_calls handling for proper message tracking

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

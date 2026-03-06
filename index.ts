/**
 * iMessage Monterey Channel Plugin
 * 
 * Entry point for the plugin.
 * 
 * This plugin provides iMessage support for macOS 12 Monterey
 * using direct database polling instead of the imsg CLI
 * (which requires macOS 14 Sonoma).
 * 
 * Features:
 * - Direct SQLite database polling
 * - AppleScript-based message sending
 * - Group chat support
 * - Security policies (allowlist, pairing)
 * - Message chunking
 * 
 * Requirements:
 * - macOS 12 Monterey or later
 * - Messages.app signed in
 * - Full Disk Access permission (for database access)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { imessageMontereyPlugin } from "./src/channel.js";

const plugin = {
  id: "imessage-monterey",
  name: "iMessage (macOS 12 Monterey)",
  description: "iMessage channel for macOS 12 Monterey using direct database polling",
  
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pollIntervalMs: {
        type: "number",
        description: "Database polling interval in milliseconds",
        default: 10000,
      },
      dbPath: {
        type: "string",
        description: "Path to Messages database (chat.db)",
      },
      prefix: {
        type: "string",
        description: "Command prefix (e.g., '!claw')",
        default: "",
      },
      requirePrefixForAllowlist: {
        type: "boolean",
        description: "Whether allowlisted senders need to use prefix",
        default: false,
      },
      dmPolicy: {
        type: "string",
        enum: ["open", "pairing", "allowlist", "disabled"],
        description: "Direct message policy",
        default: "open",
      },
      allowFrom: {
        type: "array",
        items: { type: "string" },
        description: "Allowed senders for DMs",
        default: [],
      },
      groupPolicy: {
        type: "string",
        enum: ["open", "allowlist", "disabled"],
        description: "Group message policy",
        default: "allowlist",
      },
      groupAllowFrom: {
        type: "array",
        items: { type: "string" },
        description: "Allowed senders in groups",
        default: [],
      },
      textChunkLimit: {
        type: "number",
        description: "Maximum characters per message chunk",
        default: 4000,
      },
      mediaMaxMb: {
        type: "number",
        description: "Maximum media file size in MB",
        default: 16,
      },
      includeAttachments: {
        type: "boolean",
        description: "Include message attachments",
        default: true,
      },
    },
  },
  
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: imessageMontereyPlugin });
    
    api.logger?.info("iMessage Monterey channel plugin registered");
  },
};

export default plugin;

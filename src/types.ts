/**
 * Types for iMessage Monterey channel plugin
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

/**
 * Raw message from Messages database
 */
export interface RawMessage {
  rowid: number;
  text: string | null;
  handle_id: number | null;
  handle: string | null;
  service: string | null;
  account: string | null;
  date: number;
  is_from_me: number;
  is_read: number;
  chat_id: number | null;
  chat_guid: string | null;
  guid: string;
  associated_message_type: number | null;
  associated_message_guid: string | null;
}

/**
 * Normalized inbound message
 */
export interface InboundMessage {
  id: string;
  rowid: number;
  text: string;
  senderId: string;
  senderName?: string;
  chatId?: string;
  chatGuid?: string;
  isGroup: boolean;
  timestamp: number;
  service: "iMessage" | "SMS";
  attachments: Attachment[];
}

/**
 * Attachment from message
 */
export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Outbound message to send
 */
export interface OutboundMessage {
  to: string;
  text: string;
  mediaUrl?: string;
  replyToGuid?: string;
  chatGuid?: string;
}

/**
 * Account configuration for iMessage Monterey
 */
export interface IMessageMontereyAccountConfig {
  enabled?: boolean;
  name?: string;
  dbPath?: string;
  prefix?: string;
  pollIntervalMs?: number;
  requirePrefixForAllowlist?: boolean;
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: string[];
  textChunkLimit?: number;
  adminList?: string[];  // List of admin phone numbers who can use slash commands
}

/**
 * Resolved account with all config merged
 */
export interface ResolvedIMessageMontereyAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  config: Required<IMessageMontereyAccountConfig>;
}

/**
 * Runtime state for an account
 */
export interface AccountRuntimeState {
  accountId: string;
  running: boolean;
  lastPollAt: number | null;
  lastMessageAt: number | null;
  lastError: string | null;
  processedCount: number;
  dbPath: string | null;
}

/**
 * Provider context passed to the provider
 */
export interface ProviderContext {
  cfg: OpenClawConfig;
  accountId: string;
  account: ResolvedIMessageMontereyAccount;
  abortSignal: AbortSignal;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  deliverInbound: (msg: InboundMessage) => Promise<void>;
}

/**
 * Send result from AppleScript
 */
export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Database query result for handle info
 */
export interface HandleInfo {
  id: string;
  service: string;
  country?: string;
  uncanonicalizedId?: string;
}

/**
 * Chat/Conversation info
 */
export interface ChatInfo {
  chatId: number;
  guid: string;
  chatIdentifier: string;
  displayName: string | null;
  service: string;
  isGroup: boolean;
  participantCount: number;
}

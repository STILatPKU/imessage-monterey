/**
 * Messages database access for macOS 12 Monterey
 * 
 * Uses a Swift helper app with proper entitlements to access the Messages database.
 * The helper is spawned as a subprocess and returns JSON.
 */

import { spawnSync } from "child_process";
import type { RawMessage, InboundMessage } from "./types.js";

const DEFAULT_DB_PATH = () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return `${home}/Library/Messages/chat.db`;
};

// Path to the helper binary
const HELPER_PATH = () => {
  const paths = [
    process.env.IMESSAGE_HELPER_PATH,
    `${process.env.HOME}/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper`,
    `/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper`,
  ];
  for (const p of paths) {
    if (p) return p;
  }
  return `${process.env.HOME}/Applications/IMessageHelper.app/Contents/MacOS/imessage-helper`;
};

/**
 * Run the helper and get JSON result
 */
function runHelper(command: string, args: string[] = []): any {
  const helperPath = HELPER_PATH();
  
  try {
    const result = spawnSync(helperPath, [command, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024,
    });
    
    if (result.error) {
      throw result.error;
    }
    
    if (result.status !== 0) {
      throw new Error(`Helper exited with code ${result.status}: ${result.stderr}`);
    }
    
    const output = result.stdout.trim();
    if (!output) {
      throw new Error("Helper returned empty output");
    }
    
    return JSON.parse(output);
  } catch (error: any) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Check database access
 */
export function checkDatabaseAccess(dbPath?: string): { ok: boolean; error?: string; path: string } {
  const path = dbPath || DEFAULT_DB_PATH();
  const result = runHelper("check");
  
  if (result.ok) {
    return { ok: true, path: result.path || path };
  } else {
    return { ok: false, error: result.error || "Unknown error", path };
  }
}

// Dummy database type for API compatibility
type DummyDB = any;

/**
 * Query recent messages from the database
 */
export function queryRecentMessages(
  _db: DummyDB,
  lastRowid: number = 0,
  limit: number = 100
): RawMessage[] {
  const result = runHelper("query", ["--since", String(lastRowid), "--limit", String(limit)]);
  
  if (!result.ok || !result.messages) {
    return [];
  }
  
  return result.messages.map((msg: any): RawMessage => ({
    rowid: msg.rowid,
    text: msg.text,
    handle_id: msg.handle_id,
    handle: msg.handle,
    service: msg.service,
    account: msg.account,
    date: msg.date,
    is_from_me: msg.is_from_me,
    is_read: msg.is_read,
    chat_id: msg.chat_id,
    chat_guid: msg.chat_guid,
    guid: msg.guid || `msg-${msg.rowid}`,
    associated_message_type: null,
    associated_message_guid: null,
  }));
}

// Note: getMessageAttachments, getHandleInfo, getChatInfo removed
// These functions were not implemented and not used anywhere in the codebase.
// If needed in the future, they should be properly implemented with Swift helper support.
/**
 * Get max ROWID from messages table
 */
export function getMaxRowid(_db: DummyDB): number {
  const result = runHelper("maxrowid");
  return result.ok && typeof result.maxRowid === "number" ? result.maxRowid : 0;
}

/**
 * Normalize phone/email handle for comparison
 */
export function normalizeHandle(handle: string): string {
  let h = handle.toLowerCase().trim();
  if (h.startsWith("mailto:")) h = h.slice(7);
  if (h.startsWith("tel:")) h = h.slice(4);
  if (h.startsWith("+")) h = h.slice(1);
  return h;
}

/**
 * Get service type from service name
 */
export function getServiceType(service: string | null): "iMessage" | "SMS" {
  if (!service) return "iMessage";
  const s = service.toLowerCase();
  return s.includes("sms") || s.includes("gsm") ? "SMS" : "iMessage";
}

/**
 * Convert Cocoa timestamp to Unix timestamp (milliseconds)
 */
export function cocoaToUnixTimestamp(cocoa: number): number {
  const unixSeconds = Math.floor(cocoa / 1_000_000_000) + 978307200;
  return unixSeconds * 1000;
}

/**
 * Convert raw message to inbound message
 */
export function toInboundMessage(raw: RawMessage): InboundMessage {
  // Detect group chat: DM GUIDs have format "iMessage;-;+phone" (with dash)
  // Group GUIDs have format "iMessage;+phone1;+phone2;..." (no dash, multiple participants)
  const chatGuid = raw.chat_guid || "";
  const isGroup = Boolean(
    chatGuid && 
    chatGuid.includes(";") && 
    !chatGuid.includes(";-;")  // DM format has "-;" 
  );
  
  return {
    id: raw.guid || `rowid-${raw.rowid}`,
    rowid: raw.rowid,
    text: raw.text || "",
    senderId: normalizeHandle(raw.handle || ""),
    chatId: raw.chat_id?.toString(),
    chatGuid: chatGuid || undefined,
    isGroup,
    timestamp: cocoaToUnixTimestamp(raw.date),
    service: getServiceType(raw.service),
    attachments: [],
  };
}

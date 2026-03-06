/**
 * AppleScript-based message sending for iMessage
 * 
 * Uses osascript to control Messages.app for sending messages.
 * This is the only reliable method on macOS 12 Monterey.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { SendResult } from "./types.js";

const execAsync = promisify(exec);

/**
 * Escape text for AppleScript string
 * Handles newlines, quotes, and backslashes
 */
function escapeAppleScriptString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Send a text message via AppleScript
 * Uses temp file to avoid shell escaping issues
 */
export async function sendTextMessage(
  recipient: string,
  text: string,
  chatGuid: string | null = null
): Promise<SendResult> {
  const escapedText = escapeAppleScriptString(text);
  const escapedRecipient = escapeAppleScriptString(recipient);
  
  // Build AppleScript - use buddy approach which is more reliable
  const script = `
      tell application "Messages"
        try
          set targetService to 1st service whose service type = iMessage
          set targetBuddy to buddy "${escapedRecipient}" of targetService
          send "${escapedText}" to targetBuddy
          return "ok"
        on error errMsg
          return "error: " & errMsg
        end try
      end tell
    `;
  
  // Write to temp file to avoid shell escaping issues
  const tmpDir = tmpdir();
  const scriptPath = join(tmpDir, `imessage-script-${Date.now()}.scpt`);
  
  try {
    writeFileSync(scriptPath, script, "utf8");
    
    const { stdout, stderr } = await execAsync(`osascript "${scriptPath}"`, {
      timeout: 30000,
    });
    
    if (stderr) {
      return {
        ok: false,
        error: stderr.trim(),
      };
    }
    
    const result = stdout.trim();
    
    if (result.startsWith("error:")) {
      return {
        ok: false,
        error: result.slice(6).trim(),
      };
    }
    
    return { ok: true };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message || String(error),
    };
  } finally {
    // Clean up temp file
    try {
      unlinkSync(scriptPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Send a message with an attachment via AppleScript
 * 
 * NOT SUPPORTED: Messages.app AppleScript dictionary does NOT expose any 
 * command for sending attachments. The 'send' command only accepts text strings.
 * 
 * Alternative approaches that could work (but are unreliable):
 * 1. GUI Automation via System Events - requires Accessibility permissions, fragile
 * 2. Shortcuts app - requires user to set up a Shortcut, then call via AppleScript
 * 3. Drag-and-drop to Messages window - not automatable
 * 
 * For now, media sending is disabled. Users wanting media support should use
 * a different method or a macOS version with proper API support.
 */
export async function sendMediaMessage(
  recipient: string,
  text: string,
  mediaPath: string,
  chatGuid: string | null = null
): Promise<SendResult> {
  return {
    ok: false,
    error: "Media sending is not supported via AppleScript on macOS Monterey. Messages.app does not expose attachment sending in its AppleScript dictionary.",
  };
}

/**
 * Check if Messages.app is running and signed in
 */
export async function checkMessagesApp(): Promise<{
  running: boolean;
  signedIn: boolean;
  error?: string;
}> {
  const script = `
    tell application "System Events"
      set isRunning to (name of processes) contains "Messages"
    end tell
    
    if isRunning then
      tell application "Messages"
        try
          set serviceList to services
          if (count of serviceList) > 0 then
            return "signed_in"
          else
            return "not_signed_in"
          end if
        on error
          return "error_checking"
        end try
      end tell
    else
      return "not_running"
    end if
  `;
  
  try {
    const { stdout } = await execAsync(`osascript -e '${script}'`, {
      timeout: 10000,
    });
    
    const result = stdout.trim();
    
    switch (result) {
      case "signed_in":
        return { running: true, signedIn: true };
      case "not_signed_in":
        return { running: true, signedIn: false };
      case "not_running":
        return { running: false, signedIn: false };
      default:
        return {
          running: false,
          signedIn: false,
          error: result,
        };
    }
  } catch (error: any) {
    return {
      running: false,
      signedIn: false,
      error: error.message,
    };
  }
}

/**
 * Force-split a chunk that exceeds the limit
 * Tries word boundaries first, then falls back to character split
 */
function forceSplitChunk(chunk: string, limit: number): string[] {
  const result: string[] = [];
  let remaining = chunk;
  
  while (remaining.length > limit) {
    // Try to find a word boundary near the limit
    let splitPos = limit;
    
    // Look backwards for a space (word boundary)
    const spacePos = remaining.lastIndexOf(' ', limit);
    if (spacePos > limit * 0.5) {
      // Only use word boundary if it's not too far back (preserve at least half the limit)
      splitPos = spacePos;
    }
    
    result.push(remaining.slice(0, splitPos).trim());
    remaining = remaining.slice(splitPos).trim();
  }
  
  if (remaining.length > 0) {
    result.push(remaining);
  }
  
  return result;
}

/**
 * Chunk text for iMessage sending
 * Splits at paragraph boundaries (blank lines) or forced chunks
 */
export function chunkText(
  text: string,
  limit: number = 4000
): string[] {
  if (text.length <= limit) {
    return [text];
  }
  
  // Try to split at paragraph boundaries first
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;
    
    // If adding this paragraph would exceed limit
    if (currentChunk.length + trimmedPara.length + 2 > limit) {
      // Save current chunk if not empty
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      
      // If single paragraph exceeds limit, force split
      if (trimmedPara.length > limit) {
        // Split at sentence boundaries if possible
        const sentences = trimmedPara.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length + 1 > limit) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
          } else {
            currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
          }
        }
      } else {
        currentChunk = trimmedPara;
      }
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + trimmedPara : trimmedPara;
    }
  }
  
  // Add remaining chunk
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  // FINAL SAFEGUARD: Force-split any chunks that still exceed the limit
  // This handles cases where a single sentence has no punctuation,
  // or any edge case that slipped through
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > limit) {
      finalChunks.push(...forceSplitChunk(chunk, limit));
    } else {
      finalChunks.push(chunk);
    }
  }
  
  return finalChunks.length > 0 ? finalChunks : [text.slice(0, limit)];
}

/**
 * Send a message with automatic chunking
 */
export async function sendChunkedMessage(
  recipient: string,
  text: string,
  options: {
    chunkLimit?: number;
    delayMs?: number;
    chatGuid?: string | null;
  } = {}
): Promise<SendResult> {
  const chunkLimit = options.chunkLimit ?? 4000;
  const delayMs = options.delayMs ?? 500;
  const chatGuid: string | null = options.chatGuid ?? null;
  
  const chunks = chunkText(text, chunkLimit);
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    const result = await sendTextMessage(recipient, chunk, chatGuid);
    
    if (!result.ok) {
      return result;
    }
    
    // Delay between chunks (except for last one)
    if (i < chunks.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  
  return { ok: true };
}

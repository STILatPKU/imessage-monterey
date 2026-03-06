/**
 * iMessage Monterey Provider
 * 
 * Handles database polling and message delivery to the Gateway.
 * Uses Swift helper for database access, HTTP API for message delivery.
 */

import { spawnSync } from "child_process";
import http from "http";
import {
  queryRecentMessages,
  getMaxRowid,
  toInboundMessage,
  checkDatabaseAccess,
  normalizeHandle,
} from "./db.js";
import {
  sendChunkedMessage,
  sendMediaMessage,
  checkMessagesApp,
} from "./applescript.js";
import {
  executeAdminCommand,
  isAdmin as checkIsAdmin,
} from "./admin-commands.js";
import type {
  ResolvedIMessageMontereyAccount,
  AccountRuntimeState,
  InboundMessage,
  OutboundMessage,
} from "./types.js";

/**
 * Tool call structure from OpenAI-compatible API
 */
interface ToolCallFunction {
  name: string;
  arguments: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: ToolCallFunction;
}

/**
 * Tool result structure
 */
interface ToolResult {
  status: string;
  tool: string;
  message: string;
  error?: string;
}

/**
 * Chat message structure for multi-turn conversations
 */
interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Gateway response structure
 */
interface GatewayResponse {
  id?: string;
  object?: string;
  choices?: Array<{
    index: number;
    message?: {
      role?: string;
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// Gateway API configuration
const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "127.0.0.1";
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || "18789", 10);
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

/**
 * Provider context passed from the channel adapter
 */
export interface ProviderContext {
  cfg: any;
  accountId: string;
  account: ResolvedIMessageMontereyAccount;
  abortSignal: AbortSignal;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  runtime?: any;
}

/**
 * Track processed message IDs to avoid duplicates
 */
class ProcessedIdTracker {
  private ids: Set<number> = new Set();
  private filePath: string;
  private dirty = false;
  
  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }
  
  private load() {
    try {
      const fs = require("fs");
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.ids = new Set(parsed);
        }
      }
    } catch {
      // Ignore errors
    }
  }
  
  has(id: number): boolean {
    return this.ids.has(id);
  }
  
  add(id: number) {
    this.ids.add(id);
    this.dirty = true;
  }
  
  flush() {
    if (!this.dirty) return;
    try {
      const fs = require("fs");
      const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(Array.from(this.ids).slice(-1000))
      );
      this.dirty = false;
    } catch {
      // Ignore errors
    }
  }
}

/**
 * iMessage Monterey Provider
 */
export class IMessageMontereyProvider {
  private pollTimer: NodeJS.Timeout | null = null;
  private lastRowid: number = 0;
  private processedIds: ProcessedIdTracker;
  private state: AccountRuntimeState;
  private context: ProviderContext;
  
  constructor(context: ProviderContext) {
    this.context = context;
    this.processedIds = new ProcessedIdTracker(
      `${process.env.HOME}/.openclaw/imessage-monterey-${context.accountId}.processed`
    );
    this.state = {
      accountId: context.accountId,
      running: false,
      lastPollAt: null,
      lastMessageAt: null,
      lastError: null,
      processedCount: 0,
      dbPath: context.account.config.dbPath || null,
    };
  }
  
  /**
   * Start the provider
   */
  async start(): Promise<void> {
    const { log, account } = this.context;
    
    // Validate gateway token is configured
    if (!GATEWAY_TOKEN) {
      throw new Error(
        "OPENCLAW_GATEWAY_TOKEN environment variable is required. " +
        "Please set it in your environment or .env file. " +
        "See .env.example for configuration guidance."
      );
    }
    
    // Check database access via helper
    const dbCheck = checkDatabaseAccess(account.config.dbPath);
    if (!dbCheck.ok) {
      log.error(`Database access failed: ${dbCheck.error}`);
      this.state.lastError = dbCheck.error || "Database access failed";
      throw new Error(`Cannot access Messages database: ${dbCheck.error}`);
    }
    
    log.info(`Database accessible at: ${dbCheck.path}`);
    this.state.dbPath = dbCheck.path || null;
    
    // Initialize lastRowid
    this.lastRowid = getMaxRowid(null);
    log.info(`Starting from ROWID: ${this.lastRowid}`);
    
    // Check Messages.app status
    const appStatus = await checkMessagesApp();
    if (!appStatus.running) {
      log.warn("Messages.app is not running. Messages may not be delivered.");
    } else if (!appStatus.signedIn) {
      log.warn("Messages.app is not signed in. Sending may fail.");
    }
    
    this.state.running = true;
    
    // Start polling
    this.schedulePoll();
    
    log.info(`Provider started (poll interval: ${account.config.pollIntervalMs}ms)`);
  }
  
  /**
   * Stop the provider
   */
  async stop(): Promise<void> {
    const { log } = this.context;
    
    this.state.running = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    
    this.processedIds.flush();
    
    log.info("Provider stopped");
  }
  
  /**
   * Schedule the next poll
   */
  private schedulePoll(): void {
    if (!this.state.running) return;
    
    const { pollIntervalMs } = this.context.account.config;
    
    this.pollTimer = setTimeout(() => {
      this.poll().catch((error) => {
        this.context.log.error(`Poll error: ${error.message}`);
        this.state.lastError = error.message;
      });
    }, pollIntervalMs);
  }
  
  /**
   * Poll for new messages
   */
  private async poll(): Promise<void> {
    if (!this.state.running) return;
    
    const { log, account } = this.context;
    
    this.state.lastPollAt = Date.now();
    
    try {
      // Query for new messages via helper
      const messageLimit = parseInt(process.env.IMESSAGE_POLL_LIMIT || "100", 10);
      const messages = queryRecentMessages(null, this.lastRowid, messageLimit);
      
      if (messages.length === 0) {
        this.schedulePoll();
        return;
      }
      
      log.debug(`Found ${messages.length} new messages`);
      
      // Process each message
      for (const raw of messages) {
        // Update lastRowid
        if (raw.rowid > this.lastRowid) {
          this.lastRowid = raw.rowid;
        }
        
        // Skip already processed
        if (this.processedIds.has(raw.rowid)) {
          continue;
        }
        
        // Mark as processed
        this.processedIds.add(raw.rowid);
        this.state.processedCount++;
        
        // CRITICAL: Skip messages sent by this computer (prevents infinite loop)
        if (raw.is_from_me === 1) {
          log.debug(`Skipping message sent by me: rowid=${raw.rowid}`);
          continue;
        }
        
        // Convert to inbound message
        const inbound = toInboundMessage(raw);
        
        // Check security
        if (!this.isMessageAllowed(inbound)) {
          log.debug(`Message blocked: sender=${inbound.senderId}, group=${inbound.isGroup}`);
          continue;
        }
        
        // Check for admin commands (slash commands)
        const adminResult = executeAdminCommand(
          inbound.text,
          inbound.senderId,
          this.getAdminList()
        );
        
        if (adminResult) {
          // This was an admin command - send response and skip normal processing
          this.state.lastMessageAt = Date.now();
          log.info(`Admin command from ${inbound.senderId}: ${inbound.text.slice(0, 50)}`);
          
          try {
            await sendChunkedMessage(inbound.senderId, adminResult.response, {
              chatGuid: inbound.chatGuid,
            });
            log.debug(`Admin command response sent to ${inbound.senderId}`);
          } catch (error: any) {
            log.error(`Failed to send admin response: ${error.message}`);
          }
          continue;
        }
        
        // Check prefix requirement
        const processedText = this.extractCommand(inbound);
        if (processedText === null) {
          log.debug(`Message ignored (no/incorrect prefix): ${inbound.text.slice(0, 50)}`);
          continue;
        }
        
        // Update text with processed version
        inbound.text = processedText;
        
        // Deliver to gateway via HTTP API
        this.state.lastMessageAt = Date.now();
        
        try {
          await this.deliverViaHttp(inbound);
          log.info(`Delivered message from ${inbound.senderId}`);
        } catch (error: any) {
          log.error(`Failed to deliver message: ${error.message}`);
        }
      }
      
      // Flush processed IDs periodically
      this.processedIds.flush();
      
    } catch (error: any) {
      log.error(`Poll error: ${error.message}`);
      this.state.lastError = error.message;
    }
    
    // Schedule next poll
    this.schedulePoll();
  }
  
  /**
   * Build a properly formatted session key for OpenClaw
   * Format: agent:{agentId}:{channel}:{chatType}:{peerId}
   * - DM: agent:main:imessage-monterey:direct:{senderId}
   * - Group: agent:main:imessage-monterey:group:{chatGuid}
   */
  private buildSessionKey(msg: InboundMessage): string {
    const agentId = process.env.OPENCLAW_AGENT_ID || "main";
    const channel = "imessage-monterey";
    const chatType = msg.isGroup ? "group" : "direct";
    // For groups, use chatGuid; for DMs, use senderId
    const peerId = msg.isGroup ? msg.chatGuid : msg.senderId;
    return `agent:${agentId}:${channel}:${chatType}:${peerId}`;
  }
  
  /**
   * Deliver message to gateway via HTTP API (like iMessageBridge does)
   * Handles tool_calls by continuing the conversation with tool results
   */
  private async deliverViaHttp(msg: InboundMessage): Promise<void> {
    const model = process.env.OPENCLAW_MODEL || "zai/glm-5";
    const agentId = process.env.OPENCLAW_AGENT_ID || "main";
    
    // Build proper session key with conversation context
    const sessionKey = this.buildSessionKey(msg);
    
    // Build initial conversation with user message
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: msg.text,
      }
    ];
    
    // Tool call loop - continue until we get a text response or hit max iterations
    const maxToolIterations = 10;
    let iteration = 0;
    
    while (iteration < maxToolIterations) {
      iteration++;
      
      const payload = {
        model,
        messages,
        stream: false,
      };
      
      try {
        const response = await this.sendGatewayRequest(payload, agentId, sessionKey);
        
        // Check if we got a text response
        if (response.choices?.[0]?.message?.content) {
          const content = response.choices[0].message.content;
          
          // Send response via AppleScript
          const result = await sendChunkedMessage(
            msg.senderId,
            content,
            { chatGuid: msg.chatGuid }
          );
          
          if (!result.ok) {
            this.context.log.error(`Failed to send response: ${result.error}`);
          } else {
            this.context.log.debug(`Response sent to ${msg.senderId}`);
          }
          return;
        }
        
        // Check for tool calls
        if (response.choices?.[0]?.finish_reason === "tool_calls") {
          const toolCalls = response.choices?.[0]?.message?.tool_calls;
          const choice = response.choices[0];
          
          if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0 && choice) {
            this.context.log.debug(`Received ${toolCalls.length} tool calls, processing...`);
            
            // Add assistant message with tool calls to conversation
            messages.push({
              role: "assistant",
              content: choice.message?.content || "",
              tool_calls: toolCalls,
            });
            
            // Add tool results for each tool call
            // Note: We can't execute tools directly, so we provide placeholder results
            // The gateway's agent will handle actual tool execution on the next iteration
            for (const tc of toolCalls) {
              const toolResult = this.handleToolCall(tc);
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(toolResult),
              });
            }
            
            // Continue loop to get next response
            continue;
          }
        }
        
        // No content and no tool calls - log warning and exit
        this.context.log.warn(`Unexpected response format: ${JSON.stringify(response)}`);
        return;
        
      } catch (error: any) {
        this.context.log.error(`Gateway request failed: ${error.message}`);
        throw error;
      }
    }
    
    // Hit max iterations - log error
    this.context.log.error(`Tool call loop exceeded maximum iterations (${maxToolIterations})`);
  }
  
  /**
   * Send request to gateway and return parsed response
   */
  private sendGatewayRequest(payload: object, agentId: string, sessionKey: string): Promise<GatewayResponse> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      
      const req = http.request(
        {
          hostname: GATEWAY_HOST,
          port: GATEWAY_PORT,
          path: "/v1/chat/completions",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${GATEWAY_TOKEN}`,
            "x-openclaw-agent-id": agentId,
            "x-openclaw-session-key": sessionKey,
            "x-openclaw-message-channel": "imessage-monterey",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 60000, // Increased timeout for tool call iterations
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Failed to parse gateway response: ${data}`));
              }
            } else {
              reject(new Error(`Gateway returned ${res.statusCode}: ${data}`));
            }
          });
        }
      );
      
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      
      req.write(body);
      req.end();
    });
  }
  
  /**
   * Handle a tool call by returning an appropriate result
   * For client tools that the provider can't execute, we delegate back to the gateway
   */
  private handleToolCall(toolCall: ToolCall): ToolResult {
    const { log } = this.context;
    const name = toolCall.function?.name || "unknown";
    
    log.debug(`Processing tool call: ${name}`);
    
    // For most tools, we return a result that indicates the tool should be handled by the agent
    // The gateway's agent will re-process and execute the tool
    return {
      status: "delegated",
      tool: name,
      message: "Tool execution delegated to agent runtime",
    };
  }
  
  /**
   * Check if message is allowed based on security policy
   */
  private isMessageAllowed(msg: InboundMessage): boolean {
    const { account } = this.context;
    const { dmPolicy, allowFrom, groupPolicy, groupAllowFrom } = account.config;
    
    if (msg.isGroup) {
      switch (groupPolicy) {
        case "disabled":
          return false;
        case "allowlist":
          return groupAllowFrom.some((sender) => 
            normalizeHandle(sender) === msg.senderId
          );
        case "open":
        default:
          return true;
      }
    } else {
      switch (dmPolicy) {
        case "disabled":
          return false;
        case "allowlist":
          return allowFrom.some((sender) => 
            normalizeHandle(sender) === msg.senderId
          );
        case "pairing":
          // Check if in allowlist
          return allowFrom.some((sender) => 
            normalizeHandle(sender) === msg.senderId
          );
        case "open":
        default:
          return true;
      }
    }
  }
  
  /**
   * Get the list of administrators
   */
  private getAdminList(): string[] {
    // Admin list can be configured in config, otherwise defaults to allowlist
    const { account, cfg } = this.context;
    const adminList = account.config.adminList || 
      cfg.channels?.["imessage-monterey"]?.adminList ||
      account.config.allowFrom || [];
    return adminList;
  }
  
  /**
   * Extract command text, handling prefix requirement
   */
  private extractCommand(msg: InboundMessage): string | null {
    const { account } = this.context;
    const { prefix, requirePrefixForAllowlist, allowFrom, dmPolicy } = account.config;
    
    const isAllowedSender = allowFrom.some((sender) => 
      normalizeHandle(sender) === msg.senderId
    );
    
    // If sender is in allowlist and prefix not required, accept message as-is
    if (isAllowedSender && !requirePrefixForAllowlist) {
      return msg.text;
    }
    
    // If prefix is set, check for it
    if (prefix) {
      const trimmed = msg.text.trimStart();
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length).trimStart();
      }
      return null;
    }
    
    // No prefix required
    return msg.text;
  }
}

/**
 * Create outbound sender function
 */
export function createOutboundSender(
  account: ResolvedIMessageMontereyAccount,
  log: { info: (msg: string) => void; error: (msg: string) => void }
) {
  return async (msg: OutboundMessage): Promise<{ ok: boolean; error?: string; messageId?: string }> => {
    const { textChunkLimit } = account.config;
    const generateMessageId = () => `imsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    try {
      if (msg.mediaUrl) {
        // Media sending is not supported via AppleScript on Monterey
        // Messages.app doesn't expose attachment sending in its AppleScript dictionary
        log.error("Media sending is not supported on macOS Monterey");
        return { 
          ok: false, 
          error: "Media sending is not supported on macOS Monterey. Use text messages instead." 
        };
      } else {
        const result = await sendChunkedMessage(msg.to, msg.text, {
          chunkLimit: textChunkLimit,
          chatGuid: msg.chatGuid || null,
        });
        if (!result.ok) {
          log.error(`Failed to send text: ${result.error}`);
        }
        return { ...result, messageId: result.ok ? generateMessageId() : undefined };
      }
    } catch (error: any) {
      log.error(`Send error: ${error.message}`);
      return { ok: false, error: error.message };
    }
  };
}

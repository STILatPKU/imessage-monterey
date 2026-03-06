/**
 * Admin commands for gateway control via iMessage
 * 
 * Allows administrators to control the gateway directly through slash commands.
 * Mirrors TUI slash commands from OpenClaw.
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface AdminCommandResult {
  ok: boolean;
  response: string;
  isAdmin: boolean;
}

/**
 * Session preferences that persist across messages
 */
interface SessionPreferences {
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
  verbose?: "on" | "full" | "off";
  reasoning?: "on" | "off" | "stream";
  usage?: "off" | "tokens" | "full";
  elevated?: "on" | "off" | "ask" | "full";
  activation?: "mention" | "always";
  deliver?: "on" | "off";
}

// Session preferences storage
const SESSION_PREFS_PATH = join(process.env.HOME || "/tmp", ".openclaw", "imessage-monterey-prefs.json");

function loadSessionPrefs(): SessionPreferences {
  try {
    if (existsSync(SESSION_PREFS_PATH)) {
      return JSON.parse(readFileSync(SESSION_PREFS_PATH, "utf-8"));
    }
  } catch {
    // Ignore errors
  }
  return {};
}

function saveSessionPrefs(prefs: SessionPreferences): void {
  try {
    const dir = join(process.env.HOME || "/tmp", ".openclaw");
    if (!existsSync(dir)) {
      writeFileSync(join(dir, ".gitkeep"), "");
    }
    writeFileSync(SESSION_PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch {
    // Ignore errors
  }
}

/**
 * Normalize a phone number by removing all non-digits
 */
function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Check if two phone numbers match, handling country code variations
 * (+1 vs no +1, +86 138... vs 86138...)
 */
function phoneNumbersMatch(sender: string, admin: string): boolean {
  const normalizedSender = normalizePhoneNumber(sender);
  const normalizedAdmin = normalizePhoneNumber(admin);
  
  // Exact match
  if (normalizedSender === normalizedAdmin) {
    return true;
  }
  
  // Try stripping leading country code (1 for US/Canada) and compare
  // e.g., 11234567890 vs 1234567890
  if (normalizedSender.length === normalizedAdmin.length + 1 && normalizedSender.startsWith("1")) {
    return normalizedSender.slice(1) === normalizedAdmin;
  }
  if (normalizedAdmin.length === normalizedSender.length + 1 && normalizedAdmin.startsWith("1")) {
    return normalizedSender === normalizedAdmin.slice(1);
  }
  
  return false;
}

/**
 * Check if a sender is an administrator
 */
export function isAdmin(senderId: string, adminList: string[]): boolean {
  return adminList.some(admin => phoneNumbersMatch(senderId, admin));
}

/**
 * Get current session preferences (for use by provider)
 */
export function getSessionPreferences(): SessionPreferences {
  return loadSessionPrefs();
}

/**
 * Parse and execute an admin command
 */
export function executeAdminCommand(
  text: string,
  senderId: string,
  adminList: string[]
): AdminCommandResult | null {
  // Check if message starts with /
  if (!text.trim().startsWith("/")) {
    return null; // Not a command
  }
  
  // Check if sender is admin
  if (!isAdmin(senderId, adminList)) {
    return {
      ok: false,
      response: "⛔ Unauthorized: Admin commands require administrator privileges.",
      isAdmin: false,
    };
  }
  
  const parts = text.trim().slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase() || "";
  const args = parts.slice(1);
  
  try {
    switch (command) {
      // ============ Core Commands ============
      case "help":
        return cmdHelp();
        
      case "status":
        return cmdStatus();
        
      case "agent":
      case "agents":
        return cmdAgent(args);
        
      case "session":
      case "sessions":
        return cmdSession(args);
        
      case "model":
      case "models":
        return cmdModel(args);
        
      // ============ Session Controls ============
      case "think":
        return cmdThink(args);
        
      case "verbose":
        return cmdVerbose(args);
        
      case "reasoning":
        return cmdReasoning(args);
        
      case "usage":
        return cmdUsage(args);
        
      case "elevated":
      case "elev":
        return cmdElevated(args);
        
      case "activation":
        return cmdActivation(args);
        
      case "deliver":
        return cmdDeliver(args);
        
      // ============ Session Lifecycle ============
      case "new":
      case "reset":
        return cmdReset(args, senderId);
        
      case "abort":
        return cmdAbort();
        
      case "settings":
        return cmdSettings();
        
      // ============ Gateway Management ============
      case "channels":
        return cmdChannels();
        
      case "restart":
        return cmdRestart();
        
      case "logs":
        return cmdLogs(args[0] ? parseInt(args[0]) : 20);
        
      case "config":
        return cmdConfig(args);
        
      case "allowlist":
        return cmdAllowlist(args);
        
      case "version":
        return cmdVersion();
        
      case "exit":
        return {
          ok: true,
          response: "👋 Use /help to see available commands.",
          isAdmin: true,
        };
        
      default:
        return {
          ok: false,
          response: `❓ Unknown command: /${command}\nType /help for available commands.`,
          isAdmin: true,
        };
    }
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Command failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

// ============ Command Implementations ============

function cmdHelp(): AdminCommandResult {
  return {
    ok: true,
    response: `🦞 **OpenClaw Admin Commands**

**Core:**
/help - Show this help
/status - Gateway status
/agent [id] - List/switch agents
/session [key] - List/switch sessions
/model [name] - List/set model

**Session Controls:**
/think <off|minimal|low|medium|high>
/verbose <on|full|off>
/reasoning <on|off|stream>
/usage <off|tokens|full>
/elevated <on|off|ask|full>
/deliver <on|off>

**Lifecycle:**
/reset - Reset current session
/abort - Abort active run
/settings - Show settings

**Gateway:**
/channels - List channels
/restart - Restart gateway
/logs [n] - Show last n logs
/config get/set - Manage config
/allowlist - Manage allowlist
/version - OpenClaw version`,
    isAdmin: true,
  };
}

function cmdStatus(): AdminCommandResult {
  try {
    const output = execSync("openclaw status 2>&1", { encoding: "utf-8", timeout: 10000 });
    const lines = output.split("\n").slice(0, 40).join("\n");
    return {
      ok: true,
      response: `📊 **Gateway Status**\n\`\`\`\n${lines}\n\`\`\``,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Failed to get status: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdAgent(args: string[]): AdminCommandResult {
  try {
    if (args[0]) {
      // Switch to agent
      execSync(`openclaw agent switch ${args[0]} 2>&1`, { encoding: "utf-8", timeout: 5000 });
      return {
        ok: true,
        response: `✅ Switched to agent: ${args[0]}`,
        isAdmin: true,
      };
    } else {
      // List agents
      const output = execSync("openclaw agents list 2>&1", { encoding: "utf-8", timeout: 5000 });
      return {
        ok: true,
        response: `🤖 **Agents**\n\`\`\`\n${output}\n\`\`\``,
        isAdmin: true,
      };
    }
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Agent operation failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdSession(args: string[]): AdminCommandResult {
  try {
    if (args[0]) {
      // Switch to session
      return {
        ok: true,
        response: `✅ Session switching not available via CLI. Current session: main`,
        isAdmin: true,
      };
    } else {
      // List sessions
      const output = execSync("openclaw sessions list 2>&1", { encoding: "utf-8", timeout: 5000 });
      return {
        ok: true,
        response: `📝 **Sessions**\n\`\`\`\n${output.slice(0, 2000)}\n\`\`\``,
        isAdmin: true,
      };
    }
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Session operation failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdModel(args: string[]): AdminCommandResult {
  try {
    if (args[0]) {
      // Set model override
      execSync(`openclaw config set model.override '${args[0]}' 2>&1`, { encoding: "utf-8", timeout: 5000 });
      return {
        ok: true,
        response: `✅ Model override set: ${args[0]}`,
        isAdmin: true,
      };
    } else {
      // List models
      const output = execSync("openclaw models list 2>&1", { encoding: "utf-8", timeout: 5000 });
      return {
        ok: true,
        response: `🔮 **Models**\n\`\`\`\n${output.slice(0, 2000)}\n\`\`\``,
        isAdmin: true,
      };
    }
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Model operation failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdThink(args: string[]): AdminCommandResult {
  const validLevels = ["off", "minimal", "low", "medium", "high"];
  const level = args[0]?.toLowerCase() as SessionPreferences["thinking"];
  
  if (!level || !validLevels.includes(level)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /think <${validLevels.join("|")}>\nCurrent: ${prefs.thinking || "default"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.thinking = level;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Thinking level set to: ${level}\n(Applies to next message)`,
    isAdmin: true,
  };
}

function cmdVerbose(args: string[]): AdminCommandResult {
  const validModes = ["on", "full", "off"];
  const mode = args[0]?.toLowerCase() as SessionPreferences["verbose"];
  
  if (!mode || !validModes.includes(mode)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /verbose <${validModes.join("|")}>\nCurrent: ${prefs.verbose || "off"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.verbose = mode;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Verbose mode: ${mode}`,
    isAdmin: true,
  };
}

function cmdReasoning(args: string[]): AdminCommandResult {
  const validModes = ["on", "off", "stream"];
  const mode = args[0]?.toLowerCase() as SessionPreferences["reasoning"];
  
  if (!mode || !validModes.includes(mode)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /reasoning <${validModes.join("|")}>\nCurrent: ${prefs.reasoning || "default"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.reasoning = mode;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Reasoning mode: ${mode}`,
    isAdmin: true,
  };
}

function cmdUsage(args: string[]): AdminCommandResult {
  const validModes = ["off", "tokens", "full"];
  const mode = args[0]?.toLowerCase() as SessionPreferences["usage"];
  
  if (!mode || !validModes.includes(mode)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /usage <${validModes.join("|")}>\nCurrent: ${prefs.usage || "off"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.usage = mode;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Usage display: ${mode}`,
    isAdmin: true,
  };
}

function cmdElevated(args: string[]): AdminCommandResult {
  const validModes = ["on", "off", "ask", "full"];
  const mode = args[0]?.toLowerCase() as SessionPreferences["elevated"];
  
  if (!mode || !validModes.includes(mode)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /elevated <${validModes.join("|")}>\nCurrent: ${prefs.elevated || "default"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.elevated = mode;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Elevated mode: ${mode}`,
    isAdmin: true,
  };
}

function cmdActivation(args: string[]): AdminCommandResult {
  const validModes = ["mention", "always"];
  const mode = args[0]?.toLowerCase() as SessionPreferences["activation"];
  
  if (!mode || !validModes.includes(mode)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /activation <${validModes.join("|")}>\nCurrent: ${prefs.activation || "mention"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.activation = mode;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Activation mode: ${mode}`,
    isAdmin: true,
  };
}

function cmdDeliver(args: string[]): AdminCommandResult {
  const mode = args[0]?.toLowerCase() as SessionPreferences["deliver"];
  
  if (!mode || !["on", "off"].includes(mode)) {
    const prefs = loadSessionPrefs();
    return {
      ok: false,
      response: `Usage: /deliver <on|off>\nCurrent: ${prefs.deliver || "on"}`,
      isAdmin: true,
    };
  }
  
  const prefs = loadSessionPrefs();
  prefs.deliver = mode;
  saveSessionPrefs(prefs);
  
  return {
    ok: true,
    response: `✅ Deliver mode: ${mode}\n(When on, assistant replies are delivered to the original channel)`,
    isAdmin: true,
  };
}

function cmdReset(args: string[], senderId: string): AdminCommandResult {
  try {
    const home = process.env.HOME || "";
    const sessionStorePath = join(home, ".openclaw", "agents", "main", "sessions", "sessions.json");
    const processedIdsPath = join(home, ".openclaw", `imessage-monterey-default.processed`);

    // 1. Reset the gateway session by updating the session store
    let sessionReset = false;
    let sessionId = "";

    if (existsSync(sessionStorePath)) {
      try {
        const store = JSON.parse(readFileSync(sessionStorePath, "utf-8"));
        const sessionKey = `imessage-monterey:${senderId}:session:default`;

        // Find and update the session entry
        for (const [key, entry] of Object.entries(store)) {
          const sessionEntry = entry as any;
          // Match on either exact key or the user field
          if (key === sessionKey || sessionEntry.user === sessionKey) {
            // Generate a new session ID (this clears the gateway context)
            sessionId = randomUUID();
            sessionEntry.sessionId = sessionId;
            sessionEntry.updatedAt = Date.now();
            sessionReset = true;

            // Update the store
            store[key] = sessionEntry;
            break;
          }
        }

        // If session was reset, write back to store
        if (sessionReset) {
          writeFileSync(sessionStorePath, JSON.stringify(store, null, 2), "utf-8");
        }
      } catch (error: any) {
        // Log but don't fail - we'll try the next method
        console.error(`Failed to reset session store: ${error.message}`);
      }
    }

    // 2. Clear processed message IDs (allows reprocessing of messages)
    let processedIdsCleared = false;
    if (existsSync(processedIdsPath)) {
      try {
        unlinkSync(processedIdsPath);
        processedIdsCleared = true;
      } catch (error: any) {
        console.error(`Failed to clear processed IDs: ${error.message}`);
      }
    }

    // 3. Clear session preferences
    let prefsCleared = false;
    try {
      saveSessionPrefs({});
      prefsCleared = true;
    } catch (error: any) {
      console.error(`Failed to clear preferences: ${error.message}`);
    }

    // Build response
    const actions: string[] = [];
    if (sessionReset) actions.push("Gateway session reset");
    if (processedIdsCleared) actions.push("Message history cleared");
    if (prefsCleared) actions.push("Preferences reset");

    if (actions.length === 0) {
      return {
        ok: false,
        response: `⚠️ No active session found to reset.\n\nThis may be your first message. A session will be created automatically when you send your next message.`,
        isAdmin: true,
      };
    }

    return {
      ok: true,
      response: `✅ Session Reset Complete\n\nActions performed:\n${actions.map(a => `• ${a}`).join("\n")}\n\nYour conversation context has been cleared. The next message will start a fresh session.`,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Reset failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdAbort(): AdminCommandResult {
  try {
    execSync("openclaw agent abort 2>&1", { encoding: "utf-8", timeout: 5000 });
    return {
      ok: true,
      response: `⏹️ Abort signal sent`,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Abort failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdSettings(): AdminCommandResult {
  try {
    const config = JSON.parse(readFileSync(`${process.env.HOME}/.openclaw/openclaw.json`, "utf-8"));
    const prefs = loadSessionPrefs();
    
    const settings = {
      model: config.model?.override || "default",
      thinking: prefs.thinking || "default",
      verbose: prefs.verbose || "off",
      reasoning: prefs.reasoning || "default",
      usage: prefs.usage || "off",
      elevated: prefs.elevated || "default",
      activation: prefs.activation || "mention",
      deliver: prefs.deliver || "on",
    };
    
    return {
      ok: true,
      response: `⚙️ **Current Settings**\n\`\`\`\n${JSON.stringify(settings, null, 2)}\n\`\`\``,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Failed to read settings: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdChannels(): AdminCommandResult {
  try {
    const output = execSync("openclaw status 2>&1 | grep -A20 'Channels'", { 
      encoding: "utf-8", 
      timeout: 10000 
    });
    return {
      ok: true,
      response: `📡 **Channels**\n\`\`\`\n${output}\n\`\`\``,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Failed to get channels: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdRestart(): AdminCommandResult {
  try {
    execSync("openclaw gateway restart 2>&1", { encoding: "utf-8", timeout: 30000 });
    return {
      ok: true,
      response: "🔄 Gateway restart initiated. Check status in a few seconds with /status",
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Restart failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdLogs(lines: number): AdminCommandResult {
  try {
    const logPath = `/tmp/openclaw/openclaw-${new Date().toISOString().slice(0, 10)}.log`;
    
    if (!existsSync(logPath)) {
      return {
        ok: false,
        response: `❌ Log file not found: ${logPath}`,
        isAdmin: true,
      };
    }
    
    const output = execSync(`tail -n ${Math.min(lines, 100)} "${logPath}"`, { 
      encoding: "utf-8", 
      timeout: 5000 
    });
    
    const formatted = output
      .split("\n")
      .slice(-lines)
      .map(line => {
        try {
          const json = JSON.parse(line);
          return json[1] || line;
        } catch {
          return line;
        }
      })
      .join("\n")
      .slice(0, 3000);
    
    return {
      ok: true,
      response: `📋 **Last ${lines} Log Lines**\n\`\`\`\n${formatted}\n\`\`\``,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Failed to read logs: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdConfig(args: string[]): AdminCommandResult {
  const subCommand = args[0]?.toLowerCase();
  
  try {
    switch (subCommand) {
      case "get":
        if (!args[1]) {
          return {
            ok: false,
            response: "Usage: /config get <path>\nExample: /config get channels.imessage-monterey.enabled",
            isAdmin: true,
          };
        }
        const getValue = execSync(`openclaw config get ${args[1]} 2>&1`, { 
          encoding: "utf-8", 
          timeout: 5000 
        });
        return {
          ok: true,
          response: `⚙️ **Config: ${args[1]}**\n\`\`\`\n${getValue}\n\`\`\``,
          isAdmin: true,
        };
        
      case "set":
        if (!args[1] || args.length < 3) {
          return {
            ok: false,
            response: "Usage: /config set <path> <value>\nExample: /config set channels.imessage-monterey.enabled false",
            isAdmin: true,
          };
        }
        const value = args.slice(2).join(" ");
        execSync(`openclaw config set ${args[1]} '${value}' 2>&1`, { 
          encoding: "utf-8", 
          timeout: 5000 
        });
        return {
          ok: true,
          response: `✅ Config updated: ${args[1]} = ${value}\nNote: May require gateway restart to take effect.`,
          isAdmin: true,
        };
        
      default:
        return {
          ok: false,
          response: "Usage: /config get <path> | /config set <path> <value>",
          isAdmin: true,
        };
    }
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Config operation failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdAllowlist(args: string[]): AdminCommandResult {
  const subCommand = args[0]?.toLowerCase();
  const home = process.env.HOME || "";
  const configPath = `${home}/.openclaw/openclaw.json`;
  
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const allowList = config.channels?.["imessage-monterey"]?.allowFrom || [];
    
    switch (subCommand) {
      case "list":
        return {
          ok: true,
          response: `📋 **Allowlist** (${allowList.length} numbers)\n${allowList.map((n: string) => `• ${n}`).join("\n") || "(empty)"}`,
          isAdmin: true,
        };
        
      case "add":
        if (!args[1]) {
          return {
            ok: false,
            response: "Usage: /allowlist add <number>\nExample: /allowlist add +1234567890",
            isAdmin: true,
          };
        }
        if (allowList.includes(args[1])) {
          return {
            ok: false,
            response: `⚠️ ${args[1]} is already in the allowlist.`,
            isAdmin: true,
          };
        }
        allowList.push(args[1]);
        execSync(`openclaw config set channels.imessage-monterey.allowFrom '${JSON.stringify(allowList)}' 2>&1`, { 
          encoding: "utf-8", 
          timeout: 5000 
        });
        return {
          ok: true,
          response: `✅ Added ${args[1]} to allowlist.`,
          isAdmin: true,
        };
        
      case "remove":
        if (!args[1]) {
          return {
            ok: false,
            response: "Usage: /allowlist remove <number>",
            isAdmin: true,
          };
        }
        const index = allowList.indexOf(args[1]);
        if (index === -1) {
          return {
            ok: false,
            response: `⚠️ ${args[1]} is not in the allowlist.`,
            isAdmin: true,
          };
        }
        allowList.splice(index, 1);
        execSync(`openclaw config set channels.imessage-monterey.allowFrom '${JSON.stringify(allowList)}' 2>&1`, { 
          encoding: "utf-8", 
          timeout: 5000 
        });
        return {
          ok: true,
          response: `✅ Removed ${args[1]} from allowlist.`,
          isAdmin: true,
        };
        
      default:
        return {
          ok: false,
          response: "Usage: /allowlist list | add <number> | remove <number>",
          isAdmin: true,
        };
    }
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Allowlist operation failed: ${error.message}`,
      isAdmin: true,
    };
  }
}

function cmdVersion(): AdminCommandResult {
  try {
    const output = execSync("openclaw --version 2>&1", { encoding: "utf-8", timeout: 5000 });
    return {
      ok: true,
      response: `🦞 **OpenClaw Version**\n\`\`\`\n${output}\n\`\`\``,
      isAdmin: true,
    };
  } catch (error: any) {
    return {
      ok: false,
      response: `❌ Failed to get version: ${error.message}`,
      isAdmin: true,
    };
  }
}

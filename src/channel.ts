/**
 * iMessage Monterey Channel Plugin
 * 
 * A native OpenClaw channel plugin for iMessage on macOS 12 Monterey.
 * Uses direct database polling instead of the imsg CLI (which requires macOS 14+).
 */

import type {
  ChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelSecurityAdapter,
  ChannelStatusAdapter,
  ChannelSetupAdapter,
  OpenClawConfig,
  RuntimeEnv,
  ChannelGatewayContext,
  ChannelLogSink,
  ChannelAccountSnapshot,
  ChannelAccountState,
  ChannelStatusIssue,
} from "openclaw/plugin-sdk";

/**
 * Result from outbound message delivery
 * Defined inline since it's not exported from the main plugin-sdk
 */
interface OutboundDeliveryResult {
  channel: string;
  messageId: string;
  chatId?: string;
  timestamp?: number;
  meta?: Record<string, unknown>;
}
import type {
  ResolvedIMessageMontereyAccount,
  AccountRuntimeState,
  IMessageMontereyAccountConfig,
} from "./types.js";
import { IMessageMontereyProvider, createOutboundSender } from "./provider.js";
import { checkDatabaseAccess, normalizeHandle } from "./db.js";

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_CONFIG: Required<IMessageMontereyAccountConfig> = {
  enabled: true,
  name: "iMessage",
  dbPath: "",
  prefix: "",
  pollIntervalMs: 10000,
  requirePrefixForAllowlist: false,
  dmPolicy: "open",
  allowFrom: [],
  groupPolicy: "allowlist",
  groupAllowFrom: [],
  textChunkLimit: 4000,
  adminList: [],
};

/**
 * Channel metadata
 */
const meta: ChannelMeta = {
  id: "imessage-monterey",
  label: "iMessage (Monterey)",
  selectionLabel: "iMessage (macOS 12 Monterey)",
  docsPath: "/channels/imessage-monterey",
  docsLabel: "imessage-monterey",
  blurb: "iMessage channel for macOS 12 Monterey using direct database polling.",
  aliases: ["imsg-m", "im-monterey"],
  order: 45,
  detailLabel: "iMessage via Database Polling",
  systemImage: "message.fill",
};

/**
 * Channel capabilities
 */
const capabilities: ChannelCapabilities = {
  chatTypes: ["direct", "group"],
  media: false, // Not supported - Messages.app AppleScript doesn't expose attachment sending
  reactions: false, // Not supported via AppleScript reliably
  edit: false,
  unsend: false,
  reply: false,
  effects: false,
  groupManagement: false,
  threads: false,
  nativeCommands: false,
};

// Internal runtime state storage
const runtimeStates = new Map<string, AccountRuntimeState>();

function getRuntimeState(accountId: string): AccountRuntimeState {
  if (!runtimeStates.has(accountId)) {
    runtimeStates.set(accountId, {
      accountId,
      running: false,
      lastPollAt: null,
      lastMessageAt: null,
      lastError: null,
      processedCount: 0,
      dbPath: null,
    });
  }
  return runtimeStates.get(accountId)!;
}

// ============================================================================
// Config Adapter
// ============================================================================

const config: ChannelConfigAdapter<ResolvedIMessageMontereyAccount> = {
  listAccountIds: (cfg: OpenClawConfig): string[] => {
    const accounts = cfg.channels?.["imessage-monterey"]?.accounts;
    if (accounts && Object.keys(accounts).length > 0) {
      return Object.keys(accounts);
    }
    // Check if top-level config exists
    const topLevel = cfg.channels?.["imessage-monterey"];
    if (topLevel && (topLevel.enabled || topLevel.dbPath || topLevel.prefix)) {
      return [DEFAULT_ACCOUNT_ID];
    }
    return [];
  },

  resolveAccount: (
    cfg: OpenClawConfig,
    accountId?: string | null
  ): ResolvedIMessageMontereyAccount => {
    const id = accountId || DEFAULT_ACCOUNT_ID;
    const accounts = cfg.channels?.["imessage-monterey"]?.accounts;
    const topLevel = cfg.channels?.["imessage-monterey"] || {};
    
    let accountConfig: IMessageMontereyAccountConfig = {};
    
    if (id !== DEFAULT_ACCOUNT_ID && accounts?.[id]) {
      accountConfig = accounts[id];
    } else if (id === DEFAULT_ACCOUNT_ID) {
      // Merge top-level config
      accountConfig = { ...topLevel };
    }
    
    // Merge with defaults
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...accountConfig,
    };
    
    // Determine if configured - just check if enabled is explicitly set or config exists
    // Database access is checked at runtime, not during config resolution
    const configured = Boolean(
      topLevel.enabled !== undefined ||
      topLevel.dmPolicy !== undefined ||
      topLevel.allowFrom !== undefined ||
      Object.keys(topLevel).some(k => !['enabled'].includes(k))
    );
    
    return {
      accountId: id,
      name: mergedConfig.name,
      enabled: mergedConfig.enabled ?? true,
      configured,
      config: mergedConfig,
    };
  },

  defaultAccountId: (_cfg: OpenClawConfig): string => {
    return DEFAULT_ACCOUNT_ID;
  },

  isConfigured: (account: ResolvedIMessageMontereyAccount, cfg: OpenClawConfig): boolean => {
    return account.configured;
  },

  describeAccount: (account: ResolvedIMessageMontereyAccount, cfg: OpenClawConfig): ChannelAccountSnapshot => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
  }),

  resolveAllowFrom: ({
    cfg,
    accountId,
  }: {
    cfg: OpenClawConfig;
    accountId?: string | null;
  }): string[] => {
    const account = config.resolveAccount(cfg, accountId);
    return account.config.allowFrom.map((s) => String(s));
  },

  formatAllowFrom: ({ cfg, accountId, allowFrom }: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    allowFrom: Array<string | number>;
  }): string[] => {
    return allowFrom.map((s) => String(s).trim()).filter(Boolean);
  },
};

// ============================================================================
// Security Adapter
// ============================================================================

const security: ChannelSecurityAdapter<ResolvedIMessageMontereyAccount> = {
  resolveDmPolicy: ({
    cfg,
    accountId,
    account,
  }: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    account: ResolvedIMessageMontereyAccount;
  }) => {
    const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
    const useAccountPath = Boolean(
      cfg.channels?.["imessage-monterey"]?.accounts?.[resolvedAccountId]
    );
    const basePath = useAccountPath
      ? `channels.imessage-monterey.accounts.${resolvedAccountId}.`
      : "channels.imessage-monterey.";
    
    return {
      policy: account.config.dmPolicy ?? "open",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: `${basePath}dmPolicy`,
      allowFromPath: basePath,
      approveHint: `Use: openclaw pairing approve imessage-monterey <CODE>`,
      normalizeEntry: normalizeHandle,
    };
  },

  collectWarnings: ({
    account,
  }: {
    account: ResolvedIMessageMontereyAccount;
  }): string[] => {
    const warnings: string[] = [];
    
    if (account.config.groupPolicy === "open") {
      warnings.push(
        `- iMessage groups: groupPolicy="open" allows any group member to trigger the bot. ` +
        `Set channels.imessage-monterey.groupPolicy="allowlist" and groupAllowFrom to restrict.`
      );
    }
    
    if (account.config.dmPolicy === "open" && account.config.allowFrom.length === 0) {
      warnings.push(
        `- iMessage DMs: dmPolicy="open" with empty allowFrom allows anyone to message the bot. ` +
        `Consider using "pairing" or "allowlist" for better security.`
      );
    }
    
    return warnings;
  },
};

// ============================================================================
// Status Adapter
// ============================================================================

const status: ChannelStatusAdapter<ResolvedIMessageMontereyAccount> = {
  buildAccountSnapshot: ({
    account,
    cfg,
    runtime,
    probe,
    audit,
  }: {
    account: ResolvedIMessageMontereyAccount;
    cfg: OpenClawConfig;
    runtime?: ChannelAccountSnapshot;
    probe?: unknown;
    audit?: unknown;
  }): ChannelAccountSnapshot => {
    // Use internal state if probe is not our runtime state type
    const internalState = (probe as AccountRuntimeState | undefined) || getRuntimeState(account.accountId);
    
    return {
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      running: internalState.running,
      lastMessageAt: internalState.lastMessageAt,
      lastError: internalState.lastError,
      dbPath: internalState.dbPath ?? null,
    };
  },

  resolveAccountState: ({
    account,
    cfg,
    configured,
    enabled,
  }: {
    account: ResolvedIMessageMontereyAccount;
    cfg: OpenClawConfig;
    configured: boolean;
    enabled: boolean;
  }): ChannelAccountState => {
    if (!configured) return "not configured";
    if (!enabled) return "disabled";
    return "enabled";
  },

  collectStatusIssues: (accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[] => {
    const issues: ChannelStatusIssue[] = [];
    
    for (const account of accounts) {
      if (account.lastError) {
        issues.push({
          channel: "imessage-monterey",
          accountId: account.accountId,
          kind: "runtime",
          message: `Channel error: ${account.lastError}`,
        });
      }
      
      if (account.configured && !account.running) {
        issues.push({
          channel: "imessage-monterey",
          accountId: account.accountId,
          kind: "runtime",
          message: "Channel configured but not running",
        });
      }
    }
    
    return issues;
  },
};

// ============================================================================
// Gateway Adapter
// ============================================================================

// Store active providers
const activeProviders = new Map<string, IMessageMontereyProvider>();

const gateway: ChannelGatewayAdapter<ResolvedIMessageMontereyAccount> = {
  startAccount: async (ctx: ChannelGatewayContext<ResolvedIMessageMontereyAccount>) => {
    const { accountId, account, abortSignal, log, setStatus, cfg } = ctx;
    
    const logger: ChannelLogSink = log || {
      info: console.log,
      warn: console.warn,
      error: console.error,
    };
    
    // Get or create runtime state
    const runtimeState = getRuntimeState(accountId);
    runtimeState.running = true;
    
    // Create provider
    const provider = new IMessageMontereyProvider({
      cfg,
      accountId,
      account,
      abortSignal,
      log: {
        ...logger,
        debug: logger.debug || ((msg: string) => console.log(msg)),
      },
    });
    
    // Store provider
    activeProviders.set(accountId, provider);
    
    // Update status
    setStatus({
      accountId,
      running: true,
      dbPath: account.config.dbPath || null,
    });
    
    // Handle abort signal
    abortSignal.addEventListener("abort", async () => {
      await provider.stop();
      runtimeState.running = false;
      activeProviders.delete(accountId);
    });
    
    // Start provider
    await provider.start();
    
    logger.info(`iMessage Monterey account ${accountId} started`);
    
    // Return a promise that resolves when aborted
    return new Promise((resolve) => {
      abortSignal.addEventListener("abort", () => resolve(undefined));
    });
  },

  stopAccount: async (ctx: {
    cfg: OpenClawConfig;
    accountId: string;
    account: ResolvedIMessageMontereyAccount;
    runtime: RuntimeEnv;
    log?: ChannelLogSink;
  }) => {
    const { accountId, log } = ctx;
    const provider = activeProviders.get(accountId);
    const runtimeState = getRuntimeState(accountId);
    
    if (provider) {
      await provider.stop();
      runtimeState.running = false;
      activeProviders.delete(accountId);
      log?.info(`iMessage Monterey account ${accountId} stopped`);
    }
  },
};

// ============================================================================
// Outbound Adapter
// ============================================================================

const outbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  
  textChunkLimit: 4000,
  
  sendText: async ({
    cfg,
    to,
    text,
    accountId,
  }: {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    accountId?: string | null;
    deps?: any;
  }): Promise<OutboundDeliveryResult> => {
    const account = config.resolveAccount(cfg, accountId);
    const log = {
      info: console.log,
      error: console.error,
    };
    
    const sender = createOutboundSender(account, log);
    const result = await sender({ to, text });
    
    if (!result.ok) {
      throw new Error(result.error || "Failed to send message");
    }
    
    return {
      channel: "imessage-monterey",
      messageId: result.messageId || `imsg-${Date.now()}`,
    };
  },

  // Media sending NOT supported: Messages.app AppleScript dictionary does not expose
  // any command to send attachments. The only alternatives are:
  // 1. GUI Automation via System Events (unreliable, requires Accessibility permissions)
  // 2. Shortcuts app automation (requires user setup)
  // 3. Use a different messaging method for media
};

// ============================================================================
// Setup Adapter
// ============================================================================

const setup: ChannelSetupAdapter = {
  applyAccountConfig: ({
    cfg,
    accountId,
    input,
  }: {
    cfg: OpenClawConfig;
    accountId: string;
    input: any;
  }) => {
    const id = accountId || DEFAULT_ACCOUNT_ID;
    
    if (id === DEFAULT_ACCOUNT_ID) {
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "imessage-monterey": {
            ...cfg.channels?.["imessage-monterey"],
            enabled: true,
            ...(input.dbPath ? { dbPath: input.dbPath } : {}),
            ...(input.prefix ? { prefix: input.prefix } : {}),
            ...(input.name ? { name: input.name } : {}),
          },
        },
      };
    }
    
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        "imessage-monterey": {
          ...cfg.channels?.["imessage-monterey"],
          enabled: true,
          accounts: {
            ...cfg.channels?.["imessage-monterey"]?.accounts,
            [id]: {
              ...cfg.channels?.["imessage-monterey"]?.accounts?.[id],
              enabled: true,
              ...(input.dbPath ? { dbPath: input.dbPath } : {}),
              ...(input.prefix ? { prefix: input.prefix } : {}),
              ...(input.name ? { name: input.name } : {}),
            },
          },
        },
      },
    };
  },
};

// ============================================================================
// Export Plugin
// ============================================================================

export const imessageMontereyPlugin: ChannelPlugin<ResolvedIMessageMontereyAccount> = {
  id: "imessage-monterey",
  meta,
  capabilities,
  config,
  security,
  status,
  gateway,
  outbound,
  setup,
  
  // Reload config when these paths change
  reload: {
    configPrefixes: ["channels.imessage-monterey"],
  },
};

/**
 * Shared types for Agent Pulse.
 *
 * The dashboard reads Claude Code transcript files directly:
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * Each line is one JSON event. We project the relevant ones into SessionState.
 */

/** A single transcript line. Only the fields we use are typed; the rest pass through. */
export interface TranscriptEntry {
  type?: string;
  /** Discriminator for system entries, e.g. "compact_boundary". */
  subtype?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  /** Present on type === "ai-title": the generated, conversation-based name. */
  aiTitle?: string;
  /** Present on type === "agent-name": a slugified name (fallback). */
  agentName?: string;
  /**
   * Assistant/user payload. Assistant content is an array of blocks (we read
   * tool_use/text); user content is either a plain string (a typed prompt) or
   * an array of blocks (text and/or tool_result).
   */
  message?: {
    role?: string;
    stop_reason?: string | null;
    content?:
      | string
      | Array<{
          type?: string;
          name?: string;
          text?: string;
          input?: Record<string, unknown>;
        }>;
    /** Token usage, present on assistant messages. */
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  /** True for meta entries (command wrappers, system-injected). */
  isMeta?: boolean;
  /** True for subagent (sidechain) entries. */
  isSidechain?: boolean;
  [key: string]: unknown;
}

/** A normalized entry in a session's activity worklog. */
export interface ActivityEntry {
  /** "tool" = an action Claude took; "prompt" = a message the user sent. */
  kind: "tool" | "prompt";
  /** Unix epoch seconds. */
  ts: number;
  /** Originating tool name (for reference / icons); "" for prompts. */
  tool: string;
  /** Short categorical tag for the colored chip, e.g. "Ran", "Edit", "You". */
  tag: string;
  /** Short human-readable summary, e.g. "Edited extension.ts". */
  summary: string;
  /**
   * Claude's own narration preceding this action, when available — its plain
   * description of what it's doing. Falls back to undefined (UI shows summary).
   */
  narration?: string;
  /**
   * The full, untruncated narration text (the complete assistant message),
   * shown on hover. Undefined when there was no narration.
   */
  fullText?: string;
  /** True if produced by a subagent. */
  subagent?: boolean;
}

export type SessionStatus = "active" | "idle";

/** The reduced, in-memory state for a single session. */
export interface SessionState {
  id: string;
  cwd: string | null;
  /** Generated session name from the conversation (ai-title), or a fallback. */
  title: string;
  gitBranch: string | null;
  startedAt: number;
  lastActivity: number;
  status: SessionStatus;
  toolCalls: number;
  /** Total transcript entries seen for this session. */
  entryCount: number;
  /** Cumulative output tokens generated across the session. */
  outputTokens: number;
  /** Latest-turn context size (input + cache read + cache creation tokens). */
  contextTokens: number;
  /**
   * Distinct skills invoked in this session — i.e. whose content has been read
   * into the context window and need not be loaded again.
   */
  loadedSkills: string[];
  /** Summary of the most recent action (for the collapsed row). */
  lastSummary: string | null;
  /** Chronological (oldest-first) worklog, capped to historyLimit. */
  history: ActivityEntry[];
}

/** Aggregate snapshot sent to the webview. */
export interface DashboardSnapshot {
  sessions: SessionState[];
  totalActive: number;
  totalToolCalls: number;
  generatedAt: number;
}

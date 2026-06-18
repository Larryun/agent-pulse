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
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  /** Present on type === "ai-title": the generated, conversation-based name. */
  aiTitle?: string;
  /** Present on type === "agent-name": a slugified name (fallback). */
  agentName?: string;
  /** Assistant/user payload. We read message.content[] for tool_use blocks. */
  message?: {
    role?: string;
    stop_reason?: string | null;
    content?: Array<{
      type?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  /** True for subagent (sidechain) entries. */
  isSidechain?: boolean;
  [key: string]: unknown;
}

/** A normalized entry in a session's activity worklog. */
export interface ActivityEntry {
  /** Unix epoch seconds. */
  ts: number;
  /** Originating tool name (for reference / icons). */
  tool: string;
  /** Short human-readable summary, e.g. "Edited extension.ts". */
  summary: string;
  /**
   * Claude's own narration preceding this action, when available — its plain
   * description of what it's doing. Falls back to undefined (UI shows summary).
   */
  narration?: string;
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

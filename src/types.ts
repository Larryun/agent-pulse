/**
 * Shared types for the Claude Progress Dashboard.
 *
 * Events are produced by Claude Code hooks (see scripts/log-event.sh) and
 * appended as one JSON object per line to per-session JSONL files. The
 * extension reads those files and projects them into SessionState.
 */

/** The hook events we record. Mirrors the hook names in scripts/log-event.sh. */
export type EventName =
  | "SessionStart"
  | "SessionEnd"
  | "PostToolUse"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop";

/** A single raw event, as written to a JSONL line by a hook. */
export interface ProgressUpdate {
  event: EventName;
  sessionId: string;
  /** Unix epoch seconds. */
  ts: number;
  /** Absolute working directory of the session, when available. */
  cwd?: string;
  /** Tool name for PostToolUse events (e.g. "Edit", "Bash"). */
  tool?: string;
  /** Optional human-readable detail (e.g. a file path or command summary). */
  detail?: string;
  /** Subagent identifier for SubagentStart/SubagentStop events. */
  subagentId?: string;
}

/** A normalized entry in a session's activity history (UI projection). */
export interface ActivityEntry {
  ts: number;
  event: EventName;
  tool?: string;
  detail?: string;
}

export type SessionStatus = "active" | "idle" | "completed";

/** The reduced, in-memory state for a single session. */
export interface SessionState {
  id: string;
  cwd: string | null;
  startedAt: number;
  lastActivity: number;
  status: SessionStatus;
  toolCalls: number;
  lastTool: string | null;
  activeSubagents: number;
  /** Chronological (oldest-first) ring buffer, capped to historyLimit. */
  history: ActivityEntry[];
}

/** Aggregate snapshot sent to the webview. */
export interface DashboardSnapshot {
  sessions: SessionState[];
  totalActive: number;
  totalToolCalls: number;
  generatedAt: number;
}

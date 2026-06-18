import { EventEmitter } from "events";
import {
  ActivityEntry,
  DashboardSnapshot,
  SessionState,
  TranscriptEntry,
} from "./types";
import { toEpoch } from "./transcriptReader";
import { summarizeTool, narrationFromText } from "./summarize";

/**
 * In-memory projection of session state, reduced from transcript entries
 * (startup replay + live tail). Transcript files remain the source of truth.
 */
export class SessionStore extends EventEmitter {
  private readonly sessions = new Map<string, SessionState>();
  /**
   * Most recent assistant narration (plain text) per session, awaiting the
   * tool call(s) it describes. Claude narrates in a separate message just
   * before the tools, so we carry it forward until consumed.
   */
  private readonly pendingNarration = new Map<string, string>();

  constructor(
    private historyLimit: number,
    private idleThresholdSeconds: number
  ) {
    super();
  }

  /** Reduce a single transcript entry. */
  apply(entry: TranscriptEntry): void {
    const sessionId = entry.sessionId;
    if (!sessionId) {
      return;
    }
    const session = this.ensureSession(sessionId, entry);
    const ts = toEpoch(entry.timestamp);
    if (ts) {
      session.lastActivity = Math.max(session.lastActivity, ts);
      if (!session.startedAt) {
        session.startedAt = ts;
      }
    }
    if (entry.cwd) {
      session.cwd = entry.cwd;
      if (!session.title) {
        session.title = entry.cwd;
      }
    }
    if (typeof entry.gitBranch === "string") {
      session.gitBranch = entry.gitBranch || session.gitBranch;
    }

    switch (entry.type) {
      case "ai-title":
        if (typeof entry.aiTitle === "string" && entry.aiTitle.trim()) {
          session.title = entry.aiTitle.trim();
        }
        break;
      case "agent-name":
        // Only use as a title if we have nothing better than the path yet.
        if (
          typeof entry.agentName === "string" &&
          (!session.title || session.title === session.cwd)
        ) {
          session.title = entry.agentName;
        }
        break;
      case "assistant":
        this.applyAssistant(session, entry, ts);
        break;
    }
  }

  /**
   * Walk an assistant message's content blocks in order. Text blocks become
   * the "pending narration" describing the work; tool_use blocks consume it
   * (the narration label is attached to the tools that follow it).
   */
  private applyAssistant(
    session: SessionState,
    entry: TranscriptEntry,
    ts: number
  ): void {
    const content = entry.message?.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content) {
      if (block?.type === "text") {
        const narration = narrationFromText((block as { text?: unknown }).text);
        if (narration) {
          this.pendingNarration.set(session.id, narration);
        }
        continue;
      }
      if (block?.type !== "tool_use" || typeof block.name !== "string") {
        continue;
      }
      const summary = summarizeTool(block.name, block.input);
      const narration = this.pendingNarration.get(session.id);
      const activity: ActivityEntry = {
        ts: ts || session.lastActivity,
        tool: block.name,
        summary,
        narration: narration || undefined,
        subagent: entry.isSidechain === true,
      };
      session.toolCalls += 1;
      // The collapsed row prefers narration, falling back to the summary.
      session.lastSummary = narration || summary;
      this.pushHistory(session, activity);
    }
  }

  applyBatch(entries: TranscriptEntry[]): void {
    for (const e of entries) {
      this.apply(e);
    }
    this.emitChanged();
  }

  applyLive(entry: TranscriptEntry): void {
    this.apply(entry);
    this.emitChanged();
  }

  /** Flip stale active sessions to idle based on wall clock. */
  reconcileIdle(nowSeconds: number): void {
    let changed = false;
    for (const session of this.sessions.values()) {
      const wasIdle = session.status === "idle";
      const isIdle =
        nowSeconds - session.lastActivity >= this.idleThresholdSeconds;
      const next = isIdle ? "idle" : "active";
      if (session.status !== next) {
        session.status = next;
        changed = true;
      }
      void wasIdle;
    }
    if (changed) {
      this.emitChanged();
    }
  }

  reset(): void {
    this.sessions.clear();
    this.pendingNarration.clear();
  }

  snapshot(): DashboardSnapshot {
    const sessions = [...this.sessions.values()].sort(
      (a, b) => b.lastActivity - a.lastActivity
    );
    return {
      sessions,
      totalActive: sessions.filter((s) => s.status === "active").length,
      totalToolCalls: sessions.reduce((sum, s) => sum + s.toolCalls, 0),
      generatedAt: Math.floor(Date.now() / 1000),
    };
  }

  private ensureSession(id: string, entry: TranscriptEntry): SessionState {
    let session = this.sessions.get(id);
    if (!session) {
      const ts = toEpoch(entry.timestamp);
      session = {
        id,
        cwd: entry.cwd ?? null,
        title: entry.cwd ?? "",
        gitBranch: typeof entry.gitBranch === "string" ? entry.gitBranch : null,
        startedAt: ts,
        lastActivity: ts,
        status: "active",
        toolCalls: 0,
        lastSummary: null,
        history: [],
      };
      this.sessions.set(id, session);
    }
    return session;
  }

  private pushHistory(session: SessionState, entry: ActivityEntry): void {
    session.history.push(entry);
    if (session.history.length > this.historyLimit) {
      session.history.splice(0, session.history.length - this.historyLimit);
    }
  }

  private emitChanged(): void {
    this.emit("changed", this.snapshot());
  }
}

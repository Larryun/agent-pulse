import { EventEmitter } from "events";
import {
  ActivityEntry,
  DashboardSnapshot,
  SessionState,
  TranscriptEntry,
} from "./types";
import { toEpoch } from "./transcriptReader";
import {
  summarizeTool,
  narrationFromText,
  actionTag,
  classifyUserMessage,
  clampInline,
} from "./summarize";

/**
 * In-memory projection of session state, reduced from transcript entries
 * (startup replay + live tail). Transcript files remain the source of truth.
 */
export class SessionStore extends EventEmitter {
  private readonly sessions = new Map<string, SessionState>();
  /**
   * Most recent assistant narration per session, awaiting the tool call(s) it
   * describes. Claude narrates in a separate message just before the tools, so
   * we carry it forward until consumed. `label` is the one-line summary; `full`
   * is the complete message text (shown on hover).
   */
  private readonly pendingNarration = new Map<
    string,
    { label: string; full: string }
  >();

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
    session.entryCount += 1;
    const ts = toEpoch(entry.timestamp);
    if (ts) {
      session.lastActivity = Math.max(session.lastActivity, ts);
      if (!session.startedAt) {
        session.startedAt = ts;
      }
    }
    if (entry.cwd && !session.cwd) {
      // The session's working directory is where it was launched — the first
      // cwd we see. Don't overwrite it: Claude may `cd` elsewhere mid-session
      // (or emit transient paths like .../tool-results), which would otherwise
      // clobber the real directory and break "open in terminal".
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
      case "user":
        this.applyUser(session, entry, ts);
        break;
    }
  }

  /**
   * Record a user-role message as a worklog entry. Real typed prompts get the
   * "You" tag; background task-completion notifications get a "System" tag.
   * Tool results, meta/sidechain entries, and command wrappers are skipped.
   */
  private applyUser(
    session: SessionState,
    entry: TranscriptEntry,
    ts: number
  ): void {
    if (entry.isMeta || entry.isSidechain) {
      return;
    }
    const msg = classifyUserMessage(entry.message?.content);
    if (!msg) {
      return;
    }
    const summary = narrationFromText(msg.text) || clampInline(msg.text);
    const activity: ActivityEntry = {
      kind: "prompt",
      ts: ts || session.lastActivity,
      tool: "",
      tag: msg.kind === "notification" ? "System" : "You",
      summary,
      fullText: msg.text,
    };
    // Notifications shouldn't masquerade as the latest user activity line.
    if (msg.kind !== "notification") {
      session.lastSummary = summary;
    }
    this.pushHistory(session, activity);
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
        const rawText =
          typeof (block as { text?: unknown }).text === "string"
            ? ((block as { text: string }).text)
            : "";
        const label = narrationFromText(rawText);
        if (label) {
          this.pendingNarration.set(session.id, {
            label,
            full: rawText.trim(),
          });
        }
        continue;
      }
      if (block?.type !== "tool_use" || typeof block.name !== "string") {
        continue;
      }
      const summary = summarizeTool(block.name, block.input);
      const pending = this.pendingNarration.get(session.id);
      const activity: ActivityEntry = {
        kind: "tool",
        ts: ts || session.lastActivity,
        tool: block.name,
        tag: actionTag(block.name),
        summary,
        narration: pending?.label || undefined,
        fullText: pending?.full || undefined,
        subagent: entry.isSidechain === true,
      };
      session.toolCalls += 1;
      // The collapsed row prefers narration, falling back to the summary.
      session.lastSummary = pending?.label || summary;
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
    // Sort by most recent worklog activity (the last history entry), so the
    // session that most recently *did* something is on top. Falls back to
    // lastActivity for sessions that have no recorded actions yet.
    const recency = (s: SessionState): number =>
      s.history.length ? s.history[s.history.length - 1].ts : s.lastActivity;
    const sessions = [...this.sessions.values()].sort(
      (a, b) => recency(b) - recency(a)
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
        entryCount: 0,
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

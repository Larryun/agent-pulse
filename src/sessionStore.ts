import { EventEmitter } from "events";
import * as path from "path";
import {
  ActivityEntry,
  DashboardSnapshot,
  ProgressUpdate,
  SessionState,
} from "./types";

/**
 * In-memory projection of session state, built by reducing ProgressUpdate
 * events (from startup replay + live tail). The JSONL files on disk remain the
 * durable source of truth; this is a fast-render cache.
 */
export class SessionStore extends EventEmitter {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private historyLimit: number,
    private idleThresholdSeconds: number
  ) {
    super();
  }

  /** Apply a single event. Returns true if state changed. */
  apply(update: ProgressUpdate): void {
    const session = this.ensureSession(update);

    // Keep cwd fresh if a later event carries it.
    if (update.cwd) {
      session.cwd = update.cwd;
    }
    session.lastActivity = Math.max(session.lastActivity, update.ts);

    switch (update.event) {
      case "SessionStart":
        session.startedAt = update.ts || session.startedAt;
        session.status = "active";
        break;
      case "PostToolUse":
        session.toolCalls += 1;
        session.lastTool = update.tool ?? session.lastTool;
        session.status = "active";
        break;
      case "SubagentStart":
        session.activeSubagents += 1;
        session.status = "active";
        break;
      case "SubagentStop":
        session.activeSubagents = Math.max(0, session.activeSubagents - 1);
        break;
      case "Stop":
        // Turn finished; session still alive but idle until next activity.
        session.status = "idle";
        break;
      case "SessionEnd":
        session.status = "completed";
        session.activeSubagents = 0;
        break;
    }

    this.pushHistory(session, {
      ts: update.ts,
      event: update.event,
      tool: update.tool,
      detail: update.detail,
    });
  }

  /**
   * Apply a batch of events without emitting per-event. Used for startup
   * replay. Emits a single "changed" at the end.
   */
  applyBatch(updates: ProgressUpdate[]): void {
    for (const u of updates) {
      this.apply(u);
    }
    this.emitChanged();
  }

  /** Apply one event and emit. Used for live tail. */
  applyLive(update: ProgressUpdate): void {
    this.apply(update);
    this.emitChanged();
  }

  /** Recompute idle/active status based on wall clock; emits if anything flipped. */
  reconcileIdle(nowSeconds: number): void {
    let changed = false;
    for (const session of this.sessions.values()) {
      if (session.status !== "active") {
        continue;
      }
      if (nowSeconds - session.lastActivity >= this.idleThresholdSeconds) {
        session.status = "idle";
        changed = true;
      }
    }
    if (changed) {
      this.emitChanged();
    }
  }

  /** Remove completed sessions from the in-memory view. */
  clearCompleted(): void {
    let changed = false;
    for (const [id, session] of this.sessions) {
      if (session.status === "completed") {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.emitChanged();
    }
  }

  /** Drop all in-memory state (e.g. before a full re-read). */
  reset(): void {
    this.sessions.clear();
  }

  snapshot(): DashboardSnapshot {
    const sessions = [...this.sessions.values()].sort(
      (a, b) => b.lastActivity - a.lastActivity
    );
    return {
      sessions,
      totalActive: sessions.filter((s) => s.status === "active").length,
      totalToolCalls: sessions.reduce((sum, s) => sum + s.toolCalls, 0),
      generatedAt: Math.floor(epochMs() / 1000),
    };
  }

  private ensureSession(update: ProgressUpdate): SessionState {
    let session = this.sessions.get(update.sessionId);
    if (!session) {
      session = {
        id: update.sessionId,
        cwd: update.cwd ?? null,
        startedAt: update.ts,
        lastActivity: update.ts,
        status: "active",
        toolCalls: 0,
        lastTool: null,
        activeSubagents: 0,
        history: [],
      };
      this.sessions.set(update.sessionId, session);
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

/** Short display name for a working directory. */
export function cwdLabel(cwd: string | null): string {
  if (!cwd) {
    return "unknown";
  }
  return path.basename(cwd.replace(/\/+$/, "")) || cwd;
}

// Wrapped so the rest of the module reads cleanly; isolated for testability.
function epochMs(): number {
  return Date.now();
}

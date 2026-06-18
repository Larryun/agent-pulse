import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { ProgressUpdate } from "./types";

/**
 * Reads per-session JSONL event logs from a directory.
 *
 *  - On start(), replays every existing file fully (so history survives
 *    extension-host restarts and SSH reconnects).
 *  - Watches the directory for new files and watches each file for appends,
 *    tailing only the newly written bytes (tracked per-file offset).
 *
 * Emits:
 *  - "replay" (ProgressUpdate[])  — the full set parsed during startup
 *  - "event"  (ProgressUpdate)    — each event seen live afterwards
 */
export class EventLogReader extends EventEmitter {
  private readonly offsets = new Map<string, number>();
  /** Bytes left over from a partial last line, per file. */
  private readonly partials = new Map<string, string>();
  private dirWatcher: fs.FSWatcher | undefined;
  private readonly fileWatchers = new Map<string, fs.FSWatcher>();
  private started = false;

  constructor(private readonly eventsDir: string) {
    super();
  }

  /** Replay existing logs, then begin watching for changes. */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    await fs.promises.mkdir(this.eventsDir, { recursive: true });

    const files = (await fs.promises.readdir(this.eventsDir)).filter((f) =>
      f.endsWith(".jsonl")
    );

    const replayed: ProgressUpdate[] = [];
    for (const file of files) {
      const full = path.join(this.eventsDir, file);
      const updates = await this.readFromOffset(full);
      replayed.push(...updates);
      this.watchFile(full);
    }
    // Order the combined replay chronologically across sessions.
    replayed.sort((a, b) => a.ts - b.ts);
    this.emit("replay", replayed);

    this.watchDirectory();
  }

  dispose(): void {
    this.dirWatcher?.close();
    this.dirWatcher = undefined;
    for (const w of this.fileWatchers.values()) {
      w.close();
    }
    this.fileWatchers.clear();
  }

  /**
   * Read any bytes appended to `file` since the last recorded offset, parse
   * complete JSONL lines, and return them. Buffers a trailing partial line.
   */
  private async readFromOffset(file: string): Promise<ProgressUpdate[]> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return [];
    }

    const start = this.offsets.get(file) ?? 0;

    // File was truncated/rotated: reset and read from the top.
    if (stat.size < start) {
      this.offsets.set(file, 0);
      this.partials.delete(file);
      return this.readFromOffset(file);
    }
    if (stat.size === start) {
      return [];
    }

    const buffer = Buffer.alloc(stat.size - start);
    const handle = await fs.promises.open(file, "r");
    try {
      await handle.read(buffer, 0, buffer.length, start);
    } finally {
      await handle.close();
    }
    this.offsets.set(file, stat.size);

    const text = (this.partials.get(file) ?? "") + buffer.toString("utf8");
    const lines = text.split("\n");
    // The last element is either "" (clean boundary) or a partial line.
    this.partials.set(file, lines.pop() ?? "");

    const updates: ProgressUpdate[] = [];
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed) {
        updates.push(parsed);
      }
    }
    return updates;
  }

  private watchDirectory(): void {
    try {
      this.dirWatcher = fs.watch(this.eventsDir, (_event, filename) => {
        if (!filename || !filename.toString().endsWith(".jsonl")) {
          return;
        }
        const full = path.join(this.eventsDir, filename.toString());
        if (!this.fileWatchers.has(full)) {
          this.watchFile(full);
          // A brand-new file may already have content; drain it now.
          void this.drain(full);
        }
      });
    } catch {
      // Directory watch is best-effort; file watches still cover existing logs.
    }
  }

  private watchFile(file: string): void {
    if (this.fileWatchers.has(file)) {
      return;
    }
    try {
      const watcher = fs.watch(file, () => {
        void this.drain(file);
      });
      this.fileWatchers.set(file, watcher);
    } catch {
      // File may have vanished between readdir and watch; ignore.
    }
  }

  /** Read new lines from a file and emit them live. */
  private async drain(file: string): Promise<void> {
    const updates = await this.readFromOffset(file);
    for (const u of updates) {
      this.emit("event", u);
    }
  }
}

/** Parse a single JSONL line into a ProgressUpdate, or null if invalid. */
export function parseLine(line: string): ProgressUpdate | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const obj = JSON.parse(trimmed);
    if (
      obj &&
      typeof obj.event === "string" &&
      typeof obj.sessionId === "string"
    ) {
      // Default ts to 0 if missing; reducer tolerates it.
      if (typeof obj.ts !== "number") {
        obj.ts = 0;
      }
      return obj as ProgressUpdate;
    }
  } catch {
    // Corrupt or partially-written line; skip it.
  }
  return null;
}

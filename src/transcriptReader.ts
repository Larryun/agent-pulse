import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { TranscriptEntry } from "./types";

/**
 * Reads Claude Code transcript files (~/.claude/projects/<dir>/<sessionId>.jsonl).
 *
 *  - On start(): scans all project dirs, replays each transcript fully.
 *  - Watches each project dir for new transcripts and each transcript for
 *    appends, tailing only newly written bytes (per-file offset).
 *
 * Emits:
 *  - "replay" (TranscriptEntry[])  — all entries parsed during startup
 *  - "entry"  (TranscriptEntry)    — each entry seen live afterwards
 */
export class TranscriptReader extends EventEmitter {
  private readonly offsets = new Map<string, number>();
  private readonly partials = new Map<string, string>();
  private readonly fileWatchers = new Map<string, fs.FSWatcher>();
  private readonly dirWatchers = new Map<string, fs.FSWatcher>();
  /**
   * Per-file promise chain. Multiple fs.watch events (both the dir watcher and
   * the file watcher, and macOS firing several per write) can call drain() for
   * the same file concurrently. readFromOffset() is async, so two overlapping
   * runs would both read from the same start offset and emit the same bytes
   * twice. Serializing per file prevents that duplication.
   */
  private readonly readChains = new Map<string, Promise<void>>();
  private rootWatcher: fs.FSWatcher | undefined;
  private started = false;

  constructor(private readonly projectsRoot: string) {
    super();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    await fs.promises.mkdir(this.projectsRoot, { recursive: true });

    const projectDirs = await this.listProjectDirs();
    const replayed: TranscriptEntry[] = [];
    for (const dir of projectDirs) {
      const files = await this.listTranscripts(dir);
      for (const file of files) {
        replayed.push(...(await this.readFromOffset(file)));
        this.watchFile(file);
      }
      this.watchDir(dir);
    }
    replayed.sort((a, b) => toEpoch(a.timestamp) - toEpoch(b.timestamp));
    this.emit("replay", replayed);

    this.watchRoot();
  }

  dispose(): void {
    this.rootWatcher?.close();
    this.rootWatcher = undefined;
    for (const w of this.dirWatchers.values()) {
      w.close();
    }
    for (const w of this.fileWatchers.values()) {
      w.close();
    }
    this.dirWatchers.clear();
    this.fileWatchers.clear();
  }

  private async listProjectDirs(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.projectsRoot, {
        withFileTypes: true,
      });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => path.join(this.projectsRoot, e.name));
    } catch {
      return [];
    }
  }

  private async listTranscripts(dir: string): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(dir);
      return files
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  }

  /** Read appended bytes since last offset; parse complete JSONL lines. */
  private async readFromOffset(file: string): Promise<TranscriptEntry[]> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return [];
    }

    const start = this.offsets.get(file) ?? 0;
    if (stat.size < start) {
      // Truncated/rotated: reset.
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
    this.partials.set(file, lines.pop() ?? "");

    const out: TranscriptEntry[] = [];
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed) {
        out.push(parsed);
      }
    }
    return out;
  }

  private watchRoot(): void {
    try {
      this.rootWatcher = fs.watch(this.projectsRoot, (_e, filename) => {
        if (!filename) {
          return;
        }
        const dir = path.join(this.projectsRoot, filename.toString());
        if (!this.dirWatchers.has(dir)) {
          // A new project dir may have appeared.
          fs.promises
            .stat(dir)
            .then((s) => {
              if (s.isDirectory()) {
                this.watchDir(dir);
                void this.drainDir(dir);
              }
            })
            .catch(() => undefined);
        }
      });
    } catch {
      /* best-effort */
    }
  }

  private watchDir(dir: string): void {
    if (this.dirWatchers.has(dir)) {
      return;
    }
    try {
      const watcher = fs.watch(dir, (_e, filename) => {
        if (!filename || !filename.toString().endsWith(".jsonl")) {
          return;
        }
        const file = path.join(dir, filename.toString());
        if (!this.fileWatchers.has(file)) {
          this.watchFile(file);
        }
        void this.drain(file);
      });
      this.dirWatchers.set(dir, watcher);
    } catch {
      /* best-effort */
    }
  }

  private watchFile(file: string): void {
    if (this.fileWatchers.has(file)) {
      return;
    }
    try {
      const watcher = fs.watch(file, () => void this.drain(file));
      this.fileWatchers.set(file, watcher);
    } catch {
      /* file may have vanished */
    }
  }

  private async drainDir(dir: string): Promise<void> {
    for (const file of await this.listTranscripts(dir)) {
      this.watchFile(file);
      await this.drain(file);
    }
  }

  private drain(file: string): Promise<void> {
    // Chain after any in-flight read for this file so reads never overlap.
    const prev = this.readChains.get(file) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const entries = await this.readFromOffset(file);
        for (const e of entries) {
          this.emit("entry", e);
        }
      });
    this.readChains.set(file, next);
    return next;
  }
}

/** Parse a transcript JSONL line, or null if invalid/irrelevant. */
export function parseLine(line: string): TranscriptEntry | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object") {
      return obj as TranscriptEntry;
    }
  } catch {
    /* partial or corrupt line */
  }
  return null;
}

/** ISO timestamp -> epoch seconds (0 if absent/unparseable). */
export function toEpoch(ts: string | undefined): number {
  if (!ts) {
    return 0;
  }
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { EventLogReader } from "./eventLogReader";
import { SessionStore } from "./sessionStore";
import { DashboardWebviewProvider } from "./dashboardWebview";
import { StatusBarController } from "./statusBarController";
import { ProgressUpdate } from "./types";

const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "PostToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
] as const;

let reader: EventLogReader | undefined;
let idleTimer: NodeJS.Timeout | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("claudeDashboard");
  const eventsDir = resolveEventsDir(config.get<string>("eventsDirectory"));
  const idleThreshold = config.get<number>("idleThresholdSeconds", 60);
  const historyLimit = config.get<number>("historyLimit", 100);
  const retentionDays = config.get<number>("retentionDays", 7);

  const store = new SessionStore(historyLimit, idleThreshold);
  const statusBar = new StatusBarController();
  const webview = new DashboardWebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardWebviewProvider.viewType,
      webview
    ),
    statusBar
  );

  store.on("changed", (snapshot) => {
    webview.update(snapshot);
    statusBar.update(snapshot);
  });

  await pruneOldLogs(eventsDir, retentionDays);

  reader = new EventLogReader(eventsDir);
  reader.on("replay", (updates: ProgressUpdate[]) => store.applyBatch(updates));
  reader.on("event", (update: ProgressUpdate) => store.applyLive(update));
  await reader.start();
  context.subscriptions.push({ dispose: () => reader?.dispose() });

  // Periodically flip stale active sessions to idle.
  idleTimer = setInterval(
    () => store.reconcileIdle(Math.floor(Date.now() / 1000)),
    15_000
  );
  context.subscriptions.push({
    dispose: () => idleTimer && clearInterval(idleTimer),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeDashboard.show", () =>
      webview.reveal()
    ),
    vscode.commands.registerCommand("claudeDashboard.refresh", async () => {
      store.reset();
      reader?.dispose();
      reader = new EventLogReader(eventsDir);
      reader.on("replay", (u: ProgressUpdate[]) => store.applyBatch(u));
      reader.on("event", (u: ProgressUpdate) => store.applyLive(u));
      await reader.start();
    }),
    vscode.commands.registerCommand("claudeDashboard.clearCompleted", () =>
      store.clearCompleted()
    ),
    vscode.commands.registerCommand("claudeDashboard.installHooks", () =>
      installHooks(context, eventsDir)
    )
  );
}

export function deactivate(): void {
  reader?.dispose();
  if (idleTimer) {
    clearInterval(idleTimer);
  }
}

function resolveEventsDir(configured: string | undefined): string {
  if (configured && configured.trim()) {
    return expandHome(configured.trim());
  }
  return path.join(os.homedir(), ".claude", "dashboard", "events");
}

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Delete *.jsonl files older than retentionDays. No-op if disabled. */
async function pruneOldLogs(
  eventsDir: string,
  retentionDays: number
): Promise<void> {
  if (!retentionDays || retentionDays <= 0) {
    return;
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let files: string[];
  try {
    files = await fs.promises.readdir(eventsDir);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((f) => f.endsWith(".jsonl"))
      .map(async (f) => {
        const full = path.join(eventsDir, f);
        try {
          const stat = await fs.promises.stat(full);
          if (stat.mtimeMs < cutoff) {
            await fs.promises.unlink(full);
          }
        } catch {
          /* ignore */
        }
      })
  );
}

/**
 * Install the log-event.sh helper into ~/.claude/dashboard and register the
 * dashboard hooks in ~/.claude/settings.json (merging, not clobbering).
 */
async function installHooks(
  context: vscode.ExtensionContext,
  eventsDir: string
): Promise<void> {
  const dashboardDir = path.dirname(eventsDir); // ~/.claude/dashboard
  const claudeDir = path.dirname(dashboardDir); // ~/.claude
  const scriptDest = path.join(dashboardDir, "log-event.sh");
  const settingsPath = path.join(claudeDir, "settings.json");

  try {
    await fs.promises.mkdir(eventsDir, { recursive: true });

    // Copy the bundled helper script and make it executable.
    const scriptSrc = vscode.Uri.joinPath(
      context.extensionUri,
      "scripts",
      "log-event.sh"
    );
    const scriptBytes = await vscode.workspace.fs.readFile(scriptSrc);
    await fs.promises.writeFile(scriptDest, Buffer.from(scriptBytes), {
      mode: 0o755,
    });
    await fs.promises.chmod(scriptDest, 0o755);

    // Merge hook entries into existing settings.json.
    const settings = await readJsonSafe(settingsPath);
    settings.hooks = settings.hooks || {};

    const command = `${scriptDest}`;
    for (const event of HOOK_EVENTS) {
      // Claude Code hook shape: each event maps to an array of matcher groups,
      // and each group has a `hooks` array of command entries.
      //   { "PostToolUse": [{ "matcher": "", "hooks": [{ type, command }] }] }
      const matcherGroup = {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `"${command}" ${event}`,
          },
        ],
      };

      const existing = Array.isArray(settings.hooks[event])
        ? settings.hooks[event]
        : [];
      // Avoid duplicate installs: drop any prior groups that reference our
      // helper script (in their nested hooks commands).
      const cleaned = existing.filter((group: any) => {
        const nested = Array.isArray(group?.hooks) ? group.hooks : [];
        const isOurs = nested.some(
          (h: any) =>
            typeof h?.command === "string" && h.command.includes("log-event.sh")
        );
        return !isOurs;
      });
      cleaned.push(matcherGroup);
      settings.hooks[event] = cleaned;
    }

    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf8"
    );

    vscode.window.showInformationMessage(
      "Claude Dashboard hooks installed. Start (or restart) a Claude Code session to begin tracking."
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to install Claude Dashboard hooks: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function readJsonSafe(file: string): Promise<any> {
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

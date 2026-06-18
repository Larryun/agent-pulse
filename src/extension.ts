import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { TranscriptReader } from "./transcriptReader";
import { SessionStore } from "./sessionStore";
import { DashboardWebviewProvider } from "./dashboardWebview";
import { StatusBarController } from "./statusBarController";
import { TranscriptEntry } from "./types";

let reader: TranscriptReader | undefined;
let idleTimer: NodeJS.Timeout | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentPulse");
  const projectsRoot = resolveProjectsRoot(
    config.get<string>("projectsDirectory")
  );
  const idleThreshold = config.get<number>("idleThresholdSeconds", 60);
  const historyLimit = config.get<number>("historyLimit", 100);

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
    // Recompute idle synchronously so the very first paint is accurate.
    webview.update(snapshot);
    statusBar.update(snapshot);
  });

  startReader(context, store, projectsRoot);

  // Periodically flip stale active sessions to idle.
  idleTimer = setInterval(
    () => store.reconcileIdle(Math.floor(Date.now() / 1000)),
    15_000
  );
  context.subscriptions.push({
    dispose: () => idleTimer && clearInterval(idleTimer),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("agentPulse.show", () =>
      webview.reveal()
    ),
    vscode.commands.registerCommand("agentPulse.refresh", () => {
      store.reset();
      reader?.dispose();
      startReader(context, store, projectsRoot);
    })
  );
}

export function deactivate(): void {
  reader?.dispose();
  if (idleTimer) {
    clearInterval(idleTimer);
  }
}

function startReader(
  context: vscode.ExtensionContext,
  store: SessionStore,
  projectsRoot: string
): void {
  reader = new TranscriptReader(projectsRoot);
  reader.on("replay", (entries: TranscriptEntry[]) => {
    store.applyBatch(entries);
    store.reconcileIdle(Math.floor(Date.now() / 1000));
  });
  reader.on("entry", (entry: TranscriptEntry) => store.applyLive(entry));
  void reader.start();
  context.subscriptions.push({ dispose: () => reader?.dispose() });
}

function resolveProjectsRoot(configured: string | undefined): string {
  if (configured && configured.trim()) {
    return expandHome(configured.trim());
  }
  return path.join(os.homedir(), ".claude", "projects");
}

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

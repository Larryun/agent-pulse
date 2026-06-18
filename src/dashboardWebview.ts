import * as vscode from "vscode";
import { DashboardSnapshot } from "./types";

/**
 * Sidebar webview that renders the aggregated session dashboard. The extension
 * pushes DashboardSnapshot objects via postMessage; all rendering happens in
 * the webview script (media/dashboard.js).
 */
export class DashboardWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentPulse.sessions";

  private view: vscode.WebviewView | undefined;
  private lastSnapshot: DashboardSnapshot | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    // The webview asks for the current state once it has loaded.
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready" && this.lastSnapshot) {
        this.post(this.lastSnapshot);
      } else if (msg?.type === "openSession") {
        this.openSessionInTerminal(msg.sessionId, msg.cwd);
      }
    });

    if (this.lastSnapshot) {
      this.post(this.lastSnapshot);
    }
  }

  /** Reveal the view if it exists. */
  reveal(): void {
    this.view?.show?.(true);
  }

  update(snapshot: DashboardSnapshot): void {
    this.lastSnapshot = snapshot;
    this.post(snapshot);
  }

  private post(snapshot: DashboardSnapshot): void {
    this.view?.webview.postMessage({ type: "snapshot", snapshot });
  }

  /**
   * Open a new terminal at the session's working directory and run the
   * configured resume command (default: `claude --resume <id>`). The command
   * template is user-configurable; `${sessionId}` is substituted.
   */
  private openSessionInTerminal(
    sessionId: unknown,
    cwd: unknown
  ): void {
    if (typeof sessionId !== "string" || !sessionId) {
      return;
    }
    const config = vscode.workspace.getConfiguration("agentPulse");
    const template = config.get<string>(
      "resumeCommand",
      "claude --resume ${sessionId}"
    );
    const command = template.replace(/\$\{sessionId\}/g, sessionId);

    const terminal = vscode.window.createTerminal({
      name: `Claude ${sessionId.slice(0, 8)}`,
      cwd: typeof cwd === "string" && cwd ? cwd : undefined,
    });
    terminal.show();
    if (command.trim()) {
      terminal.sendText(command, true);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "dashboard.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "dashboard.js")
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Agent Pulse</title>
</head>
<body>
  <header id="summary" class="summary">
    <span id="summary-text">No sessions yet.</span>
  </header>
  <div id="sessions" class="sessions"></div>
  <div id="empty" class="empty">
    <p>No agent sessions found.</p>
    <p>Start a Claude Code session and your activity will appear here automatically.</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

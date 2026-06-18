import * as vscode from "vscode";
import { DashboardSnapshot } from "./types";

/** Drives a status bar item summarizing active session count. */
export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = "claudeDashboard.show";
    this.item.tooltip = "Open the Claude Progress Dashboard";
  }

  update(snapshot: DashboardSnapshot): void {
    const { totalActive, sessions } = snapshot;
    if (sessions.length === 0) {
      this.item.hide();
      return;
    }
    const icon = totalActive > 0 ? "$(pulse)" : "$(history)";
    this.item.text = `${icon} Claude: ${totalActive} active`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

# Agent Pulse

A real-time, aggregated dashboard of your AI coding-agent sessions, right inside VS Code. See every session's generated name, current action, and a worklog of what was done — across all sessions, including **Remote SSH**.

Agent Pulse currently supports **Claude Code**, with a design that's ready to grow to other agents (Kiro, etc.).

![status: active](https://img.shields.io/badge/status-active-brightgreen)

## Features

- **Aggregated view** — all your sessions in one panel, with a live summary header (sessions · active · total tool calls).
- **Session names** — shows the AI-generated, conversation-based session title, with the session hash and working-directory path on a smaller line.
- **Worklog** — instead of raw tool names, each action is summarized (e.g. *"Edited extension.ts"*, *"Ran: npm run compile"*, *"Task: design architecture"*). Click a session to expand its full chronological worklog.
- **Open in terminal** — hover a session and click **⎘ Open** to resume it in a terminal at its working directory (runs `claude --resume <id>` by default; configurable).
- **Live & zero-setup** — reads the agent's own transcript files directly. No hooks, no config changes, nothing to install into the agent.
- **Remote SSH friendly** — reads transcripts on the same host where the agent runs.

## Installing

This is distributed as a `.vsix` package (not yet on the Marketplace).

**Local VS Code**
1. Download / build `agent-pulse-<version>.vsix` (see [Development](#development)).
2. Extensions panel → `⋯` menu → **Install from VSIX…** → pick the file.
   *(Or: `code --install-extension agent-pulse-<version>.vsix`.)*
3. **Reload Window** (`Cmd/Ctrl+Shift+P` → *Developer: Reload Window*).
4. Open **Agent Pulse** from the Activity Bar.

**Remote SSH**
Install it in the Remote-SSH window (not locally), so it reads transcripts on the remote host:
1. With the Remote-SSH window focused, Extensions panel → **Install from VSIX…**, or copy the `.vsix` to the host and run `code --install-extension` there.
2. Reload the remote window.

## How session discovery works

Agent Pulse never talks to the agent directly — it reads the transcript files the agent already writes:

```
~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
```

- **Startup:** scans every project directory, reads each `*.jsonl` transcript, and replays it into per-session state.
- **Live:** watches the directories and files (`fs.watch`); when a new session file appears or an existing one grows, it tails only the appended lines.
- **Status:** a session is **active** if it had activity within `idleThresholdSeconds` (default 60s), otherwise **idle**. (Transcripts have no explicit "ended" event, so status is inferred from recency.)

A session is "discovered" the moment a transcript line carrying its `sessionId` is seen.

## Commands

| Command | Description |
| --- | --- |
| `Agent Pulse: Show Sessions` | Reveal the dashboard view |
| `Agent Pulse: Refresh` | Re-scan all transcripts from disk |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `agentPulse.projectsDirectory` | `~/.claude/projects` | Where transcripts live |
| `agentPulse.idleThresholdSeconds` | `60` | Inactivity before a session shows as idle |
| `agentPulse.historyLimit` | `100` | Worklog entries kept in memory per session |
| `agentPulse.resumeCommand` | `claude --resume ${sessionId}` | Command run when opening a session in a terminal (`${sessionId}` is substituted; empty = just open a terminal in the directory) |
| `agentPulse.terminalName` | `auto` | How to name the opened terminal: `auto` (let Claude Code drive the tab title/icon live, including its loading animation), `title` (session's AI title), or `hash` (short session id) |

## Privacy

All data stays local. Agent Pulse only **reads** existing transcript files on your machine (or your remote host) and never sends anything over the network.

## Development

```bash
npm install
npm run compile          # or: npm run watch
# Press F5 in VS Code to launch an Extension Development Host (Cmd/Ctrl+R to reload)

# Package a .vsix:
npx @vscode/vsce package
```

## Roadmap

- **Multi-agent support** — pluggable transcript adapters (Kiro at `~/.kiro/sessions/cli/*.jsonl`, and others).
- Full editor-tab view with a richer timeline.
- Token-usage metrics per session.
- Filtering / grouping by workspace.

## License

[MIT](./LICENSE)

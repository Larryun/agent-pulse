# Claude Progress Dashboard

An aggregated, real-time dashboard of your [Claude Code](https://www.anthropic.com/claude-code) sessions, right inside VS Code. See every session's status, current activity, tool usage, and full activity history in one sidebar — including sessions running over **Remote SSH**.

![status: active](https://img.shields.io/badge/status-active-brightgreen)

## Features

- **Aggregated view** — all your Claude Code sessions in one panel, with a live summary header (sessions · active · total tool calls).
- **Per-session status** — 🟢 active / 🟡 idle / ⚪ completed, current activity, tool count, subagent count, and duration.
- **Expandable activity history** — click any session to see a chronological log of its events.
- **Durable & replayable** — events are stored as per-session JSONL files, so history survives window reloads and SSH reconnects.
- **Remote SSH friendly** — the extension reads logs on the same host where Claude Code runs; no extra configuration.

## How it works

```
Claude Code session(s)
   │  hooks append one JSON line per event
   ▼
~/.claude/dashboard/events/<sessionId>.jsonl     ← durable source of truth
   │  read on startup + tailed for live updates
   ▼
VS Code extension  →  sidebar dashboard + status bar
```

The extension uses Claude Code's [hooks](https://docs.claude.com/en/docs/claude-code/hooks) system. A small helper script (`log-event.sh`) appends an event line whenever a session starts/ends, a tool runs, a subagent starts/stops, or a turn stops. The extension watches those files and projects them into the dashboard.

## Getting started

1. Install the extension.
2. Open the Command Palette and run **`Claude Dashboard: Install Hooks`**. This:
   - copies `log-event.sh` to `~/.claude/dashboard/`, and
   - merges the dashboard hooks into `~/.claude/settings.json` (existing hooks are preserved).
3. Start (or restart) a Claude Code session.
4. Open the **Claude Dashboard** view from the Activity Bar.

> On Remote SSH, run **Install Hooks** while connected to the remote host so the script and logs live on that host.

## Commands

| Command | Description |
| --- | --- |
| `Claude Dashboard: Show Sessions` | Reveal the dashboard view |
| `Claude Dashboard: Install Hooks` | Install the helper script + register hooks |
| `Claude Dashboard: Refresh` | Re-read all event logs from disk |
| `Claude Dashboard: Clear Completed Sessions` | Hide finished sessions from the view |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `claudeDashboard.eventsDirectory` | `~/.claude/dashboard/events` | Where session JSONL logs live |
| `claudeDashboard.idleThresholdSeconds` | `60` | Inactivity before a session shows as idle |
| `claudeDashboard.historyLimit` | `100` | Activity entries kept in memory per session |
| `claudeDashboard.retentionDays` | `7` | Delete logs older than this on startup (`0` = keep forever) |

## Privacy

All data stays local. Event logs are plain JSON files on your machine (or your remote host) and contain only event names, tool names, timestamps, and the working directory. The extension never sends anything over the network.

## Development

```bash
npm install
npm run compile      # or: npm run watch
# Press F5 in VS Code to launch the Extension Development Host
```

See [the roadmap](#roadmap) for what's next.

## Roadmap

- Full editor-tab view with a richer timeline and expanded logs
- Token-usage metrics per session
- Filtering / grouping by workspace

## License

[MIT](./LICENSE)

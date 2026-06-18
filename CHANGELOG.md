# Changelog

All notable changes to this project are documented here.

## [0.1.0] - Unreleased

First public release.

### Added
- Sidebar dashboard aggregating all Claude Code sessions, discovered by reading transcript files in `~/.claude/projects`.
- Per-session display: AI-generated session title, session hash + working-directory path, and live status (active / idle).
- Worklog of summarized actions per session (e.g. "Edited extension.ts", "Ran: npm run compile", "Task: …"), expandable per session.
- Status bar item showing the active session count.
- Live updates via filesystem watching (startup replay + tail), with Remote SSH support.
- `Agent Pulse: Show Sessions` and `Agent Pulse: Refresh` commands.
- Configurable transcripts directory, idle threshold, and worklog history limit.

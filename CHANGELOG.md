# Changelog

All notable changes to this project are documented here.

## [0.1.0] - Unreleased

First public release.

### Added
- Sidebar dashboard aggregating all Claude Code sessions, discovered by reading transcript files in `~/.claude/projects`.
- Per-session display: AI-generated session title, session hash + working-directory path, live status (active / idle), last-active time ("5m ago"), and transcript entry count.
- Worklog per session, interleaving the user's prompts (a **You** chip) and background notifications (a **System** chip) with Claude's actions. Each action shows Claude's own narration (the text it wrote describing the step) when available, falling back to a rule-based summary (e.g. "Edited extension.ts", "Ran: npm run compile"); Skill actions name the skill used (e.g. "Skill: loop").
- Each worklog row carries a categorical tag with a colored left bar (Ran=blue, Edit=red, Read=green, Search=purple, Web=yellow, Task=orange, Skill=violet, MCP=teal, You, System). Rows show the full text on one line (truncated with an ellipsis to the panel width) and are click-to-expand, wrapping the full text and growing the row height.
- Open a session in a terminal (hover → **⎘ Open**), which resumes it at its working directory via a configurable command (`claude --resume ${sessionId}` by default). The directory is the session's launch cwd (first seen), so mid-session `cd`s don't break it; a stale directory falls back gracefully with a warning. By default (`agentPulse.terminalName`: `auto`) the terminal is unnamed so Claude Code drives the tab title and icon live, including its loading animation; set `title` or `hash` for a static name.
- Status bar item showing the active session count.
- Live updates via filesystem watching (startup replay + tail), with Remote SSH support.
- `Agent Pulse: Show Sessions` and `Agent Pulse: Refresh` commands.
- Configurable transcripts directory, idle threshold, and worklog history limit.

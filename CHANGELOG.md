# Changelog

All notable changes to this project are documented here.

## [0.1.0] - Unreleased

First public release.

### Added
- Sidebar dashboard aggregating all Claude Code sessions, discovered by reading transcript files in `~/.claude/projects`.
- Per-session display: AI-generated session title, session hash + working-directory path, and live status (active / idle).
- Worklog per session, expandable. Each action shows Claude's own narration (the text it wrote describing the step) when available, falling back to a rule-based summary (e.g. "Edited extension.ts", "Ran: npm run compile"). A colored action chip (Ran / Edit / Read / Search / Web / Task / Skill / …) tags each row, hovering shows the full message text, and Skill actions name the skill used (e.g. "Skill: loop").
- Open a session in a terminal (hover → **⎘ Open**), which resumes it at its working directory via a configurable command (`claude --resume ${sessionId}` by default). The directory is the session's launch cwd (first seen), so mid-session `cd`s don't break it; a stale directory falls back gracefully with a warning. By default (`agentPulse.terminalName`: `auto`) the terminal is unnamed so Claude Code drives the tab title and icon live, including its loading animation; set `title` or `hash` for a static name.
- Status bar item showing the active session count.
- Live updates via filesystem watching (startup replay + tail), with Remote SSH support.
- `Agent Pulse: Show Sessions` and `Agent Pulse: Refresh` commands.
- Configurable transcripts directory, idle threshold, and worklog history limit.

# Changelog

All notable changes to this project are documented here.

## [0.1.1] - Unreleased

### Fixed
- `Install Hooks` now writes hooks in Claude Code's required shape (`matcher` + nested `hooks` array) instead of a flat command list, which triggered a settings validation error.

## [0.1.0] - Unreleased

### Added
- Sidebar dashboard aggregating all Claude Code sessions.
- Per-session status (active / idle / completed), current activity, tool count, subagent count, and duration.
- Expandable per-session activity history.
- Status bar item showing active session count.
- File-based (JSONL) event storage that survives window reloads and SSH reconnects.
- `Install Hooks` command to set up the helper script and Claude Code hooks.
- Configurable events directory, idle threshold, history limit, and log retention.

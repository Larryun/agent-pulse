/**
 * Turn a tool_use block into a short, worklog-style summary line.
 * Pure functions only — unit-tested without VS Code.
 */

/** Basename of a path-like string. */
export function baseName(p: unknown): string {
  if (typeof p !== "string" || !p) {
    return "";
  }
  const cleaned = p.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Collapse whitespace and clamp to a max length with an ellipsis. */
export function clamp(s: string, max = 60): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/**
 * Turn Claude's narration text into a one-line worklog label: take the first
 * sentence/line, strip light markdown, collapse whitespace. Does NOT append an
 * ellipsis — visual truncation is left to CSS (text-overflow). Returns "" when
 * there's nothing useful to show.
 */
export function narrationFromText(text: unknown): string {
  if (typeof text !== "string") {
    return "";
  }
  // First non-empty line, then first sentence within it.
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) {
    return "";
  }
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  // Strip light markdown. Remove emphasis/code markers BEFORE leading
  // list/heading markers, so "**Bold**" isn't mangled by the leading strip.
  const cleaned = sentence
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^[#>\-*\d.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Hard cap to bound payload size, but without an ellipsis (CSS truncates).
  const MAX = 200;
  return cleaned.length > MAX ? cleaned.slice(0, MAX) : cleaned;
}

/** Classification of a user-role transcript message. */
export interface UserMessage {
  /** "prompt" = real typed input; "notification" = system/background event. */
  kind: "prompt" | "notification";
  text: string;
}

/**
 * Classify a user message's `content` (a string or array of blocks). Returns
 * null for content that should be skipped entirely (tool results, slash-command
 * wrappers, interrupt markers). Background task-completion notifications are
 * returned as kind "notification" so the UI can tag them distinctly.
 */
export function classifyUserMessage(content: unknown): UserMessage | null {
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    // Ignore tool_result blocks; join any text blocks.
    if (
      content.some((b) => b && (b as { type?: string }).type === "tool_result")
    ) {
      return null;
    }
    text = content
      .filter((b) => b && (b as { type?: string }).type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join(" ");
  } else {
    return null;
  }
  text = text.trim();
  if (!text) {
    return null;
  }

  // Background task / system notifications: keep, but tag as "notification".
  if (/^<task-notification>/.test(text) || /<task-id>/.test(text)) {
    return { kind: "notification", text };
  }

  // Drop slash-command / local-command wrappers and interrupt markers.
  if (
    /^<(command-name|command-message|command-args|local-command-caveat|local-command-stdout)/.test(
      text
    ) ||
    /^\[Request interrupted/.test(text)
  ) {
    return null;
  }
  return { kind: "prompt", text };
}

/** Collapse whitespace to a single line (no truncation). */
export function clampInline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Build a short summary for a tool invocation.
 * `name` is the tool name; `input` is its argument object.
 */
export function summarizeTool(
  name: string,
  input: Record<string, unknown> | undefined
): string {
  const i = input ?? {};
  const file = () => baseName(i.file_path);

  switch (name) {
    case "Write":
      return `Wrote ${file() || "a file"}`;
    case "Edit":
    case "MultiEdit":
      return `Edited ${file() || "a file"}`;
    case "NotebookEdit":
      return `Edited notebook ${file() || ""}`.trim();
    case "Read":
      return `Read ${file() || "a file"}`;
    case "Bash": {
      const cmd = typeof i.command === "string" ? i.command : "";
      const desc = typeof i.description === "string" ? i.description : "";
      if (cmd) {
        return clamp(`Ran: ${firstCommand(cmd)}`);
      }
      return desc ? clamp(desc) : "Ran a command";
    }
    case "Glob":
      return clamp(`Searched files ${str(i.pattern)}`.trim());
    case "Grep":
      return clamp(`Searched ${quoteIf(i.pattern)}`.trim());
    case "Agent":
    case "Task": {
      const d = typeof i.description === "string" ? i.description : "";
      return d ? clamp(`Task: ${d}`) : "Launched a subagent";
    }
    case "WebFetch":
      return clamp(`Fetched ${str(i.url)}`.trim());
    case "WebSearch":
      return clamp(`Web search ${quoteIf(i.query)}`.trim());
    case "TodoWrite":
      return "Updated the task list";
    case "AskUserQuestion":
      return "Asked a question";
    case "ExitPlanMode":
      return "Presented a plan";
    case "ToolSearch":
      return "Looked up a tool";
    case "Skill": {
      const skill = typeof i.skill === "string" ? i.skill : "";
      // Skills can be namespaced (e.g. "plugin:skill"); show the readable tail.
      const short = skill.includes(":") ? skill.slice(skill.lastIndexOf(":") + 1) : skill;
      return short ? clamp(`Skill: ${short}`) : "Ran a skill";
    }
    default:
      // MCP tools and anything else: humanize the name.
      return clamp(humanizeToolName(name));
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function quoteIf(v: unknown): string {
  const s = str(v);
  return s ? `"${s}"` : "";
}

/** First meaningful command in a (possibly chained) bash string. */
function firstCommand(cmd: string): string {
  const head = cmd.split(/&&|\|\||;|\n/)[0];
  return head.trim();
}

/**
 * A short, categorical tag for a tool — used to render a colored chip in the
 * worklog (e.g. "Ran", "Edit", "Read", "Skill", "Search"). Keep these stable;
 * the webview maps them to colors via `data-tag`.
 */
export function actionTag(name: string): string {
  switch (name) {
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "Edit";
    case "Read":
      return "Read";
    case "Bash":
      return "Ran";
    case "Glob":
    case "Grep":
    case "WebSearch":
      return "Search";
    case "WebFetch":
    case "ReadInternalWebsites":
      return "Web";
    case "Agent":
    case "Task":
      return "Task";
    case "Skill":
      return "Skill";
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "Task";
    case "AskUserQuestion":
      return "Ask";
    case "ExitPlanMode":
    case "EnterPlanMode":
      return "Plan";
    case "ToolSearch":
      return "Tool";
    default:
      return name.startsWith("mcp__") ? "MCP" : "Tool";
  }
}

/** "mcp__server__do_thing" -> "do thing (server)"; "FooBar" -> "Foo Bar". */
export function humanizeToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    const server = parts[1] ?? "";
    const tool = (parts[2] ?? "").replace(/_/g, " ");
    return server ? `${tool} (${server})` : tool;
  }
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

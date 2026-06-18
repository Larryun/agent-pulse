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

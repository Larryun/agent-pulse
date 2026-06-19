// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const summaryEl = document.getElementById("summary-text");
  const sessionsEl = document.getElementById("sessions");
  const emptyEl = document.getElementById("empty");

  // Remember which sessions / rows the user expanded, across re-renders.
  const savedState = vscode.getState() || {};
  const expanded = new Set(savedState.expanded || []);
  const expandedRows = new Set(savedState.expandedRows || []);

  function persistExpanded() {
    vscode.setState({
      expanded: [...expanded],
      expandedRows: [...expandedRows],
    });
  }

  // Compact time (HH:MM) for the row; the full date+time is shown on hover.
  function fmtTime(tsSeconds) {
    if (!tsSeconds) return "";
    const d = new Date(tsSeconds * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtFullTime(tsSeconds) {
    if (!tsSeconds) return "";
    const d = new Date(tsSeconds * 1000);
    const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${date} ${time}`;
  }

  // Relative "time ago" for the last-active timestamp.
  function fmtAgo(tsSeconds, nowSeconds) {
    if (!tsSeconds) return "";
    const secs = Math.max(0, Math.floor(nowSeconds - tsSeconds));
    if (secs < 10) return "just now";
    if (secs < 60) return `${secs}s ago`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function shortId(id) {
    return id && id.length > 8 ? id.slice(0, 8) : id || "";
  }

  function currentActivity(session) {
    if (session.lastSummary) return session.lastSummary;
    return session.status === "active" ? "working…" : "idle";
  }

  function render(snapshot) {
    const { sessions, totalActive, totalToolCalls } = snapshot;

    if (!sessions.length) {
      summaryEl.textContent = "No sessions yet.";
      sessionsEl.innerHTML = "";
      emptyEl.classList.add("show");
      return;
    }
    emptyEl.classList.remove("show");
    summaryEl.textContent = `${sessions.length} session${
      sessions.length > 1 ? "s" : ""
    } · ${totalActive} active · ${totalToolCalls} tool calls`;

    sessionsEl.innerHTML = "";
    for (const session of sessions) {
      sessionsEl.appendChild(renderSession(session, snapshot.generatedAt));
    }
  }

  function renderSession(session, nowSeconds) {
    const wrap = document.createElement("div");
    wrap.className = "session" + (expanded.has(session.id) ? " expanded" : "");

    const header = document.createElement("div");
    header.className = "session-header";

    const badge = document.createElement("span");
    badge.className = `badge ${session.status}`;
    header.appendChild(badge);

    const title = document.createElement("div");
    title.className = "session-title";

    // Session name = the generated, conversation-based title.
    const name = document.createElement("div");
    name.className = "session-name";
    name.textContent = session.title || session.cwd || "Claude session";
    name.title = `${session.title || ""}\n${session.cwd || ""}`.trim();

    // Smaller, dimmer line: hash + path (and git branch if present).
    const sub = document.createElement("div");
    sub.className = "session-sub";
    const hash = document.createElement("span");
    hash.className = "session-hash";
    hash.textContent = shortId(session.id);
    hash.title = session.id;
    const pathEl = document.createElement("span");
    pathEl.className = "session-path";
    pathEl.textContent = session.cwd || "";
    pathEl.title = session.cwd || "";
    sub.appendChild(hash);
    sub.appendChild(pathEl);
    if (session.gitBranch && session.gitBranch !== "HEAD") {
      const br = document.createElement("span");
      br.className = "session-branch";
      br.textContent = session.gitBranch;
      sub.appendChild(br);
    }

    // Current action summary.
    const activity = document.createElement("div");
    activity.className = "session-activity";
    activity.textContent = currentActivity(session);

    title.appendChild(name);
    title.appendChild(sub);
    title.appendChild(activity);
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "session-meta";
    const stats = document.createElement("div");
    stats.className = "session-stats";
    const ago = fmtAgo(session.lastActivity, nowSeconds);
    const count = session.entryCount || 0;
    stats.innerHTML = `${ago}<br />${count} entries`;
    stats.title = `Last active ${fmtTime(session.lastActivity)} · ${count} transcript entries`;
    meta.appendChild(stats);

    // Open-in-terminal button: resumes the session in a terminal at its cwd.
    const openBtn = document.createElement("button");
    openBtn.className = "session-open";
    openBtn.title = "Open this session in a terminal";
    openBtn.textContent = "⎘ Open";
    openBtn.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't toggle expand
      vscode.postMessage({
        type: "openSession",
        sessionId: session.id,
        cwd: session.cwd,
        title: session.title,
      });
    });
    meta.appendChild(openBtn);
    header.appendChild(meta);

    header.addEventListener("click", () => {
      if (expanded.has(session.id)) {
        expanded.delete(session.id);
        wrap.classList.remove("expanded");
      } else {
        expanded.add(session.id);
        wrap.classList.add("expanded");
      }
      persistExpanded();
    });

    wrap.appendChild(header);
    wrap.appendChild(renderHistory(session));
    return wrap;
  }

  function renderHistory(session) {
    const box = document.createElement("div");
    box.className = "history";
    // Most recent first.
    const entries = [...session.history].reverse();
    if (!entries.length) {
      const none = document.createElement("div");
      none.className = "history-detail";
      none.textContent = "No activity recorded.";
      box.appendChild(none);
      return box;
    }
    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx];
      const row = document.createElement("div");
      row.className = "history-entry";
      row.dataset.tag = entry.tag || "Tool"; // drives the left color bar + text
      if (entry.kind === "prompt") {
        row.classList.add("is-prompt");
      }

      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = fmtTime(entry.ts);
      time.title = fmtFullTime(entry.ts);

      // Colored action chip (Ran / Edit / Read / Skill / You / …).
      const chip = document.createElement("span");
      chip.className = "history-chip";
      chip.dataset.tag = entry.tag || "Tool";
      chip.textContent = entry.tag || "Tool";

      const content = document.createElement("div");
      content.className = "history-content";

      // The element always holds the FULL text. Collapsed, CSS truncates it to
      // one line with an ellipsis (based on panel width); clicking toggles the
      // `.open` class, which wraps the text and grows the row height.
      const key = `${session.id}#${idx}`;
      const isOpen = expandedRows.has(key);
      const full = entry.fullText || entry.narration || entry.summary;

      const primary = document.createElement("div");
      primary.className = "history-summary expandable" + (isOpen ? " open" : "");
      primary.textContent = full;
      primary.addEventListener("click", () => {
        if (expandedRows.has(key)) {
          expandedRows.delete(key);
          primary.classList.remove("open");
        } else {
          expandedRows.add(key);
          primary.classList.add("open");
        }
        persistExpanded();
      });
      if (entry.subagent) {
        const sub = document.createElement("span");
        sub.className = "history-subagent";
        sub.textContent = "subagent";
        primary.appendChild(document.createTextNode(" "));
        primary.appendChild(sub);
      }
      content.appendChild(primary);

      // For tool actions with narration, show the rule-based summary beneath.
      if (entry.kind !== "prompt" && entry.narration) {
        const detail = document.createElement("span");
        detail.className = "history-detail";
        detail.textContent = entry.summary;
        detail.title = entry.summary;
        content.appendChild(detail);
      }

      row.appendChild(time);
      row.appendChild(chip);
      row.appendChild(content);
      box.appendChild(row);
    }
    return box;
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg && msg.type === "snapshot") {
      render(msg.snapshot);
    }
  });

  vscode.postMessage({ type: "ready" });
})();

// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const summaryEl = document.getElementById("summary-text");
  const sessionsEl = document.getElementById("sessions");
  const emptyEl = document.getElementById("empty");

  // Remember which sessions the user expanded, across re-renders.
  const expanded = new Set((vscode.getState() || {}).expanded || []);

  function persistExpanded() {
    vscode.setState({ expanded: [...expanded] });
  }

  function fmtTime(tsSeconds) {
    if (!tsSeconds) return "";
    const d = new Date(tsSeconds * 1000);
    const date = d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${date} ${time}`;
  }

  function fmtDuration(startSeconds, endSeconds) {
    if (!startSeconds) return "";
    const secs = Math.max(0, Math.floor(endSeconds - startSeconds));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
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
    stats.innerHTML = `${session.toolCalls} tools<br />${fmtDuration(
      session.startedAt,
      nowSeconds
    )}`;
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
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "history-entry";

      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = fmtTime(entry.ts);

      // Content column: Claude's narration (when present) as the primary
      // line, with the rule-based summary as a secondary detail. When there's
      // no narration, the summary stands alone as the primary line.
      const content = document.createElement("div");
      content.className = "history-content";

      const primary = document.createElement("span");
      primary.className = "history-summary";
      primary.textContent = entry.narration || entry.summary;
      primary.title = entry.narration
        ? `${entry.narration}\n(${entry.summary})`
        : entry.summary;
      if (entry.subagent) {
        const tag = document.createElement("span");
        tag.className = "history-tag";
        tag.textContent = "subagent";
        primary.appendChild(document.createTextNode(" "));
        primary.appendChild(tag);
      }
      content.appendChild(primary);

      // Show the mechanical summary too, but only when it adds info beyond
      // the narration (i.e. there was a narration line above it).
      if (entry.narration) {
        const detail = document.createElement("span");
        detail.className = "history-detail";
        detail.textContent = entry.summary;
        detail.title = entry.summary;
        content.appendChild(detail);
      }

      row.appendChild(time);
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

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
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
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
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  function currentActivity(session) {
    if (session.status === "completed") return "session ended";
    if (session.activeSubagents > 0) {
      return `${session.activeSubagents} subagent${
        session.activeSubagents > 1 ? "s" : ""
      } running`;
    }
    if (session.lastTool) return `last: ${session.lastTool}`;
    return session.status === "active" ? "working…" : "idle";
  }

  function cwdName(cwd) {
    if (!cwd) return "unknown";
    const parts = cwd.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || cwd;
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
    const name = document.createElement("div");
    name.className = "session-name";
    name.textContent = `${cwdName(session.cwd)} (${shortId(session.id)})`;
    name.title = `${session.cwd || "unknown"}\n${session.id}`;
    const activity = document.createElement("div");
    activity.className = "session-activity";
    activity.textContent = currentActivity(session);
    title.appendChild(name);
    title.appendChild(activity);
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "session-meta";
    const end =
      session.status === "completed" ? session.lastActivity : nowSeconds;
    meta.innerHTML = `${session.toolCalls} tools<br />${fmtDuration(
      session.startedAt,
      end
    )}`;
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

      const ev = document.createElement("span");
      ev.className = "history-event";
      ev.textContent = entry.tool || entry.event;

      const detail = document.createElement("span");
      detail.className = "history-detail";
      detail.textContent = entry.detail || (entry.tool ? entry.event : "");
      detail.title = detail.textContent;

      row.appendChild(time);
      row.appendChild(ev);
      row.appendChild(detail);
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

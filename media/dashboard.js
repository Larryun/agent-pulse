// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const summaryEl = document.getElementById("summary-text");
  const sessionsEl = document.getElementById("sessions");
  const emptyEl = document.getElementById("empty");
  const filterInput = document.getElementById("filter-input");
  const filterClear = document.getElementById("filter-clear");
  const filterToggle = document.getElementById("filter-toggle");
  const scopesEl = document.getElementById("filter-scopes");

  // Persisted webview state: which sessions / rows are expanded, worklog
  // heights, and the enabled filter scopes.
  const savedState = vscode.getState() || {};
  const expanded = new Set(savedState.expanded || []);
  const expandedRows = new Set(savedState.expandedRows || []);
  const historyHeights = new Map(Object.entries(savedState.historyHeights || {}));

  // Latest snapshot + current filter text/scopes, so typing re-renders without
  // waiting for a new snapshot from the extension. Scopes persist in webview
  // state; query is transient. Scopes is a set of: title | path | worklog.
  let lastSnapshot = null;
  let filterQuery = "";
  const ALL_SCOPES = ["title", "path", "worklog"];
  // Default to all scopes only on first load (no saved value); respect a saved
  // selection as-is, including an empty one.
  const enabledScopes = new Set(
    Array.isArray(savedState.filterScopes)
      ? savedState.filterScopes
      : ALL_SCOPES
  );

  function persistExpanded() {
    vscode.setState({
      expanded: [...expanded],
      expandedRows: [...expandedRows],
      historyHeights: Object.fromEntries(historyHeights),
      filterScopes: [...enabledScopes],
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

  // True if a session matches the query in ANY of the enabled scopes
  // (case-insensitive). Enabled scopes is a set of: title | path | worklog.
  function matchesFilter(session, q) {
    if (!q) return true;
    if (
      enabledScopes.has("title") &&
      (session.title || "").toLowerCase().includes(q)
    ) {
      return true;
    }
    if (
      enabledScopes.has("path") &&
      (session.cwd || "").toLowerCase().includes(q)
    ) {
      return true;
    }
    if (
      enabledScopes.has("worklog") &&
      (session.history || []).some(
        (h) =>
          (h.summary || "").toLowerCase().includes(q) ||
          (h.narration || "").toLowerCase().includes(q) ||
          (h.fullText || "").toLowerCase().includes(q)
      )
    ) {
      return true;
    }
    return false;
  }

  function render(snapshot) {
    if (!snapshot) return;
    lastSnapshot = snapshot;
    const { sessions, totalActive, totalToolCalls } = snapshot;

    if (!sessions.length) {
      summaryEl.textContent = "No sessions yet.";
      sessionsEl.innerHTML = "";
      emptyEl.classList.add("show");
      return;
    }

    const q = filterQuery.trim().toLowerCase();
    const shown = q ? sessions.filter((s) => matchesFilter(s, q)) : sessions;

    emptyEl.classList.remove("show");
    if (q) {
      summaryEl.textContent = `${shown.length} of ${sessions.length} sessions match “${filterQuery.trim()}”`;
    } else {
      summaryEl.textContent = `${sessions.length} session${
        sessions.length > 1 ? "s" : ""
      } · ${totalActive} active · ${totalToolCalls} tool calls`;
    }

    sessionsEl.innerHTML = "";
    if (!shown.length) {
      const none = document.createElement("div");
      none.className = "no-match";
      none.textContent = "No sessions match your filter.";
      sessionsEl.appendChild(none);
      return;
    }
    for (const session of shown) {
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
    // Wrapper holds the scrollable worklog plus a full-width drag bar beneath
    // it. Toggled visible via `.session.expanded .history-wrap`.
    const wrap = document.createElement("div");
    wrap.className = "history-wrap";

    const box = document.createElement("div");
    box.className = "history";
    // Restore a previously dragged height for this session, if any.
    const savedH = historyHeights.get(session.id);
    if (savedH) {
      box.style.height = savedH + "px";
    }

    // Full-width drag handle: grab anywhere along the bottom line to resize.
    const resizer = document.createElement("div");
    resizer.className = "history-resizer";
    resizer.title = "Drag to resize";
    resizer.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const startY = ev.clientY;
      const startH = box.getBoundingClientRect().height;
      document.body.classList.add("row-resizing");
      const onMove = (m) => {
        const h = Math.max(80, Math.min(window.innerHeight * 0.85, startH + (m.clientY - startY)));
        box.style.height = h + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("row-resizing");
        historyHeights.set(session.id, Math.round(box.getBoundingClientRect().height));
        persistExpanded();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Most recent first.
    const entries = [...session.history].reverse();
    if (!entries.length) {
      const none = document.createElement("div");
      none.className = "history-detail";
      none.textContent = "No activity recorded.";
      box.appendChild(none);
      wrap.appendChild(box);
      wrap.appendChild(resizer);
      return wrap;
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
    wrap.appendChild(box);
    wrap.appendChild(resizer);
    return wrap;
  }

  // --- filter input + scope wiring ---
  // Reflect persisted scope state onto the checkboxes on load.
  function syncScopeUI() {
    if (!scopesEl) return;
    for (const cb of scopesEl.querySelectorAll("input[type=checkbox]")) {
      cb.checked = enabledScopes.has(cb.dataset.scope);
    }
  }
  if (filterInput) {
    filterInput.value = filterQuery;
    filterInput.addEventListener("input", () => {
      filterQuery = filterInput.value;
      render(lastSnapshot);
    });
    filterInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        filterQuery = "";
        filterInput.value = "";
        render(lastSnapshot);
      }
    });
  }
  if (filterClear) {
    filterClear.addEventListener("click", () => {
      filterQuery = "";
      if (filterInput) filterInput.value = "";
      render(lastSnapshot);
      if (filterInput) filterInput.focus();
    });
  }
  if (filterToggle && scopesEl) {
    filterToggle.addEventListener("click", () => {
      const collapsed = scopesEl.classList.toggle("collapsed");
      filterToggle.classList.toggle("active", !collapsed);
    });
  }
  if (scopesEl) {
    scopesEl.addEventListener("change", (e) => {
      const cb = e.target.closest("input[type=checkbox]");
      if (!cb) return;
      const scope = cb.dataset.scope;
      if (cb.checked) enabledScopes.add(scope);
      else enabledScopes.delete(scope);
      persistExpanded();
      render(lastSnapshot);
    });
  }
  syncScopeUI();

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg && msg.type === "snapshot") {
      render(msg.snapshot);
    }
  });

  vscode.postMessage({ type: "ready" });
})();

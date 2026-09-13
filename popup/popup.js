// popup/popup.js
// Runs in the toolbar popup. Scrapes the active Gradescope tab via its
// content script, lets the user add the current course to a memory
// (persisted in browser.storage.local), and downloads a single .ics with
// everything in memory.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    currentBody: $("current-body"),
    memoryBadge: $("memory-badge"),
    memoryCount: $("memory-count"),
    courseList: $("course-list"),
    memoryEmpty: $("memory-empty"),
    downloadBtn: $("download-btn"),
    clearBtn: $("clear-btn"),
    error: $("error"),
  };

  const state = {
    current: null, // { courseName, courseId, assignments } or null
    memory: [],    // [{ courseId, courseName, addedAt, assignments: [...] }]
  };

  // ---- storage helpers --------------------------------------------------

  const STORAGE_KEY = "memory_v1";

  async function loadMemory() {
    const out = await browser.storage.local.get(STORAGE_KEY);
    const m = out[STORAGE_KEY];
    return Array.isArray(m) ? m : [];
  }

  async function saveMemory(memory) {
    await browser.storage.local.set({ [STORAGE_KEY]: memory });
  }

  function totalAssignments(memory) {
    return memory.reduce((n, c) => n + (c.assignments ? c.assignments.length : 0), 0);
  }

  function assignmentKey(a) {
    return (a.name || "") + "\u0001" + (a.dueISO || "");
  }

  // Merge a freshly scraped course into memory, deduping by (name, dueISO).
  // Returns { memory, added } where `added` is the number of new assignments.
  function mergeCourse(memory, course) {
    const idx = memory.findIndex((c) => c.courseId && c.courseId === course.courseId);
    const existingKeys = new Set();
    let bucket;
    if (idx >= 0) {
      bucket = memory[idx];
      for (const a of bucket.assignments) existingKeys.add(assignmentKey(a));
    } else {
      bucket = {
        courseId: course.courseId || null,
        courseName: course.courseName || "Course",
        source: course.source || "Gradescope",
        addedAt: new Date().toISOString(),
        assignments: [],
      };
      memory.push(bucket);
    }

    // If the new scrape reveals the course is from a different source than
    // what we have on file, update it so subsequent assignments inherit the
    // correct tzMode.
    if (course.source && bucket.source !== course.source) {
      bucket.source = course.source;
    }

    let added = 0;
    for (const a of course.assignments || []) {
      const k = assignmentKey(a);
      if (existingKeys.has(k)) continue;
      existingKeys.add(k);
      // Backfill tzMode from the bucket's source if the content script
      // didn't provide one.
      const tzMode = a.tzMode || (bucket.source === "Coursera" ? "utc" : "preserve");
      // Annotate assignment with course info so ICS builder can use it.
      bucket.assignments.push({
        ...a,
        source: bucket.source,
        tzMode,
        courseName: bucket.courseName,
        courseId: bucket.courseId,
      });
      added++;
    }
    return { memory, added };
  }

  // ---- scraping the active tab ------------------------------------------

  function isSupportedCourseUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname === "www.gradescope.com" && /^\/courses\/\d+/.test(u.pathname)) {
        return { ok: true, source: "Gradescope" };
      }
      if (u.hostname === "www.coursera.org" && /^\/learn\/[^/]+/.test(u.pathname)) {
        return { ok: true, source: "Coursera" };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }

  async function scrapeActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    const support = isSupportedCourseUrl(tab.url || "");
    if (!support.ok) return null;
    try {
      const resp = await browser.tabs.sendMessage(tab.id, { type: "scrape" });
      if (resp && resp.ok) {
        // Backfill source if the content script didn't set it.
        if (!resp.data.source) resp.data.source = support.source;
        return resp.data;
      }
    } catch (_) {
      // Content script not loaded; user may need to reload the tab.
    }
    return null;
  }

  // ---- rendering --------------------------------------------------------

  function renderCurrent() {
    const body = els.currentBody;
    if (!state.current) {
      body.innerHTML =
        '<p class="muted small">Open a Gradescope or Coursera course page, then reopen the popup.</p>';
      return;
    }
    const { courseName, courseId, assignments } = state.current;
    if (!assignments || assignments.length === 0) {
      body.innerHTML =
        '<p class="muted small">No assignments with due dates on this page.</p>';
      return;
    }
    body.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "current-course";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = courseName;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent =
      assignments.length +
      " assignment" +
      (assignments.length === 1 ? "" : "s") +
      (courseId ? " · " + courseId : "");

    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "+ Add to memory";
    btn.addEventListener("click", onAddClick);

    wrap.append(name, meta, btn);
    body.appendChild(wrap);
  }

  function renderMemory() {
    const total = totalAssignments(state.memory);
    els.memoryCount.textContent =
      total + " assignment" + (total === 1 ? "" : "s") +
      " · " + state.memory.length + " course" + (state.memory.length === 1 ? "" : "s");

    if (total > 0) {
      els.memoryBadge.hidden = false;
      els.memoryBadge.textContent = String(total);
    } else {
      els.memoryBadge.hidden = true;
    }

    els.courseList.innerHTML = "";
    if (state.memory.length === 0) {
      els.memoryEmpty.hidden = false;
    } else {
      els.memoryEmpty.hidden = true;
      for (const c of state.memory) {
        const li = document.createElement("li");
        const info = document.createElement("div");
        info.className = "course-info";
        const name = document.createElement("div");
        name.className = "course-name";
        name.textContent = c.courseName;
        name.title = c.courseName + (c.courseId ? " (" + c.courseId + ")" : "");
        const meta = document.createElement("div");
        meta.className = "course-meta";
        meta.textContent =
          c.assignments.length +
          " event" +
          (c.assignments.length === 1 ? "" : "s") +
          (c.courseId ? " · " + c.courseId : "");
        info.append(name, meta);

        const remove = document.createElement("button");
        remove.className = "icon-btn";
        remove.type = "button";
        remove.title = "Remove " + c.courseName + " from memory";
        remove.textContent = "\u2715"; // ✕
        remove.addEventListener("click", () => onRemoveCourse(c.courseId));

        li.append(info, remove);
        els.courseList.appendChild(li);
      }
    }

    els.downloadBtn.disabled = total === 0;
    els.clearBtn.disabled = state.memory.length === 0;
  }

  function showError(msg) {
    els.error.hidden = false;
    els.error.textContent = msg;
  }
  function clearError() {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  // ---- event handlers ---------------------------------------------------

  async function onAddClick() {
    if (!state.current || !state.current.assignments.length) return;
    clearError();
    const { memory, added } = mergeCourse(state.memory, state.current);
    state.memory = memory;
    await saveMemory(memory);
    renderMemory();

    const btn = els.currentBody.querySelector("button.primary");
    if (btn) {
      btn.textContent = added > 0 ? "\u2713 Added " + added + " new" : "\u2713 Already in memory";
      btn.classList.add("flash");
      setTimeout(() => {
        btn.classList.remove("flash");
        renderCurrent();
      }, 900);
    }
  }

  async function onRemoveCourse(courseId) {
    state.memory = state.memory.filter((c) => c.courseId !== courseId);
    await saveMemory(state.memory);
    renderMemory();
  }

  async function onClearAll() {
    if (state.memory.length === 0) return;
    state.memory = [];
    await saveMemory(state.memory);
    renderMemory();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }

  function flatAssignments(memory) {
    const out = [];
    for (const c of memory) {
      for (const a of c.assignments || []) {
        // Defensive backfill: if a stale or hand-merged memory entry is
        // missing tzMode, infer it from the course's source. Without this,
        // a Coursera assignment would default to the Gradescope "preserve"
        // path and be misinterpreted as America/Chicago wall-clock time,
        // shifting the event by the course's UTC offset.
        const source = a.source || c.source || "Gradescope";
        const tzMode = a.tzMode || (source === "Coursera" ? "utc" : "preserve");
        out.push({
          ...a,
          source,
          tzMode,
          courseName: c.courseName,
          courseId: c.courseId,
        });
      }
    }
    return out;
  }

  function buildDownloadFilename(memory) {
    if (memory.length === 0) return "gradescope.ics";
    if (memory.length === 1) {
      return window.GradescopeICS.safeFilename(memory[0].courseName) + ".ics";
    }
    return (
      "gradescope-" + memory.length + "-courses.ics"
    );
  }

  async function onDownload() {
    if (state.memory.length === 0) return;
    clearError();
    const original = els.downloadBtn.textContent;
    els.downloadBtn.disabled = true;
    els.downloadBtn.textContent = "Building…";
    try {
      const flat = flatAssignments(state.memory);
      const ics = window.GradescopeICS.buildICS(flat);
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const filename = buildDownloadFilename(state.memory);
      downloadBlob(blob, filename);
      els.downloadBtn.textContent = "\u2713 Downloaded";
      setTimeout(() => {
        els.downloadBtn.textContent = original;
        els.downloadBtn.disabled = totalAssignments(state.memory) === 0;
      }, 1200);
    } catch (e) {
      showError("Failed: " + ((e && e.message) || e));
      els.downloadBtn.textContent = original;
      els.downloadBtn.disabled = false;
    }
  }

  // ---- bootstrap --------------------------------------------------------

  els.downloadBtn.addEventListener("click", onDownload);
  els.clearBtn.addEventListener("click", onClearAll);

  // Keep memory in sync if the user changes it in another popup instance.
  if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      const nv = changes[STORAGE_KEY].newValue;
      state.memory = Array.isArray(nv) ? nv : [];
      renderMemory();
    });
  }

  (async function init() {
    state.memory = await loadMemory();
    state.current = await scrapeActiveTab();
    renderMemory();
    renderCurrent();
  })();
})();

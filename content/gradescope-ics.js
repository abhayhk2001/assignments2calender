// content/gradescope-ics.js
// Runs on https://www.gradescope.com/courses/* at document_idle.
// Injects a "Download .ics" toolbar above the assignments table, scrapes
// the rows on click, builds the ICS via window.GradescopeICS, and triggers
// a download via a same-origin blob URL + hidden <a download> element.

(function () {
  "use strict";

  const TOOLBAR_ID = "gradescope-ics-toolbar";
  const BTN_ID = "gradescope-ics-btn";
  const STATUS_ID = "gradescope-ics-status";

  // ---- DOM extraction ----------------------------------------------------

  function getCourseIdFromUrl() {
    const m = location.pathname.match(/^\/courses\/(\d+)/);
    return m ? m[1] : null;
  }

  function getCourseName() {
    const selectors = [
      ".courseHeader--title",
      "h1.courseHeader--title",
      ".courseHeader--heading",
      "h1",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.textContent || "").trim();
        if (t) return t;
      }
    }
    const id = getCourseIdFromUrl();
    return id ? "Course " + id : "Gradescope";
  }

  function scrapeAssignments() {
    const table = document.querySelector("#assignments-student-table");
    if (!table) return [];
    const rows = table.querySelectorAll("tbody tr[role='row']");
    const out = [];
    const courseId = getCourseIdFromUrl();
    const origin = location.origin;

    rows.forEach((row) => {
      const nameCell = row.querySelector("th.table--primaryLink");
      if (!nameCell) return;

      const link = nameCell.querySelector("a[href]");
      const button = nameCell.querySelector("button.js-submitAssignment");

      let name = "";
      let href = "";

      if (link) {
        name = (link.textContent || "").trim();
        href = link.getAttribute("href") || "";
      } else if (button) {
        name = (
          button.getAttribute("data-assignment-title") ||
          (button.textContent || "").trim() ||
          ""
        ).trim();
        const postUrl = button.getAttribute("data-post-url");
        if (postUrl) {
          href = postUrl;
        } else if (courseId) {
          const aid = button.getAttribute("data-assignment-id");
          if (aid) href = "/courses/" + courseId + "/assignments/" + aid;
        }
      }

      if (!name) return;

      const dueEl = row.querySelector("time.submissionTimeChart--dueDate");
      const dueISO = dueEl ? dueEl.getAttribute("datetime") : null;
      if (!dueISO) return;

      const releasedEl = row.querySelector("time.submissionTimeChart--releaseDate");
      const releasedText = releasedEl ? (releasedEl.textContent || "").trim() : "";

      const statusEl = row.querySelector(".submissionStatus--text");
      const status = statusEl ? (statusEl.textContent || "").trim() : "";

      const url = href ? new URL(href, origin).href : origin + location.pathname;

      out.push({ name, dueISO, releasedText, status, url });
    });

    return out;
  }

  function scrapeAll() {
    return {
      courseName: getCourseName(),
      courseId: getCourseIdFromUrl(),
      url: location.href,
      assignments: scrapeAssignments(),
    };
  }

  // ---- UI ----------------------------------------------------------------

  function setStatus(text, kind) {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind || "info";
    el.style.color =
      kind === "ok" ? "#1a7f37" : kind === "error" ? "#cf222e" : "#5a5a6a";
  }

  function buildToolbar() {
    const wrap = document.createElement("div");
    wrap.id = TOOLBAR_ID;
    wrap.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:12px",
      "flex-wrap:wrap",
      "margin:14px 0 10px",
      "padding:10px 14px",
      "background:#f4f5f7",
      "border:1px solid #dcdfe3",
      "border-radius:6px",
      "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    ].join(";");

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Download .ics";
    btn.style.cssText = [
      "appearance:none",
      "background:#2563eb",
      "color:#fff",
      "border:0",
      "padding:8px 16px",
      "border-radius:4px",
      "font:600 14px/1 inherit",
      "cursor:pointer",
      "transition:background .15s ease",
    ].join(";");
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#1d4ed8";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#2563eb";
    });
    btn.addEventListener("click", onDownloadClick);

    const status = document.createElement("span");
    status.id = STATUS_ID;
    status.style.cssText = "color:#5a5a6a;font-size:13px;";

    const link = document.createElement("a");
    link.href = "#";
    link.textContent = "Re-scan table";
    link.style.cssText =
      "margin-left:auto;color:#5a5a6a;font-size:12px;text-decoration:none;";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      updateCount();
    });

    wrap.appendChild(btn);
    wrap.appendChild(status);
    wrap.appendChild(link);
    return wrap;
  }

  function updateCount() {
    const { assignments, courseName } = scrapeAll();
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    if (assignments.length === 0) {
      setStatus("No assignments with due dates found on " + courseName, "error");
    } else {
      setStatus(
        assignments.length +
          " assignment" +
          (assignments.length === 1 ? "" : "s") +
          " on " +
          courseName,
        "info"
      );
    }
  }

  function triggerDownload(blob, filename) {
    // browser.downloads is NOT exposed to content scripts in Firefox/Zen.
    // Use a hidden <a download> instead - same-origin blob URL, so the
    // browser handles the save normally.
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

  async function onDownloadClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Building…";
    btn.style.opacity = "0.7";
    btn.style.cursor = "wait";

    try {
      const data = scrapeAll();
      if (!data.assignments.length) {
        setStatus("Nothing to export.", "error");
        return;
      }
      const ics = window.GradescopeICS.buildICS(data);
      const filename = window.GradescopeICS.safeFilename(data.courseName) + ".ics";
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      triggerDownload(blob, filename);
      setStatus("Downloaded " + filename, "ok");
    } catch (e) {
      setStatus("Failed: " + ((e && e.message) || e), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
      btn.style.opacity = "";
      btn.style.cursor = "";
    }
  }

  // ---- Injection (idempotent + SPA-aware) -------------------------------

  function tryInject() {
    if (document.getElementById(TOOLBAR_ID)) return true;
    const table = document.querySelector("#assignments-student-table");
    if (!table) return false;
    const toolbar = buildToolbar();
    table.parentNode.insertBefore(toolbar, table);
    updateCount();
    return true;
  }

  function boot() {
    if (tryInject()) return;
    // Table may render after us (React/SPA). Watch for it.
    let attempts = 0;
    const obs = new MutationObserver(() => {
      if (tryInject()) {
        obs.disconnect();
        return;
      }
      if (++attempts > 200) obs.disconnect(); // ~20s, then give up
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // DevTools helper.
  if (typeof window !== "undefined") {
    window.__gradescopeICS = { scrapeAll, buildICS: () => window.GradescopeICS.buildICS(scrapeAll()) };
  }
})();

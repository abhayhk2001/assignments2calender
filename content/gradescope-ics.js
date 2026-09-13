// content/gradescope-ics.js
// Runs on https://www.gradescope.com/courses/* at document_idle.
// Listens for "scrape" messages from the popup and returns the course +
// assignments it found on the page.

(function () {
  "use strict";

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

  // ---- Message listener --------------------------------------------------

  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === "scrape") {
        try {
          sendResponse({ ok: true, data: scrapeAll() });
        } catch (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
        }
      }
      return false; // synchronous reply
    });
  }

  // DevTools helper.
  if (typeof window !== "undefined") {
    window.__gradescopeICS = { scrapeAll };
  }
})();

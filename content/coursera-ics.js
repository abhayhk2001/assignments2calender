// content/coursera-ics.js
// Runs on https://www.coursera.org/learn/* at document_idle.
// Scans the page for module sections, filters items with a "Due, …" tag,
// parses the human-readable due date + timezone abbreviation into UTC, and
// replies to { type: "scrape" } messages from the popup.

(function () {
  "use strict";

  // ---- Timezone abbreviation -> offset (minutes from UTC) ---------------
  // Hardcoded map covering the common Coursera cases. Unambiguous by
  // convention; ambiguous ones (e.g. CST) default to the US interpretation.
  const TZ_OFFSETS_MIN = {
    // North America
    HST: -600, AKST: -540, AKDT: -480,
    PST: -480, PDT: -420,
    MST: -420, MDT: -360,
    CST: -360, CDT: -300,
    EST: -300, EDT: -240,
    // Atlantic
    AST: -240, ADT: -180, NST: -210, NDT: -150,
    // Europe / Africa
    GMT: 0, UTC: 0, BST: 60, WET: 0, WEST: 60,
    CET: 60, CEST: 120,
    EET: 120, EEST: 180,
    SAST: 120, CAT: 120, EAT: 180,
    // Middle East / South Asia
    IST: 330,                                  // India Standard Time
    PKT: 300, BDT: 360, NPT: 345,
    // East / SE Asia
    THA: 420, ICT: 420,                       // Thailand
    WIB: 420,                                 // Western Indonesia
    SGT: 480, MYT: 480, PHT: 480,             // Philippines
    HKT: 480, CST_CN: 480,                    // China Standard Time
    JST: 540, KST: 540,
    AEST: 600, AEDT: 660,
    NZST: 720, NZDT: 780,
  };

  function tzOffsetMinutes(abbr) {
    if (!abbr) return 0;
    return Object.prototype.hasOwnProperty.call(TZ_OFFSETS_MIN, abbr)
      ? TZ_OFFSETS_MIN[abbr]
      : 0;
  }

  // ---- Date parsing -----------------------------------------------------

  const MONTH_ABBR = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  // "Due, Sep 13, 11:59 PM CDT" -> { utcISO, localLabel, ok }
  function parseHumanDueDate(text) {
    if (!text) return { ok: false };
    const m = text.match(
      /^\s*Due,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+([A-Za-z]{2,5})\s*$/
    );
    if (!m) return { ok: false };
    const [, monAbbr, dayStr, h12Str, minStr, ampm, tzAbbr] = m;
    const month = MONTH_ABBR[monAbbr.toLowerCase().slice(0, 3)];
    if (!month) return { ok: false };
    const day = parseInt(dayStr, 10);
    const h12 = parseInt(h12Str, 10);
    const minute = parseInt(minStr, 10);
    const hour24 = (h12 % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);

    // Year rollover: assume current year; if more than 1 day in the past, roll forward.
    const now = new Date();
    let year = now.getFullYear();
    const offMin = tzOffsetMinutes(tzAbbr.toUpperCase());
    let actualUTC = computeActualUTC(year, month, day, hour24, minute, offMin);
    if (actualUTC.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
      year += 1;
      actualUTC = computeActualUTC(year, month, day, hour24, minute, offMin);
    }
    // Emit as UTC: the lib/ics.js builder, when tzMode === "utc", will use
    // this instant as the absolute due time without re-applying an offset.
    const iso = formatICSAsUTC(actualUTC);

    return {
      ok: true,
      dueISO: iso,
      localLabel: text.replace(/^\s*Due,\s*/i, "").trim(),
      tzAbbr: tzAbbr.toUpperCase(),
    };
  }

  function computeActualUTC(year, month, day, hour, minute, offsetMinutes) {
    // Wall-clock components are interpreted in a zone with the given offset;
    // subtracting the offset from the equivalent UTC instant yields the true UTC time.
    const localAsUTC = new Date(Date.UTC(year, month - 1, day, hour, minute));
    return new Date(localAsUTC.getTime() - offsetMinutes * 60 * 1000);
  }

  // Format a Date as "YYYY-MM-DD HH:MM:SS +0000" so the lib/ics.js parser
  // treats it as an absolute UTC instant.
  function formatICSAsUTC(d) {
    return (
      d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) +
      " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds()) +
      " +0000"
    );
  }

  // ---- Course context ---------------------------------------------------

  function getCourseSlugFromUrl() {
    const m = location.pathname.match(/^\/learn\/([^/]+)/);
    return m ? m[1] : null;
  }

  function titleCaseFromSlug(slug) {
    if (!slug) return "Coursera Course";
    // Drop common course-code prefix and turn dashes into spaces.
    const cleaned = slug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
    // Uppercase patterns like "cs 447" -> "CS 447".
    return cleaned.replace(
      /\b([a-z]{2,4})\s+(\d+)\b/gi,
      (_, a, b) => a.toUpperCase() + " " + b
    );
  }

  function getCourseName() {
    const sels = [
      'h1[class*="cds-"]',
      '[data-e2e="course-name"]',
      ".rc-CourseTitle",
      "h1",
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.textContent || "").trim();
        if (t) return t;
      }
    }
    return titleCaseFromSlug(getCourseSlugFromUrl());
  }

  // ---- Module context ---------------------------------------------------

  function getModuleTitle(sectionEl) {
    const labelledBy = sectionEl.getAttribute("aria-labelledby");
    if (labelledBy) {
      const h = sectionEl.querySelector("h2#" + CSS.escape(labelledBy)) ||
                document.getElementById(labelledBy);
      if (h) return (h.textContent || "").trim();
    }
    const h2 = sectionEl.querySelector("h2");
    return h2 ? (h2.textContent || "").trim() : "";
  }

  function extractWeekLabel(moduleTitle) {
    if (!moduleTitle) return "";
    const m = moduleTitle.match(/\bWeek\s+(\d+)\b/i);
    return m ? "Week " + m[1] : "";
  }

  // ---- Per-item extraction ---------------------------------------------

  function scrapeItem(li, weekLabel) {
    const nameEl = li.querySelector('[data-test="rc-ItemName"]');
    if (!nameEl) return null;
    const name = (nameEl.textContent || "").trim();
    if (!name) return null;

    // Find the status tag. The visible label is in span.css-t1fcku; the
    // visually-hidden version is a reliable fallback.
    const tag = li.querySelector('[data-testid="tag-root"]');
    let dueText = "";
    if (tag) {
      const visible = tag.querySelector(".css-t1fcku, [class*='css-t1fcku']");
      if (visible) dueText = (visible.textContent || "").trim();
      if (!dueText || !/^Due,/i.test(dueText)) {
        const hidden = tag.querySelector('[data-testid="visually-hidden"]');
        if (hidden) {
          const t = (hidden.textContent || "").trim();
          const m = t.match(/Due,[^.]*/i);
          if (m) dueText = m[0].trim();
        }
      }
    }
    if (!dueText || !/^Due,/i.test(dueText)) return null;

    const metaEl = li.querySelector('[class*="css-vac8rf"]');
    const meta = metaEl ? (metaEl.textContent || "").trim() : "";

    const linkEl = li.querySelector("a[href]");
    const href = linkEl ? linkEl.getAttribute("href") || "" : "";
    const url = href ? new URL(href, location.origin).href : location.href;

    const type = li.getAttribute("data-test") || "";

    const parsed = parseHumanDueDate(dueText);
    if (!parsed.ok) return null;

    return {
      name,
      type,
      meta,
      week: weekLabel,
      dueISO: parsed.dueISO,
      dueLocalLabel: parsed.localLabel,
      tzAbbr: parsed.tzAbbr,
      tzMode: "utc", // dueISO is already in absolute UTC; do NOT re-zone via VTIMEZONE.
      url,
    };
  }

  // ---- Top-level scrape -------------------------------------------------

  function scrapeAll() {
    const sections = document.querySelectorAll("section.rc-ModuleSection");
    const out = [];
    const seen = new Set(); // dedup within a single page render

    sections.forEach((section) => {
      const moduleTitle = getModuleTitle(section);
      const weekLabel = extractWeekLabel(moduleTitle);
      const items = section.querySelectorAll("li.rc-WeekSingleItemDisplayRefresh");
      items.forEach((li) => {
        const a = scrapeItem(li, weekLabel);
        if (!a) return;
        const key = a.name + "\u0001" + a.dueISO + "\u0001" + a.type;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(a);
      });
    });

    return {
      courseName: getCourseName(),
      courseId: getCourseSlugFromUrl() || "coursera",
      source: "Coursera",
      assignments: out,
    };
  }

  // ---- Message listener -------------------------------------------------

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
    window.__courseraICS = { scrapeAll, parseHumanDueDate };
  }
})();

// lib/ics.js
// Minimal, dependency-free ICS (RFC 5545) builder for Gradescope assignments.
// Exposes a single global: window.GradescopeICS.buildICS(payload)

(function (global) {
  "use strict";

  const CRLF = "\r\n";
  const TZID = "America/Chicago";
  const PRODID = "-//Gradescope to ICS//EN";

  // ---- Helpers -----------------------------------------------------------

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatUTC(d) {
    return (
      d.getUTCFullYear() +
      pad2(d.getUTCMonth() + 1) +
      pad2(d.getUTCDate()) +
      "T" +
      pad2(d.getUTCHours()) +
      pad2(d.getUTCMinutes()) +
      pad2(d.getUTCSeconds()) +
      "Z"
    );
  }

  // Parse "YYYY-MM-DD HH:MM:SS -0500" -> { local, offsetMinutes, y, m, d, h, mi, s }
  function parseCourseDateTime(s) {
    if (!s) return null;
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-])(\d{2})(\d{2})$/
    );
    if (!m) return null;
    const [, y, mo, d, h, mi, se, sign, oh, om] = m;
    return {
      local:
        y + mo + d + "T" + h + mi + (se || "00"),
      offsetMinutes:
        (sign === "+" ? 1 : -1) * (parseInt(oh, 10) * 60 + parseInt(om, 10)),
      y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: se ? +se : 0,
    };
  }

  // Build a UTC Date from parsed local-time + offset.
  function parsedToUTC(p) {
    return new Date(
      Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - p.offsetMinutes * 60 * 1000
    );
  }

  // Add minutes within the same fixed offset, returning a same-shaped object.
  function addMinutes(p, minutes) {
    const utc = parsedToUTC(p);
    const shifted = new Date(utc.getTime() + minutes * 60 * 1000);
    const iso = new Date(shifted.getTime() + p.offsetMinutes * 60 * 1000)
      .toISOString()
      .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    return {
      local: iso[1] + iso[2] + iso[3] + "T" + iso[4] + iso[5] + iso[6],
      offsetMinutes: p.offsetMinutes,
      y: +iso[1], mo: +iso[2], d: +iso[3],
      h: +iso[4], mi: +iso[5], s: +iso[6],
    };
  }

  // Synchronous djb2 hash (base36) for stable, short UIDs.
  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  // RFC 5545 §3.3.11 text escaping.
  function escapeText(s) {
    if (s == null) return "";
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  // RFC 5545 §3.1 line folding: max 75 octets per physical line, continuation
  // lines start with a single SP. We approximate 1 octet per ASCII codepoint.
  function fold(line) {
    if (line.length <= 75) return line;
    const parts = [];
    let i = 0;
    while (i < line.length) {
      const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
      parts.push(i === 0 ? chunk : " " + chunk);
      i += chunk.length;
    }
    return parts.join(CRLF);
  }

  function out(lines) {
    return lines.map(fold).join(CRLF) + CRLF;
  }

  // ---- Static VTIMEZONE for America/Chicago ------------------------------

  const VTIMEZONE_LINES = [
    "BEGIN:VTIMEZONE",
    "TZID:" + TZID,
    "X-LIC-LOCATION:" + TZID,
    "BEGIN:STANDARD",
    "DTSTART:18831118T120000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0600",
    "TZNAME:CST",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19180331T020000",
    "TZOFFSETFROM:-0600",
    "TZOFFSETTO:-0500",
    "TZNAME:CDT",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];

  // ---- Event builder -----------------------------------------------------

  function buildEventLines(assignment, courseName) {
    const due = parseCourseDateTime(assignment.dueISO);
    if (!due) return null;

    // Event runs from 2 hours before the deadline to the deadline itself,
    // so the calendar block visually leads up to the due time.
    const start = addMinutes(due, -120).local;
    const end = due.local;
    const uid =
      djb2(courseName + "|" + assignment.name + "|" + assignment.dueISO) +
      "-gradescope-ics@local";

    const descParts = ["Course: " + courseName];
    if (assignment.status) descParts.push("Status: " + assignment.status);
    if (assignment.releasedText) descParts.push("Released: " + assignment.releasedText);
    if (assignment.url) descParts.push("Link: " + assignment.url);

    const lines = [
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + formatUTC(new Date()),
      "DTSTART;TZID=" + TZID + ":" + start,
      "DTEND;TZID=" + TZID + ":" + end,
      "SUMMARY:" + escapeText(courseName + " — " + assignment.name),
      "DESCRIPTION:" + escapeText(descParts.join("\n")),
    ];
    if (assignment.url) lines.push("URL:" + assignment.url);
    lines.push("CATEGORIES:" + escapeText("Gradescope") + "," + escapeText(courseName));

    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P1D",
      "DESCRIPTION:" + escapeText(assignment.name + " due tomorrow"),
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT2H",
      "DESCRIPTION:" + escapeText(assignment.name + " due in 2 hours"),
      "END:VALARM"
    );

    lines.push("END:VEVENT");
    return lines;
  }

  // ---- Top-level builder -------------------------------------------------

  function buildICS(payload) {
    const { courseName, courseId, assignments } = payload || {};
    if (!Array.isArray(assignments) || assignments.length === 0) {
      throw new Error("No assignments to export.");
    }
    const calName =
      (courseName && courseName.trim()) || (courseId ? "Course " + courseId : "Gradescope");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:" + PRODID,
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + escapeText(calName + " (Gradescope)"),
      "X-WR-TIMEZONE:" + TZID,
      ...VTIMEZONE_LINES,
    ];

    for (const a of assignments) {
      const ev = buildEventLines(a, calName);
      if (ev) lines.push(...ev);
    }

    lines.push("END:VCALENDAR");
    return out(lines);
  }

  function safeFilename(name) {
    return (
      (name || "gradescope")
        .replace(/[\\/:*?"<>|]+/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "gradescope"
    );
  }

  global.GradescopeICS = {
    buildICS,
    safeFilename,
    _parseCourseDateTime: parseCourseDateTime,
    _escapeText: escapeText,
  };
})(typeof window !== "undefined" ? window : globalThis);

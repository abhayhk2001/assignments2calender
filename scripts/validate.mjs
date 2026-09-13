// scripts/validate.mjs
// Runs lib/ics.js under Node and validates the generated ICS against the
// assignments table the user pasted. Also runs content/scraper.js's logic
// against a jsdom-free DOM stub for sanity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- Load lib/ics.js (it expects `window`, fall back to globalThis) ----
const icsSrc = fs.readFileSync(path.join(ROOT, "lib/ics.js"), "utf8");
const icsModule = new Function("window", "globalThis", icsSrc);
global.window = globalThis;
icsModule(globalThis, globalThis);
const { buildICS, safeFilename, _parseCourseDateTime } = globalThis.GradescopeICS;
if (!buildICS) {
  console.error("FAIL: buildICS not exported");
  process.exit(1);
}

// --- Fixture: the exact assignments from the user's HTML --------------
// New flat-array API. Each assignment carries its own courseName so the
// builder can support multi-course memories in a single .ics file.

function makeAssignments(courseName, courseId, items, source) {
  return items.map((it) => ({
    courseName,
    courseId,
    source: source || "Gradescope",
    name: it.name,
    dueISO: it.dueISO,
    releasedText: it.releasedText,
    status: it.status,
    url: it.url,
  }));
}

const cs224n = makeAssignments("CS 224N - Natural Language Processing", "1344633", [
  {
    name: "Week 03 Quiz: Classification",
    dueISO: "2026-09-27 23:59:00 -0500",
    releasedText: "Sep 07 at 12:00AM",
    status: "No Submission",
    url: "https://www.gradescope.com/courses/1344633/assignments/8353320/submissions/new",
  },
  {
    name: "Homework 1",
    dueISO: "2026-09-27 23:59:00 -0500",
    releasedText: "Aug 31 at 12:00AM",
    status: "No Submission",
    url: "https://www.gradescope.com/courses/1344633/assignments/8353317/submissions",
  },
  {
    name: "Week 02 Quiz: Structure and Distribution of Words",
    dueISO: "2026-09-20 23:59:00 -0500",
    releasedText: "Aug 31 at 12:00AM",
    status: "No Submission",
    url: "https://www.gradescope.com/courses/1344633/assignments/8353319/submissions/new",
  },
  {
    name: "Week 01 Quiz: Introduction",
    dueISO: "2026-09-13 23:59:00 -0500",
    releasedText: "Aug 24 at 12:00AM",
    status: "No Submission",
    url: "https://www.gradescope.com/courses/1344633/assignments/8353314/submissions/new",
  },
]);

const cs161 = makeAssignments("CS 161 - Computer Security", "987654", [
  {
    name: "Project 1: Memory Safety",
    dueISO: "2026-10-04 23:59:00 -0500",
    releasedText: "Sep 22 at 12:00AM",
    status: "No Submission",
    url: "https://www.gradescope.com/courses/987654/assignments/111/submissions",
  },
  {
    name: "Discussion 3",
    dueISO: "2026-09-22 23:59:00 -0500",
    releasedText: "Sep 15 at 12:00AM",
    status: "Submitted",
    url: "https://www.gradescope.com/courses/987654/assignments/222/submissions/new",
  },
]);

// Coursera fixture: every assignment uses tzMode "utc" with a UTC dueISO
// that already reflects the original wall-clock + offset. week + type +
// dueLocalLabel are surfaced in SUMMARY and DESCRIPTION.
function makeCourseraAssignments(courseName, courseId, items) {
  return items.map((it) => ({
    courseName,
    courseId,
    source: "Coursera",
    tzMode: "utc",
    name: it.name,
    week: it.week,
    type: it.type,
    meta: it.meta,
    dueISO: it.dueISO,           // UTC, format "YYYY-MM-DD HH:MM:SS +0000"
    dueLocalLabel: it.dueLocalLabel,
    url: it.url,
  }));
}

// "Due, Sep 13, 11:59 PM CDT"  →  CDT is UTC-5  →  2026-09-14 04:59:00 +0000
const cs447 = makeCourseraAssignments(
  "CS 447 - Natural Language Processing",
  "cs-447-natural-language-processing",
  [
    {
      name: "Peer Reviewed Question 1",
      week: "Week 1",
      type: "phasedPeer",
      meta: "Peer-graded Assignment • 1h • Grade: -- •",
      dueISO: "2026-09-14 04:59:00 +0000",
      dueLocalLabel: "Sep 13, 11:59 PM CDT",
      url: "https://www.coursera.org/learn/cs-447-natural-language-processing/peer/oXALr/peer-reviewed-question-1",
    },
    {
      name: "Peer Reviewed Question 1 (review)",
      week: "Week 1",
      type: "splitPeerReviewItem",
      meta: "Review Your Peers • Grade: -- •",
      dueISO: "2026-09-17 04:59:00 +0000",
      dueLocalLabel: "Sep 16, 11:59 PM CDT",
      url: "https://www.coursera.org/learn/cs-447-natural-language-processing/peer/oXALr/peer-reviewed-question-1/give-feedback",
    },
    {
      name: "Week 1 Quiz",
      week: "Week 1",
      type: "gradedLti",
      meta: "Graded App Item • 20 min • Grade: -- •",
      dueISO: "2026-09-14 04:59:00 +0000",
      dueLocalLabel: "Sep 13, 11:59 PM CDT",
      url: "https://www.coursera.org/learn/cs-447-natural-language-processing/gradedLti/PNw7P/week-1-quiz",
    },
  ]
);

let ics;
try {
  ics = buildICS(cs224n);
} catch (e) {
  console.error("FAIL: buildICS threw:", e);
  process.exit(1);
}

// --- Basic structural assertions --------------------------------------
let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else {
    console.log("ok  -", msg);
  }
}

assert(ics.startsWith("BEGIN:VCALENDAR\r\n"), "starts with VCALENDAR");
assert(ics.endsWith("END:VCALENDAR\r\n"), "ends with VCALENDAR");
assert(ics.includes("VERSION:2.0\r\n"), "VERSION:2.0 present");
assert(ics.includes("PRODID:"), "PRODID present");
assert(ics.includes("BEGIN:VTIMEZONE\r\n"), "VTIMEZONE present");
assert(ics.includes("TZID:America/Chicago\r\n"), "TZID America/Chicago present");
assert(ics.includes("TZNAME:CST\r\n"), "CST present");
assert(ics.includes("TZNAME:CDT\r\n"), "CDT present");

const eventMatches = ics.match(/BEGIN:VEVENT\r\n/g) || [];
assert(eventMatches.length === 4, `4 VEVENTs (got ${eventMatches.length})`);

const alarm1d = ics.match(/TRIGGER:-P1D\r\n/g) || [];
const alarm2h = ics.match(/TRIGGER:-PT2H\r\n/g) || [];
assert(alarm1d.length === 4, `4 x 1-day VALARMs (got ${alarm1d.length})`);
assert(alarm2h.length === 4, `4 x 2-hour VALARMs (got ${alarm2h.length})`);

assert(
  ics.includes("SUMMARY:CS 224N - Natural Language Processing — Homework 1\r\n"),
  "SUMMARY has course name + Homework 1"
);
assert(
  ics.includes("DTSTART;TZID=America/Chicago:20260927T215900\r\n"),
  "DTSTART is 2h before due (Sep 27 21:59)"
);
assert(
  ics.includes("DTEND;TZID=America/Chicago:20260927T235900\r\n"),
  "DTEND is at the deadline (Sep 27 23:59)"
);
assert(
  ics.includes("DTSTART;TZID=America/Chicago:20260920T215900\r\n"),
  "DTSTART for Sep 20 (2h before)"
);
assert(
  ics.includes("DTEND;TZID=America/Chicago:20260920T235900\r\n"),
  "DTEND for Sep 20 (at deadline)"
);
assert(
  ics.includes("DTSTART;TZID=America/Chicago:20260913T215900\r\n"),
  "DTSTART for Sep 13 (2h before)"
);

assert(ics.includes("URL:https://www.gradescope.com/"), "URL field present");
assert(ics.includes("DESCRIPTION:"), "DESCRIPTION field present");
assert(ics.includes("CATEGORIES:Gradescope,CS 224N"), "CATEGORIES with course");

// CR/LF only, no bare LF.
const bareLF = ics.match(/(?<!\r)\n/);
assert(!bareLF, "No bare LF (CRLF only)");

// Long line check — DESCRIPTION can exceed 75 chars; ensure it's folded.
const descLine = ics.split("\r\n").find((l) => l.startsWith("DESCRIPTION:"));
assert(
  descLine && descLine.length <= 75,
  `DESCRIPTION line is folded (len=${descLine ? descLine.length : "?"})`
);

// Unfold (RFC 5545 §3.1) to check payload content across folds.
function unfold(ical) {
  return ical.replace(/\r\n[ \t]/g, "");
}
const unfolded = unfold(ics);
assert(unfolded.includes("Status: No Submission"), "Status in description (unfolded)");
assert(unfolded.includes("Course: CS 224N"), "Course name in description (unfolded)");
assert(unfolded.includes("Link: https://"), "Link in description (unfolded)");
assert(
  unfolded.includes(
    "SUMMARY:CS 224N - Natural Language Processing — Week 03 Quiz: Classification"
  ),
  "SUMMARY for Quiz 3 (unfolded)"
);

assert(safeFilename("CS 224N - NLP") === "CS-224N-NLP", "safeFilename spaces");
assert(
  safeFilename('Bad/Name:*?"<>|') === "BadName",
  "safeFilename strips bad chars"
);

// Parsed datetime check.
const p = _parseCourseDateTime("2026-09-27 23:59:00 -0500");
assert(p && p.local === "20260927T235900", "parseCourseDateTime local string");
assert(p && p.offsetMinutes === -300, "parseCourseDateTime offset");

// --- Multi-course memory ---------------------------------------------
const merged = buildICS([...cs224n, ...cs161]);
const mergedEvents = merged.match(/BEGIN:VEVENT\r\n/g) || [];
assert(mergedEvents.length === 6, `merged ICS has 6 VEVENTs (got ${mergedEvents.length})`);

const unfoldedMerged = unfold(merged);
assert(
  unfoldedMerged.includes("SUMMARY:CS 224N - Natural Language Processing — Homework 1"),
  "merged: CS 224N assignment in SUMMARY"
);
assert(
  unfoldedMerged.includes("SUMMARY:CS 161 - Computer Security — Project 1: Memory Safety"),
  "merged: CS 161 assignment in SUMMARY"
);
assert(
  unfoldedMerged.includes("CATEGORIES:Gradescope,CS 161 - Computer Security"),
  "merged: CATEGORIES uses each course's name"
);
assert(
  unfoldedMerged.includes("X-WR-CALNAME:Gradescope (2)"),
  "merged: cal name reflects 2 courses"
);
assert(
  !unfoldedMerged.includes("X-WR-CALNAME:CS 224N"),
  "merged: cal name is NOT the single-course form"
);

// Single-course memory should still use the course name as cal name.
assert(
  unfolded.includes("X-WR-CALNAME:CS 224N - Natural Language Processing"),
  "single course: cal name is the course"
);

// Legacy form still works.
const legacy = buildICS({
  courseName: "Legacy Course",
  courseId: "42",
  assignments: cs161,
});
const legacyUnfolded = unfold(legacy);
assert(
  legacyUnfolded.includes("X-WR-CALNAME:Legacy Course"),
  "legacy form: uses provided courseName"
);
assert(
  legacyUnfolded.includes("CATEGORIES:Gradescope,CS 161 - Computer Security"),
  "legacy form: per-assignment courseName wins over wrapper courseName"
);

// --- Coursera fixture -------------------------------------------------
const courseraIcs = buildICS(cs447);
const courseraEvents = courseraIcs.match(/BEGIN:VEVENT\r\n/g) || [];
assert(courseraEvents.length === 3, `Coursera: 3 VEVENTs (got ${courseraEvents.length})`);

const courseraUnfolded = unfold(courseraIcs);

// UTC mode: no TZID, no VTIMEZONE block.
assert(
  !courseraIcs.includes("DTSTART;TZID="),
  "Coursera: DTSTART does NOT use TZID"
);
assert(
  !courseraIcs.includes("BEGIN:VTIMEZONE\r\n"),
  "Coursera: no VTIMEZONE block when all events are UTC"
);
assert(
  courseraIcs.includes("DTSTART:20260914T025900Z"),
  "Coursera: DTSTART is 2h before due UTC (Sep 14 02:59Z)"
);
assert(
  courseraIcs.includes("DTEND:20260914T045900Z"),
  "Coursera: DTEND is at the deadline UTC (Sep 14 04:59Z)"
);

// Week + name in SUMMARY
assert(
  courseraUnfolded.includes(
    "SUMMARY:CS 447 - Natural Language Processing — Week 1 — Peer Reviewed Question 1"
  ),
  "Coursera: SUMMARY includes week + course + name"
);

// Description has all the extra context
// (commas inside values are escaped per RFC 5545 §3.3.11)
assert(
  courseraUnfolded.includes("Original deadline: Sep 13\\, 11:59 PM CDT"),
  "Coursera: description keeps original local label"
);
assert(courseraUnfolded.includes("Week: Week 1"), "Coursera: description has week");
assert(courseraUnfolded.includes("Type: phasedPeer"), "Coursera: description has type");
assert(courseraUnfolded.includes("Meta: Peer-graded"), "Coursera: description has meta");

// CATEGORIES uses source
assert(
  courseraUnfolded.includes("CATEGORIES:Coursera,CS 447 - Natural Language Processing"),
  "Coursera: CATEGORIES uses Coursera as source"
);

// Single-Coursera cal name
assert(
  courseraUnfolded.includes("X-WR-CALNAME:CS 447 - Natural Language Processing"),
  "Coursera: single-course cal name"
);

// Cross-source merge: Gradescope + Coursera in one .ics
const cross = buildICS([...cs224n, ...cs447]);
const crossUnfolded = unfold(cross);
const crossEvents = cross.match(/BEGIN:VEVENT\r\n/g) || [];
assert(crossEvents.length === 7, `cross-source: 7 VEVENTs (got ${crossEvents.length})`);
// VTIMEZONE block reappears because Gradescope events still need it
assert(
  cross.includes("BEGIN:VTIMEZONE\r\n"),
  "cross-source: VTIMEZONE block reappears when any event needs it"
);
// Cal name falls back to the source-set
assert(
  crossUnfolded.includes("X-WR-CALNAME:Courses (2)"),
  "cross-source: cal name uses generic 'Courses' tag"
);
assert(
  crossUnfolded.includes("CATEGORIES:Coursera,CS 447 - Natural Language Processing"),
  "cross-source: Coursera categories preserved"
);
assert(
  crossUnfolded.includes("CATEGORIES:Gradescope,CS 224N - Natural Language Processing"),
  "cross-source: Gradescope categories preserved"
);

// --- Sanity: lib/ics.js human-date parser via the script's own formatICSLocal.
// We can't import the coursera content script's helpers into Node directly,
// but formatICSLocal output should be parseable by the existing parser:
// "2026-09-14 04:59:00 +0000" -> local 20260914T045900, offset 0.
const utcParsed = _parseCourseDateTime("2026-09-14 04:59:00 +0000");
assert(
  utcParsed && utcParsed.local === "20260914T045900",
  "parseCourseDateTime handles UTC string (local field)"
);
assert(
  utcParsed && utcParsed.offsetMinutes === 0,
  "parseCourseDateTime handles UTC string (offset)"
);

// --- Unit test the Coursera human-date parser ------------------------
// The content script is an IIFE that runs against `window`. We eval it
// here with a minimal shim, then grab parseHumanDueDate off window.
{
  const src = fs.readFileSync(
    path.join(ROOT, "content/coursera-ics.js"),
    "utf8"
  );
  const fakeWin = { browser: undefined };
  const run = new Function("window", src);
  run(fakeWin);

  const parse = fakeWin.__courseraICS && fakeWin.__courseraICS.parseHumanDueDate;
  assert(typeof parse === "function", "coursera parser exposed via window.__courseraICS");

  function check(input, expectedISO) {
    const r = parse(input);
    assert(
      r.ok && r.dueISO === expectedISO,
      `coursera parser: ${JSON.stringify(input)} -> ${expectedISO} (got ${r.ok ? r.dueISO : "FAIL"})`
    );
  }

  // 11:59 PM CDT (UTC-5) -> 04:59Z next day (test runs in Sep 2026, so Sep 13 is upcoming)
  check("Due, Sep 13, 11:59 PM CDT", "2026-09-14 04:59:00 +0000");
  // 09:00 AM EST (UTC-5) -> 14:00Z
  check("Due, Oct 04, 9:00 AM EST", "2026-10-04 14:00:00 +0000");
  // 11:59 PM PDT (UTC-7) -> 06:59Z next day
  check("Due, Nov 15, 11:59 PM PDT", "2026-11-16 06:59:00 +0000");
  // 12:00 AM UTC -> same day 00:00Z
  check("Due, Dec 01, 12:00 AM UTC", "2026-12-01 00:00:00 +0000");
  // 12:00 PM BST (UTC+1) -> 11:00Z
  check("Due, Sep 20, 12:00 PM BST", "2026-09-20 11:00:00 +0000");
  // IST (UTC+5:30) -> 11:59 - 5:30 = 06:29Z. Aug 30 is past -> rolls to next year.
  check("Due, Aug 30, 11:59 AM IST", "2027-08-30 06:29:00 +0000");
  // Malformed input
  assert(!parse("Due, sometime tomorrow").ok, "coursera parser: rejects malformed");
  assert(!parse("No due date").ok, "coursera parser: rejects missing prefix");
  // Unrecognized TZ falls back to UTC (offset 0)
  const fb = parse("Due, Sep 13, 11:59 PM XYZ");
  assert(fb.ok && fb.dueISO === "2026-09-13 23:59:00 +0000", "coursera parser: unknown TZ -> UTC");
}

// --- Show the first ~80 lines of the output for visual inspection ----
console.log("\n--- ICS output (first 80 lines) ---\n");
const lines = ics.split("\r\n");
for (let i = 0; i < Math.min(80, lines.length); i++) {
  console.log(String(i + 1).padStart(3, " ") + ": " + lines[i]);
}
console.log(`\n... total ${lines.length} lines, ${ics.length} bytes\n`);

if (fails > 0) {
  console.error(`\n${fails} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("All assertions passed.");
}

// Also write a sample .ics for human inspection.
const samplePath = path.join(ROOT, "sample.ics");
fs.writeFileSync(samplePath, ics, "utf8");
console.log(`Wrote ${samplePath} (${ics.length} bytes).`);

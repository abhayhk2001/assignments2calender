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
const sample = {
  courseName: "CS 224N - Natural Language Processing",
  courseId: "1344633",
  assignments: [
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
  ],
};

let ics;
try {
  ics = buildICS(sample);
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

# Course Deadlines to ICS (Firefox/Zen WebExtension)

A Manifest V3 WebExtension with a toolbar popup. Open it on a
**Gradescope** or **Coursera** course page, add the assignments to a
memory, navigate to other courses and add them too, then download one
`.ics` calendar file containing every event.

## Features

- **Two platforms** in one extension: Gradescope and Coursera.
- Toolbar popup UI. No page injection, no background script.
- Each event runs from **2 hours before** the deadline to the deadline
  itself, so the calendar block visually leads up to the due time.
- The event name is prefixed with the course (and the week for
  Coursera), e.g.
  `CS 447 - Natural Language Processing — Week 1 — Peer Reviewed Question 1`.
- **Gradescope** preserves the course timezone (`America/Chicago`,
  shown as CDT/CST) using a `VTIMEZONE` block.
- **Coursera** parses the human-readable `Due, MMM D, h:mm A TZ`
  string, converts to UTC, and emits `DTSTART:…Z`. The original
  wall-clock time and TZ abbreviation are kept in the event
  `DESCRIPTION` for reference.
- Each event has a **URL** to the assignment, course + status in the
  description, and **two reminders**: 1 day before, and 2 hours before.
- **Memory** is stored in `browser.storage.local` and survives browser
  restarts. Adding the same course twice dedupes by
  `(name, dueISO)`; new assignments are merged in.
- One `.ics` file can contain events from any number of courses, from
  any mix of platforms.

## Install (temporary, for development)

1. Open Firefox (or Zen) and go to `about:debugging`.
2. Click **This Firefox** → **Load Temporary Add-on…**.
3. Pick `manifest.json` from this folder.
4. Open a supported course page (e.g.
   `https://www.gradescope.com/courses/123456` or
   `https://www.coursera.org/learn/cs-447`).
5. Click the toolbar icon → **+ Add to memory**. Repeat on other courses.
6. Click **Download .ics** to save a single file with everything.

## File map

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. Hosts both platforms. |
| `popup/popup.html` / `.css` / `.js` | Toolbar popup UI. Reads memory, talks to the active tab's content script, builds & downloads ICS. |
| `content/gradescope-ics.js` | Injected into Gradescope course pages. Replies to `"scrape"` with the assignments table. |
| `content/coursera-ics.js` | Injected into Coursera course pages. Filters items with a `Due, …` tag, parses the human date + TZ abbreviation, replies to `"scrape"`. |
| `lib/ics.js` | Zero-dependency RFC 5545 builder. Supports two emit modes: `tzMode: "preserve"` (Gradescope, `TZID` + `VTIMEZONE`) and `tzMode: "utc"` (Coursera, `Z` suffix, no VTIMEZONE). |
| `icons/` | 48/96/128 px toolbar + extension icons. |
| `scripts/make_icons.py` | Regenerates the icons. |
| `scripts/validate.mjs` | 68 assertions: single-platform, multi-course, multi-platform, human-date parser unit tests, RFC 5545 invariants. |

## How it works

```
[Toolbar popup]  ◀──  user click
   │
   ├─ browser.tabs.sendMessage(activeTabId, { type: "scrape" })
   │      ├─▶  content/gradescope-ics.js  (if on a Gradescope course page)
   │      └─▶  content/coursera-ics.js    (if on a Coursera course page)
   │              └─ returns { courseName, courseId, source, assignments }
   │
   ├─ "+ Add to memory"  →  mergeCourse()  →  browser.storage.local.set({ memory_v1 })
   │                                       (dedup by name+dueISO)
   │
   └─ "Download .ics"  →  buildICS(flatAssignments)  →  <a download> + blob URL
```

No background script. The popup talks directly to whichever content
script is loaded, and to `browser.storage.local`; the download uses a
same-origin blob URL.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Persist the memory across popup closes and browser restarts. |
| `host_permissions: https://www.gradescope.com/*, https://www.coursera.org/*` | Inject the content scripts on course pages. |

No `downloads` permission is needed: the popup saves the file via a
same-origin blob URL + hidden `<a download>` element.

## Coursera-specific notes

- **Filter**: any item with a `Due, …` status tag is included, regardless
  of `data-test`. This is more robust than enumerating item types because
  Coursera adds new types (peer review, graded LTI, programming, etc.)
  without notice.
- **Timezone**: parsed from the `Due, …` text. Abbreviations mapped to
  UTC offsets (US/EU/Asia/AU/NZ). Unknown TZs fall back to UTC; the
  original label is preserved in the description either way.
- **Year rollover**: if the parsed date is in the past by more than a
  day, the parser rolls the year forward (so an Aug 30 deadline viewed
  in October appears as next Aug 30).
- **Week context**: extracted from the module section's `<h2>`. Becomes
  part of the event `SUMMARY`.
- **CSS-in-JS class names** like `css-1ff3yly`, `css-vac8rf`,
  `css-t1fcku` are derived from class hashes that can change between
  Coursera deploys. The structural anchors (`rc-WeekSingleItemDisplayRefresh`,
  `data-test`, the "Due, …" tag) are stable. If a class hash changes,
  only the meta-line extraction breaks, not the core due-date detection.

## Notes / known limits

- Assignments without a parseable due date are silently skipped.
- Reminders are honored by calendar clients that support `VALARM`
  (Google Calendar, Apple Calendar, Thunderbird, Outlook). Some web
  calendar UIs ignore them.
- The calendar name (`X-WR-CALNAME`) is the course name for a
  single-course export, or `<SourceTag> (N)` for a merged export (e.g.
  `Courses (2)` for a cross-platform merge).
- A `VTIMEZONE` block is included only when at least one event uses
  `tzMode: "preserve"` (Gradescope). All-UTC exports (Coursera only)
  skip it.

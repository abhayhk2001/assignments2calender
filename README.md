# Gradescope to ICS (Firefox/Zen WebExtension)

A Manifest V3 WebExtension with a toolbar popup. Open it on a Gradescope
course page, **add the course's assignments to memory**, navigate to
other courses and add them too, then **download one `.ics` calendar
file** containing every event.

## Features

- Toolbar popup UI. No page injection, no background script.
- Each event runs from **2 hours before** the deadline to the deadline
  itself, so the calendar block visually leads up to the due time.
- The event name is prefixed with the course, e.g.
  `CS 224N - Natural Language Processing — Homework 1`.
- Preserves the course timezone (`America/Chicago`, shown as CDT/CST on
  Gradescope) using a `VTIMEZONE` block.
- Each event has a **URL** to the assignment, course + status in the
  description, and **two reminders**: 1 day before, and 2 hours before.
- **Memory** is stored in `browser.storage.local` and survives browser
  restarts. Adding the same course twice dedupes by
  `(name, dueISO)`; new assignments are merged in.
- One `.ics` file can contain events from any number of courses.

## Install (temporary, for development)

1. Open Firefox (or Zen) and go to `about:debugging`.
2. Click **This Firefox** → **Load Temporary Add-on…**.
3. Pick `manifest.json` from this folder.
4. Open a Gradescope course page, e.g.
   `https://www.gradescope.com/courses/123456`.
5. Click the toolbar icon → **+ Add to memory**. Repeat on other courses.
6. Click **Download .ics** to save a single file with everything.

## File map

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. |
| `popup/popup.html` / `.css` / `.js` | Toolbar popup UI. Reads memory, talks to content script, builds & downloads ICS. |
| `content/gradescope-ics.js` | Injected into course pages. Responds to `"scrape"` messages from the popup. |
| `lib/ics.js` | Zero-dependency RFC 5545 builder (VTIMEZONE, VEVENT, VALARM, escaping, line folding). Accepts a flat array of assignments (each carrying its own `courseName`). |
| `icons/` | 48/96/128 px toolbar + extension icons. |
| `scripts/make_icons.py` | Regenerates the icons. |
| `scripts/validate.mjs` | Runs `lib/ics.js` against single- and multi-course fixtures. |

## How it works

```
[Toolbar popup]  ◀──  user click
   │
   ├─ browser.tabs.sendMessage(activeTabId, { type: "scrape" })
   │      └─▶  content/gradescope-ics.js
   │              └─ reads #assignments-student-table → returns { courseName, courseId, assignments }
   │
   ├─ "+ Add to memory"  →  mergeCourse()  →  browser.storage.local.set({ memory_v1 })
   │                                       (dedup by name+dueISO)
   │
   └─ "Download .ics"  →  buildICS(flatAssignments)  →  <a download> + blob URL
```

No background script. The popup talks directly to the content script
and to `browser.storage.local`; the download uses a same-origin blob
URL.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Persist the memory across popup closes and browser restarts. |
| `host_permissions: https://www.gradescope.com/*` | Inject the content script on course pages. |

No `downloads` permission is needed: the popup saves the file via a
same-origin blob URL + hidden `<a download>` element.

## Notes / known limits

- The `datetime` attribute on each `<time class="submissionTimeChart--dueDate">`
  is the source of truth. If Gradescope changes their markup, selectors
  in `content/gradescope-ics.js` will need updating.
- Assignments without a parseable due date are silently skipped.
- Reminders are honored by calendar clients that support `VALARM`
  (Google Calendar, Apple Calendar, Thunderbird, Outlook). Some web
  calendar UIs ignore them.
- The calendar name (`X-WR-CALNAME`) is the course name for a
  single-course export, or `Gradescope (N courses)` when multiple
  courses are merged.

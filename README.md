# Gradescope to ICS (Firefox/Zen WebExtension)

A Manifest V3 WebExtension that injects a **"Download .ics"** button directly
into Gradescope course pages. Click it to download an `.ics` calendar file
with one event per assignment deadline.

## Features

- Adds a toolbar **above the assignments table** on
  `https://www.gradescope.com/courses/*` — no popup, no background script.
- One event per row in `#assignments-student-table`, with a 1-hour duration
  anchored at the due time.
- Preserves the course's timezone (`America/Chicago`, shown as CDT/CST on
  Gradescope) using a proper `VTIMEZONE` block — events display at the
  correct wall-clock time in any calendar app, regardless of your local
  zone.
- Each event includes a **URL** to the assignment, the **course name**
  and **status** in the description, and **two reminders**: 1 day
  before, and 2 hours before.
- Filename derived from the course name, e.g. `CS-224N.ics`.

## Install (temporary, for development)

1. Open Firefox (or Zen) and go to `about:debugging`.
2. Click **This Firefox** → **Load Temporary Add-on…**.
3. Pick `manifest.json` from this folder.
4. Open a Gradescope course page, e.g.
   `https://www.gradescope.com/courses/123456`.
5. A blue **Download .ics** button appears above the assignments table.
   Click it → a "Save As" dialog downloads the calendar file.

Temporary add-ons are removed when the browser restarts. To install
permanently, sign and submit the extension to
[addons.mozilla.org](https://addons.mozilla.org/) or use a self-hosted
XPI.

## File map

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. |
| `content/gradescope-ics.js` | Injected into course pages. Adds the toolbar, scrapes the table, builds & downloads the ICS. |
| `lib/ics.js` | Zero-dependency RFC 5545 builder (VTIMEZONE, VEVENT, VALARM, escaping, line folding). |
| `icons/` | 48/96/128 px toolbar + extension icons. |
| `scripts/make_icons.py` | Regenerates the icons. |
| `scripts/validate.mjs` | Runs `lib/ics.js` against a sample payload and asserts on the output. |

## How it works

```
[Gradescope course page]
   │
   ▼
content/gradescope-ics.js  (runs at document_idle)
   ├─ injects toolbar above #assignments-student-table
   └─ on click:
        ├─ scrapeAll()               ← reads DOM rows
        ├─ GradescopeICS.buildICS()  ← lib/ics.js
         └─ <a download> + blob URL   ← triggers native save (no background script)
```

No background script. No popup. The content script does everything.

## Permissions

| Permission | Why |
| --- | --- |
| `host_permissions: https://www.gradescope.com/*` | Inject the content script on course pages. |

No `downloads` permission is needed: the content script saves the file
via a same-origin blob URL + hidden `<a download>` element, which is a
standard web platform feature and works in any context (no background
script involved).

## Notes / known limits

- Only the **currently visible** course is read. The dashboard page
  (multi-course) is not aggregated.
- The `datetime` attribute on each `<time class="submissionTimeChart--dueDate">`
  is the source of truth. If Gradescope changes their markup, selectors
  in `content/gradescope-ics.js` will need updating.
- Assignments without a parseable due date are silently skipped.
- Reminders are honored by calendar clients that support `VALARM`
  (Google Calendar, Apple Calendar, Thunderbird, Outlook). Some web
  calendar UIs ignore them.
- The injection uses a `MutationObserver` so SPA navigation between
  course pages is handled — but reloading the page is the surest path.

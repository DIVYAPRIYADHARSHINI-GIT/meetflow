# MeetFlow

> Meetings that actually get things done.

A professional meeting management and virtual meeting workspace: schedule with a real
agenda, run the meeting in a room that keeps time, take notes, assign action items, and
review the auto-generated summary afterwards. Everything runs in the browser — no server,
no accounts, no env vars, no data leaving the device.

Built for teams, students, freelancers and small businesses who run regular meetings.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # outputs to ./build
npm run preview      # serves the production build
```

**Build output folder: `build/`** — it contains `index.html` at its root and works when
served from any static server, including `cd build && python3 -m http.server`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Static build into `build/` |
| `npm run preview` | Serve the production build |
| `npm run check` / `npm run lint` | `svelte-check` type + Svelte diagnostics |
| `npm run test` | Unit suite (Vitest, Node) |
| `npm run probe` | End-to-end suite in headless Chrome against the real build |
| `npm run probe:a11y` | axe-core WCAG 2.1 AA audit, every page × 2 themes × 2 widths |
| `npm run test:all` | check → unit → e2e → a11y |

## Architecture

### One store, one source of truth

`src/lib/stores/app.svelte.ts` holds **all** meetings, contacts, teams, notes, decisions,
action items, chat and filters. Every view — dashboard, calendar, room, board, history,
summary — derives from it; no view keeps its own copy. That is why creating an action item
from a note line instantly updates the dashboard stat cards, the board and the summary with
no wiring between those components, and why any filter change propagates everywhere at once.

Persistence is write-through and debounced, and never throws: see
`src/lib/stores/storage.ts`.

### Logic lives outside the components

| Module | Responsibility |
| --- | --- |
| `src/lib/logic/time.ts` | Timezone-safe instants, civil dates, DST-correct wall-clock resolution |
| `src/lib/logic/schedule.ts` | Recurrence expansion, conflict detection, agenda timing, codes, `.ics` |
| `src/lib/logic/notes.ts` | HTML sanitising, note→action extraction, filtering, summaries |
| `src/lib/logic/media.ts` | Camera/mic acquisition, error classification, stream lifecycle |
| `src/lib/logic/room.svelte.ts` | Room session: controls, simulated participants, timers |
| `src/lib/export/pdf.ts` | Dependency-free PDF writer for summaries |
| `src/lib/data/sample.ts` | The sample workspace (fictional Northwind Studio) |

### Key design decisions

**Time is stored as one UTC instant plus the IANA zone it was scheduled in.** Wall-clock
strings are never persisted, because "09:00" is meaningless without a zone. Recurrence walks
*civil dates* and re-resolves the wall clock in the meeting's own zone for every occurrence,
so a 09:00 standup stays 09:00 across a DST change instead of drifting an hour.

**Recurrence is a rule, never expanded copies.** Occurrences are derived on demand, so
editing a series cannot orphan rows. Moving or cancelling a single occurrence records an
*exception*, which is why dragging one standup on the calendar does not move every standup.

**Conflict detection expands both sides.** A new one-off meeting is checked against every
occurrence of every series, so it catches a collision with the 14th weekly instance.
Back-to-back meetings (10:00 end, 10:00 start) are deliberately *not* conflicts.

**Notes are sanitised on every write.** The editor is `contenteditable`, so its output is
treated as untrusted: paste is forced to plain text, and `sanitiseHtml` reduces stored
markup to a small allowlist, dropping `<script>`, event handlers and `javascript:` URLs.

**Media failures are classified, never raw.** Permission denied, no device, device in use,
insecure origin, and unplugged-mid-call each get a specific message plus a way forward, and
you can always join without a camera or mic. Streams are stopped on leave *and* on page
hide, so the camera indicator goes out.

**Drag and drop always has a keyboard equivalent.** Calendar reschedule, agenda reorder and
the action board all pair pointer dragging with explicit buttons and `Alt`+arrow shortcuts,
and both paths are tested.

## Testing

| Suite | Count | Covers |
| --- | --- | --- |
| Unit (`npm run test`) | **234** | time/DST, recurrence, conflicts, agenda timing, notes, storage, media, sample integrity |
| E2E (`npm run probe`) | **60** | the full journey in real Chrome, plus XSS, media, storage recovery, 120-meeting load, hosting contract |
| A11y (`npm run probe:a11y`) | **37** | axe-core WCAG 2.1 AA + keyboard nav, focus trap, skip link |

Explicitly tested risk areas: DST boundaries (spring-forward gap times, fall-back ambiguity,
southern hemisphere), midnight crossing, month-end recurrence (31st → 28th/29th), leap days,
past dates, overlapping meetings, agenda totals vs duration, drag **and** keyboard paths,
camera granted/denied/missing/unplugged + stream cleanup, corrupted/future-version/blocked
storage, empty states, 140-character titles, emoji and Tamil/Devanagari text, 120+ meetings,
and refresh on every deep link.

Screenshots from the e2e run: `probes/screenshots/`.

## Deployment

Static output, deployable unchanged to Vercel, Netlify or GitHub Pages.

- `vercel.json` sets `outputDirectory: build` and rewrites all routes to the SPA fallback.
- Asset paths are **relative** (`./_app/...`), so GitHub Pages project sub-paths work
  without a rebuild.
- `_app/immutable/*` assets are content-hashed and served `immutable` with a 1-year cache.
- The SPA fallback is `200.html`, not `index.html`: naming it `index.html` would overwrite
  the prerendered landing page with a bare JS shell and lose the real `<h1>` from the served
  markup. `/` is prerendered with SSR so the hero copy is in the HTML; every other route
  opts out of SSR because they read `?code=` / `?id=` query params.

## Sample data

First visit seeds the fictional **Northwind Studio**: 9 people across 5 timezones, 4 teams,
12 meetings (one-off, daily, weekly and monthly series), real meeting notes, 7 decisions and
12 action items spanning every status, priority and due-date state. Dates are generated
relative to today, so the dashboard is always populated. Settings → *Start fresh* clears it;
*Restore sample workspace* brings it back.

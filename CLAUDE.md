# Life OS — Project Memory for Claude Code

This app was built with Claude Code as the coding agent. This file is the
standing brief the agent reads at the start of every session: what the app is,
the decisions already made, the rules it must follow, and the mistakes already
paid for. Chat history does not carry between sessions, so anything durable
lives here. (This public copy keeps the engineering content and leaves out
private working notes.)

## What this is
**Life OS** is a single-user personal web app that replaces a Notion "Second
Brain": daily planning, to-dos, habits, a news briefing, email triage,
calendar, journal capture, and long-term notes ("Deep Memory").
Next.js 14 (App Router, TypeScript, Tailwind 3) + Supabase (Postgres, Auth,
Storage), deployed on Vercel with free tiers everywhere.

- `.env.local` holds all secrets (gitignored). Never print, upload, or commit
  it; refer to variables by name only.
- The Vercel function region is set next to the Supabase region: every page
  load makes several sequential database trips, so distance is most of the lag.
- Interactions update the UI instantly and save in the background
  (see `components/InstantCheck.tsx`).
- Everything is login-gated by `src/middleware.ts`; unauthenticated requests
  redirect to `/login`.

## Confirmed decisions — don't re-litigate without asking
- Single user; **no signup flow** (the one user is created in the Supabase
  dashboard and public signups are disabled).
- Web app first; no native app.
- **"3 Things"**: each day the user picks exactly 3 non-negotiable tasks
  (`is_mit = true`). Hard cap of 3, enforced server-side in `toggleMit`.
- Visual theme: light "notebook" look, off-white/warm-grey with a mustard
  accent. Tokens live in `tailwind.config.ts`; use them, don't hardcode colors.
- **Workspaces are one shared template.** The widget canvas is used by Deep
  Memory pages and Project Center projects alike; a fix to the canvas applies
  everywhere it's used.

## Product rules
- **For any non-trivial new feature: ask scoping questions first, then build.**
  Give a recommendation, not a menu of options.
- Layouts must **fit the page: no horizontal scrolling**. Prefer hover-reveal
  controls over permanent clutter; things should line up.
- **No native browser pop-ups** (`window.confirm/alert/prompt`). Confirmations
  are inline in the page.
- Explain root causes plainly; be upfront when something is untested.

## Hard-won gotchas (each one cost real debugging)
1. **Never run `next build` while `next dev` is running**: they share `.next`
   and it corrupts the dev server. `next dev` doesn't type-check; always run
   `npx tsc --noEmit` and `npm run build` before calling something done.
2. **Supabase calls don't throw**: they return `{ data, error }`. Unchecked
   errors produced silent "everything vanished" bugs. Always read `error`, log
   it, and surface failures in the UI.
3. **Schema changes** go in `supabase/schema.sql` (fully idempotent, single
   source of truth), which is run whole in the Supabase SQL editor. Verify with
   the REST API: a missing table/column returns an error naming it.
4. **Seeding idiom**: never "ensure defaults" with an upsert on every page
   load; it silently resurrects anything the user deleted. Seed once, tracked
   by a flag (`user_state.recurring_defaults_seeded`), and fail *closed* if the
   flag can't be read.
5. Server actions called from client event handlers don't auto-refresh; wrap
   in `startTransition` and call `router.refresh()`.
6. `"use server"` files may only export async functions; put constants and
   pure helpers in `src/lib/`.
7. Emoji ignore CSS `color`; show toggled state with opacity/background.
8. `Number("")` is `0`, not `NaN`; validate shapes explicitly.
9. Don't nest `<form>` elements; use `section-no-drag` for buttons inside
   react-grid-layout drag handles.
10. Native HTML5 drag-and-drop needs `e.dataTransfer.setData(...)` in
    `onDragStart` or Firefox silently aborts.
11. **Timezones**: a deployed server runs in UTC. All "today"/"now" code goes
    through `lib/timezone.ts` (`USER_TIME_ZONE` from `NEXT_PUBLIC_TIME_ZONE`);
    never use `getHours()`, `toISOString().slice(0,10)` or
    `getTimezoneOffset()` for the user's day.
12. Keep the project folder out of iCloud-synced locations: offloaded files
    corrupted `node_modules` once.

## Verifying UI behind the login
Build a temporary harness: a throwaway route rendering the real client
component with stubbed server actions and fake data, plus a temporary
`NODE_ENV !== "production"` bypass for that path in `middleware.ts`. Test in a
browser, then delete the route and restore `middleware.ts` exactly, and confirm
with a grep and a redirect on the test path.

## Architecture & feature map
`src/app/(app)/` is the logged-in shell (`layout.tsx` + collapsible `Sidebar`:
Home, To-Do List, Habit Tracker, Project Center, Deep Memory). Logic lives in
server actions beside each page and helpers in `src/lib/`.

**Home / Control Center (`(app)/page.tsx`)**: one server component; all
independent queries run in a single `Promise.all`. Panels: Daily Briefing,
Message Board, 3 Things, Today's Checklist (To-Do + Habits), Google Calendar
day view. Email and calendar fetches are cached in memory for 60s.

**App day** (`lib/appDay.ts`): the day rolls over at **4am** in the user's
timezone, not midnight. The Calendar widget is the deliberate exception.

**Tasks**: `due_date` null = "evergreen"; drag-reorder; one level of subtasks;
`/todo` has a month calendar plus Today / Upcoming / Evergreen / Overdue lists.

**Recurring tasks** (`recurring_templates`, `recurringActions.ts`): daily,
weekly or yearly; spawned at most once per app-day (gated by
`user_state.last_recurring_spawn`) and sorted as a block at the top of the day.

**New Day wizard**: opens on the first load of each app-day; extensible steps
(step 1 = overdue-task cleanup).

**Habit Tracker** (`habits/`): two side-by-side tables (frozen + scrolling)
because `border-collapse` breaks multi-column sticky. Click a date header to
exclude that day from stats. Stats math in `lib/habits.ts`.

**Google Calendar** (`lib/googleCalendar.ts`, `DayTimeline.tsx`): OAuth,
click-drag to create, edit and delete events.

**Daily Briefing** (`lib/news.ts`, `lib/rss.ts`): RSS → keyword-affinity
scoring that learns from 👍/👎 (deliberately explainable, not ML) →
near-duplicate removal → topic-balanced selection so no topic dominates →
cached per day.

**Message Board** (`lib/messageBoard.ts`, `gmail.ts`, `outlook.ts`): unread +
important mail; "Clear" is a local dismiss. An iMessage tab (a local sync
script plus triage by a local Ollama model) was built and then removed because
the local model was too heavy for the laptop; if it returns, use a hosted
model. Outlook is hidden because many school/work tenants block third-party
mail apps.

**Journal photo** (`JournalDropzone.tsx` → `/api/journal/parse` →
`journalVision.ts` + `journalParse.ts`): a photo of a paper planner page goes
through Google Cloud Vision OCR (word-level boxes, HEIC converted server-side);
"Targets" become 3 Things and the hour-labelled column becomes to-dos, after a
review screen.

**Workspaces (shared canvas)** (`src/components/workspace/`):
`WorkspaceCanvas.tsx` uses react-grid-layout (12 cols, edit-layout toggle,
stacks below 640px). `lib/workspace.ts` defines
`WorkspaceRef = { kind: "page" | "project", id }`; widgets live in
`memory_sections` with exactly one owner (`page_id` or `project_id`, enforced
by a check constraint). To add a new owner: add an owner column and extend the
check and `WorkspaceKind`.
- Widgets: heading, text, checklist, links, gallery, table, associated to-dos,
  and **Sections** (a box with its own nested grid, to any depth).
- Content is saved as JSON patches merged in the canvas with debounced autosave.
- Sections keep the size you give them; collapsing is part of the *saved*
  layout, so adding a widget never changes what the page looks like.
- Menus are portalled popovers that size to the window and follow their button.
- Adding is draw-to-size: pick a widget, then drag across empty squares.
- **Gallery**: uploads go through `/api/memory/photo` (HEIC→JPEG, EXIF-rotate,
  max 1600px) into a private Storage bucket, shown via signed URLs; photo files
  are deleted explicitly because they don't cascade.
- **Table**: a mini spreadsheet with typed columns (text/number/checkbox/date/
  select), sort as a view setting, drag to reorder and resize columns.
- **Associated To-Dos**: live tasks tagged with a project, grouped Active /
  Overdue / Complete.
- Every widget has a color (12 muted hues × 4 strengths, all above 5:1 text
  contrast) and a Boxed/Flat style.

**Deep Memory** (`memory/`): a board of groups holding pages; each page is a
workspace.

**Project Center** (`projects/`): cover-photo cards grouped Active / On Hold /
Complete, sorted by deadline, with a progress bar from the project's to-dos.
Each project page is a header (cover, name, description, status, deadline) plus
a workspace.

## Database
`supabase/schema.sql` creates everything; every table has row level security
with the policy `auth.uid() = user_id`. `user_state` is the per-user flags row
(last_new_day, last_recurring_spawn, recurring_defaults_seeded).

## Environment variables
Names only; see `.env.local.example`.

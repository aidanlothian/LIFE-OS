# Life OS

A personal operating system for my day: one web app that brings together my
to-dos, habits, projects, notes, calendar, email and a daily news briefing. I
use it every day; it replaced the Notion setup I used to run my life from.

I built it by directing an AI coding agent (Claude Code). I made the product
and architecture decisions, set the rules the agent works under, tested
everything on real use, and iterated from there. The agent's standing brief,
[`CLAUDE.md`](CLAUDE.md), shows how that collaboration is structured.

**Stack:** Next.js 14 (App Router, TypeScript, Tailwind) · Supabase (Postgres,
Auth, Storage, row level security) · Vercel · Google Calendar, Gmail and Cloud
Vision APIs

## What it does

| Module | What's in it |
| --- | --- |
| **Home** | A control center: daily briefing, unread important email, today's "3 Things", to-dos and habits side by side, and a Google Calendar day view you can drag to create events |
| **To-Do List** | Today / Upcoming / Evergreen / Overdue lists, a month calendar, subtasks, recurring tasks, and a hard cap of 3 daily priorities |
| **Habit Tracker** | A grid of daily habits with streaks and stats; days can be excluded from the math |
| **Project Center** | Project cards with cover photos, status, deadlines and progress from linked to-dos |
| **Deep Memory** | Long-term notes built as free-form pages of widgets |

### Highlights

- **One shared workspace canvas.** Deep Memory pages and project pages run on
  the same drag-and-drop canvas: text, checklists, links, photo galleries,
  mini spreadsheets, linked to-dos, and nested sections. It's built once, so
  any improvement shows up everywhere.
- **Journal photo to tasks.** Snap a photo of a paper planner page; Google
  Cloud Vision reads the handwriting and the app turns it into tasks and
  priorities, with a review step before saving.
- **A news briefing that learns.** RSS feeds are scored by keyword affinity
  that adjusts with 👍/👎, de-duplicated, and balanced across topics. It's
  deliberately simple and explainable rather than a black-box model.
- **A day that ends at 4am.** Late-night work still counts as "today", and all
  date logic runs in the owner's timezone, not the server's.

## Decisions and trade-offs

- **Local AI vs. performance.** I built an iMessage integration that used a
  local Ollama model to flag conversations that needed a reply. It worked, but
  the model slowed my laptop too much, so I removed it. If it returns, it
  will use a hosted model.
- **Speed.** Every click re-renders the home page, so queries run in parallel,
  calendar and email results are cached briefly, the UI updates instantly and
  saves in the background, and the server runs in the same region as the
  database.
- **Security.** It's a single-user app with no public sign-up. Every table is
  locked to its owner with Postgres row level security, and secrets stay out
  of the repo.

## Run it yourself

1. `npm install`
2. Create a free Supabase project, run `supabase/schema.sql` in its SQL
   editor, and add a user under Authentication → Users.
3. Copy `.env.local.example` to `.env.local` and fill in your values (Google
   OAuth and Vision are optional for the core to-do and habit features).
4. `npm run dev` and open http://localhost:3000.

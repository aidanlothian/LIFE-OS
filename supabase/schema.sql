-- Life OS — To-Do module schema
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query).

create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','on_hold','complete')),
  created_at timestamptz not null default now()
);

create table if not exists public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  section text not null check (section in ('schedule','todo')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Recurrence rule for when a template actually spawns a task (see newDay
-- in actions.ts). 'daily' fires every day (the default — matches every
-- template's behavior before this existed, so no data migration needed).
-- 'weekly' fires on the listed days_of_week (0=Sunday..6=Saturday).
-- 'yearly' fires once a year on yearly_month/yearly_day.
alter table public.recurring_templates add column if not exists recurrence_type text not null default 'daily' check (recurrence_type in ('daily', 'weekly', 'yearly'));
alter table public.recurring_templates add column if not exists days_of_week integer[] not null default '{}';
alter table public.recurring_templates add column if not exists yearly_month int;
alter table public.recurring_templates add column if not exists yearly_day int;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  section text not null default 'todo' check (section in ('schedule','todo')),
  notes text,
  due_date date,
  project_id uuid references public.projects(id) on delete set null,
  is_done boolean not null default false,
  completed_at timestamptz,
  is_mit boolean not null default false,
  template_id uuid references public.recurring_templates(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One level of subtasks under a regular to-do (e.g. "Clean room" ->
-- "Make bed", "Vacuum"). A subtask is just a normal task row pointing back
-- at its parent; deleting the parent cascades to its subtasks. Needed as
-- an explicit ALTER for anyone who already ran this file before this
-- column existed.
alter table public.tasks add column if not exists parent_task_id uuid references public.tasks(id) on delete cascade;
create index if not exists tasks_parent_task_idx on public.tasks (parent_task_id);

-- Drag-and-drop order within a given day's to-do list. Scoped by
-- (section, due_date) — see reorderTask — so each day's list reorders
-- independently rather than sharing one global ordering.
alter table public.tasks add column if not exists sort_order int not null default 0;
create index if not exists tasks_user_section_date_sort_idx
  on public.tasks (user_id, section, due_date, sort_order);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null default 'General',
  category_order int not null default 0,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- category_order lets whole categories be reordered as a unit (every habit
-- row sharing a category shares its category_order value, kept in sync by
-- the rename/move/delete category actions). Needed as an explicit ALTER for
-- anyone who already ran this file before category_order existed.
alter table public.habits add column if not exists category_order int not null default 0;
update public.habits set category_order = 1 where category = 'Health' and category_order = 0;
update public.habits set category_order = 2 where category = 'Organized' and category_order = 0;
update public.habits set category_order = 3 where category = 'Focused' and category_order = 0;

-- Presence-only log: a row means that habit was completed on that date.
-- No row = not completed. Toggling deletes/inserts rather than flipping a flag.
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  log_date date not null,
  created_at timestamptz not null default now()
);

-- Presence-only, same idea as habit_logs: a row means that whole day is
-- excluded from every habit's historical stats (both the numerator and the
-- denominator), for stretches where the tracker wasn't being used at all —
-- so a gap doesn't quietly drag every percentage down.
create table if not exists public.habit_excluded_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  excluded_date date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists habit_excluded_days_user_date_unique
  on public.habit_excluded_days (user_id, excluded_date);

-- Prevents ensureDefaultHabits from creating duplicate habits if two page
-- loads race each other.
create unique index if not exists habits_user_title_category_unique
  on public.habits (user_id, title, category);

create unique index if not exists habit_logs_habit_date_unique
  on public.habit_logs (habit_id, log_date);

create index if not exists habits_user_category_idx
  on public.habits (user_id, category, sort_order);

create index if not exists habit_logs_user_date_idx
  on public.habit_logs (user_id, log_date);

-- Prevents ensureDefaultTemplates from creating duplicate templates if two
-- page loads race each other.
create unique index if not exists recurring_templates_user_title_section_unique
  on public.recurring_templates (user_id, title, section);

-- Prevents "New Day" from creating duplicate rows if clicked more than once.
-- Not partial: Postgres never treats NULLs as conflicting in a unique index,
-- so regular tasks (template_id null) still never collide with each other.
-- A partial predicate here would break upsert's ON CONFLICT inference.
create unique index if not exists tasks_template_date_unique
  on public.tasks (template_id, due_date);

create index if not exists tasks_user_section_date_idx
  on public.tasks (user_id, section, due_date);

-- One row per user (single-user app, but keyed by user_id for the same RLS
-- pattern as everything else). Tokens are only ever read/written server-side
-- from Server Actions and Route Handlers, never sent to the client.
create table if not exists public.google_calendar_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  feed_url text not null,
  topic text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Lets ensureDefaultNewsSources upsert (ignoring duplicates) rather than
-- needing a separate "does the user have any sources at all" check — so a
-- source added to DEFAULT_SOURCES later actually reaches existing users.
create unique index if not exists news_sources_user_feed_unique
  on public.news_sources (user_id, feed_url);

-- One day's fetched, scored, cached article pool. fetched_for_date lets a
-- day's briefing be computed once and reused on every subsequent load that
-- day, rather than re-fetching every RSS feed on every page view.
create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references public.news_sources(id) on delete set null,
  title text not null,
  link text not null,
  summary text,
  published_at timestamptz,
  fetched_for_date date not null,
  score numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Running affinity per keyword (both single words and adjacent-word phrases
-- like "red sox" — see extractKeywords), nudged up/down by like/dislike
-- feedback. This is the entire "learns your taste" mechanism: plain,
-- inspectable addition/subtraction, not a black box.
create table if not exists public.news_keyword_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  score numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.news_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id uuid not null references public.news_articles(id) on delete cascade,
  reaction text not null check (reaction in ('like','dislike')),
  created_at timestamptz not null default now()
);

create unique index if not exists news_articles_user_link_date_unique
  on public.news_articles (user_id, link, fetched_for_date);

create index if not exists news_articles_user_date_idx
  on public.news_articles (user_id, fetched_for_date, score desc);

create unique index if not exists news_keyword_scores_user_keyword_unique
  on public.news_keyword_scores (user_id, keyword);

create unique index if not exists news_feedback_user_article_unique
  on public.news_feedback (user_id, article_id);

-- Tracks the last app-day (see src/lib/appDay.ts — 4am ET boundary) the
-- New Day wizard was completed for, so it auto-opens on the first page
-- load of a new app-day and not again until the next one.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_new_day date,
  updated_at timestamptz not null default now()
);

-- Tracks the last app-day recurring tasks were actually spawned for (see
-- newDay/spawnDueRecurringTasks in actions.ts). newDay() runs on every
-- homepage load, so without this gate, deleting a recurring task's
-- instance for today would just have the very next page load recreate it.
alter table public.user_state add column if not exists last_recurring_spawn date;

-- Whether the starter recurring templates (meals, "Catch up on texts") have
-- been seeded for this account. The seeding used to re-run on every page
-- load, which silently re-created any starter template you deleted (or
-- made a duplicate of one you renamed). Now it happens once. The one-time
-- UPDATE marks existing accounts as already seeded — they have the
-- starters — and it only runs the moment the column is first added.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_state'
      and column_name = 'recurring_defaults_seeded'
  ) then
    alter table public.user_state
      add column recurring_defaults_seeded boolean not null default false;
    update public.user_state set recurring_defaults_seeded = true;
  end if;
end $$;

-- Message Board: connected email accounts (Gmail and/or Outlook) — one row
-- per connected account, so a personal and a work inbox can both be
-- tracked side by side rather than the single-row-per-user pattern used
-- for Google Calendar.
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  label text not null, -- e.g. "Personal", "Work"
  email_address text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cached unread emails plus their AI-generated one-line action-item
-- summary, so a given message is only ever sent to Gemini once rather than
-- on every homepage load.
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  message_id text not null, -- the provider's own message id
  subject text,
  sender text,
  snippet text,
  summary text,
  received_at timestamptz,
  fetched_at timestamptz not null default now()
);

-- Presence-only, same idiom as habit_excluded_days: a row means this
-- specific message has been cleared from the Message Board. Doesn't touch
-- the real inbox (stays unread in Gmail/Outlook) — purely a local "I've
-- seen this" marker, matching the read-only/link-out design. A later email
-- always has its own message_id, so it naturally isn't affected.
create table if not exists public.email_dismissed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  message_id text not null,
  created_at timestamptz not null default now()
);

-- iMessage board: written by the local Mac companion script (using the
-- Supabase service role key, which bypasses RLS) and read by the web app
-- as the signed-in user. One row per contact/conversation thread.
-- dismissed_message_at records the last_message_at the user dismissed as
-- "nothing to follow up on" — the thread stays hidden until a newer
-- message pushes last_message_at past it, at which point it resurfaces.
create table if not exists public.imessage_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id text not null,
  contact_label text,
  last_message_text text,
  last_message_at timestamptz not null,
  dismissed_message_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists email_accounts_user_provider_email_unique
  on public.email_accounts (user_id, provider, email_address);

create unique index if not exists email_messages_account_message_unique
  on public.email_messages (account_id, message_id);

create unique index if not exists email_dismissed_account_message_unique
  on public.email_dismissed (account_id, message_id);

create unique index if not exists imessage_threads_user_contact_unique
  on public.imessage_threads (user_id, contact_id);

-- AI triage for the iMessage board (scripts/imessage-sync). One row per chat
-- (1:1 or group) whose last message is from someone else; contact_id is the
-- Messages chat guid. A local model decides whether the chat actually needs
-- needs_reply null = not judged yet, ai_reason = one-line why.
-- judged_message_at = the last_message_at that verdict was made for, so a
-- chat is only re-judged when a new message arrives.
alter table public.imessage_threads add column if not exists is_group boolean not null default false;
alter table public.imessage_threads add column if not exists needs_reply boolean;
alter table public.imessage_threads add column if not exists ai_reason text;
alter table public.imessage_threads add column if not exists judged_message_at timestamptz;

-- Deep Memory: a Notion-board-style layout — user-editable categories
-- ("groups"), each holding an ordered list of pages. Page content is kept
-- deliberately minimal (a single text field) for now; the board/category/
-- page structure is the part being built out first.
create table if not exists public.memory_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.memory_categories(id) on delete cascade,
  title text not null,
  content text,
  page_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists memory_categories_user_name_unique
  on public.memory_categories (user_id, name);

create index if not exists memory_pages_category_idx
  on public.memory_pages (category_id, page_order);

-- A page is a free-form canvas of sections placed on a 12-column snap grid
-- (react-grid-layout). x/y/w/h are in grid units: x 0-11, w 1-12, y/h in
-- rows. `type` selects which module renders it (heading, text, checklist,
-- links so far) and `content` holds that module's data as JSON. Left
-- without a CHECK on type on purpose so adding a module later doesn't need
-- a constraint rewrite — the app validates it.
create table if not exists public.memory_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null references public.memory_pages(id) on delete cascade,
  type text not null,
  content jsonb not null default '{}'::jsonb,
  x int not null default 0,
  y int not null default 0,
  w int not null default 6,
  h int not null default 6,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_sections_page_idx
  on public.memory_sections (page_id);

-- Sections can nest: a "group" section (shown as "Section" in the app) holds
-- its own snap grid of child sections, to any depth. Top-level sections have
-- no parent; a child's x/y/w/h are in its parent's grid. Deleting a group
-- deletes everything inside it.
alter table public.memory_sections
  add column if not exists parent_id uuid references public.memory_sections(id) on delete cascade;

create index if not exists memory_sections_parent_idx
  on public.memory_sections (parent_id);

-- Workspaces: the same widget canvas is used outside Deep Memory too. Each
-- section belongs to exactly one owner, either a Deep Memory page or a
-- project (Project Center), so page_id is optional and a check keeps exactly
-- one of the two set. Deleting the owner deletes its widgets.
alter table public.memory_sections
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.memory_sections alter column page_id drop not null;
alter table public.memory_sections drop constraint if exists memory_sections_one_owner;
alter table public.memory_sections add constraint memory_sections_one_owner
  check (num_nonnulls(page_id, project_id) = 1);

create index if not exists memory_sections_project_idx
  on public.memory_sections (project_id);

-- Project Center cards: an optional deadline (open-ended projects have none)
-- and an optional cover photo, stored in the memory-photos bucket below.
alter table public.projects add column if not exists deadline date;
alter table public.projects add column if not exists cover_path text;

-- Photos for the Gallery widget live in a private Storage bucket. Each file
-- is stored under "<user id>/<random id>.jpg" and only that user can see,
-- add or remove it; the app shows them through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('memory-photos', 'memory-photos', false)
on conflict (id) do nothing;

drop policy if exists "memory_photos_select_own" on storage.objects;
create policy "memory_photos_select_own" on storage.objects
  for select using (
    bucket_id = 'memory-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "memory_photos_insert_own" on storage.objects;
create policy "memory_photos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'memory-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "memory_photos_delete_own" on storage.objects;
create policy "memory_photos_delete_own" on storage.objects
  for delete using (
    bucket_id = 'memory-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

alter table public.memory_categories enable row level security;
alter table public.memory_pages enable row level security;
alter table public.memory_sections enable row level security;

drop policy if exists "memory_categories_all_own" on public.memory_categories;
create policy "memory_categories_all_own" on public.memory_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "memory_pages_all_own" on public.memory_pages;
create policy "memory_pages_all_own" on public.memory_pages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "memory_sections_all_own" on public.memory_sections;
create policy "memory_sections_all_own" on public.memory_sections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One-time carry-over: pages used to hold a single text blob in
-- memory_pages.content. Move any non-empty one into a first text section
-- (then blank the old column, in the same statement so it can't half-apply)
-- so nothing written under the old setup is lost. Only touches pages that
-- have no sections yet, so re-running this file is safe.
with legacy as (
  select p.id, p.user_id, p.content
  from public.memory_pages p
  where p.content is not null
    and btrim(p.content) <> ''
    and not exists (select 1 from public.memory_sections s where s.page_id = p.id)
),
moved as (
  insert into public.memory_sections (user_id, page_id, type, content, x, y, w, h)
  select user_id, id, 'text', jsonb_build_object('text', content), 0, 0, 12, 8
  from legacy
  returning page_id
)
update public.memory_pages
set content = null
where id in (select page_id from moved);

alter table public.projects enable row level security;
alter table public.recurring_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.habit_excluded_days enable row level security;
alter table public.google_calendar_tokens enable row level security;
alter table public.news_sources enable row level security;
alter table public.news_articles enable row level security;
alter table public.news_keyword_scores enable row level security;
alter table public.news_feedback enable row level security;
alter table public.user_state enable row level security;
alter table public.email_accounts enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_dismissed enable row level security;
alter table public.imessage_threads enable row level security;

drop policy if exists "projects_all_own" on public.projects;
create policy "projects_all_own" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recurring_templates_all_own" on public.recurring_templates;
create policy "recurring_templates_all_own" on public.recurring_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tasks_all_own" on public.tasks;
create policy "tasks_all_own" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "habits_all_own" on public.habits;
create policy "habits_all_own" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "habit_logs_all_own" on public.habit_logs;
create policy "habit_logs_all_own" on public.habit_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "habit_excluded_days_all_own" on public.habit_excluded_days;
create policy "habit_excluded_days_all_own" on public.habit_excluded_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "google_calendar_tokens_all_own" on public.google_calendar_tokens;
create policy "google_calendar_tokens_all_own" on public.google_calendar_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "news_sources_all_own" on public.news_sources;
create policy "news_sources_all_own" on public.news_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "news_articles_all_own" on public.news_articles;
create policy "news_articles_all_own" on public.news_articles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "news_keyword_scores_all_own" on public.news_keyword_scores;
create policy "news_keyword_scores_all_own" on public.news_keyword_scores
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "news_feedback_all_own" on public.news_feedback;
create policy "news_feedback_all_own" on public.news_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_state_all_own" on public.user_state;
create policy "user_state_all_own" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "email_accounts_all_own" on public.email_accounts;
create policy "email_accounts_all_own" on public.email_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "email_messages_all_own" on public.email_messages;
create policy "email_messages_all_own" on public.email_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "email_dismissed_all_own" on public.email_dismissed;
create policy "email_dismissed_all_own" on public.email_dismissed
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "imessage_threads_all_own" on public.imessage_threads;
create policy "imessage_threads_all_own" on public.imessage_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

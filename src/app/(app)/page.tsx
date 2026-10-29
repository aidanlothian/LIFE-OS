import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { groupByCategory } from "@/lib/habits";
import { getCachedTodaysEvents, layoutDayEvents } from "@/lib/googleCalendar";
import {
  ensureDefaultKeywordScores,
  ensureDefaultNewsSources,
  getTodaysBriefing,
} from "@/lib/news";
import { getEmailBoard } from "@/lib/messageBoard";
import { getAppDay } from "@/lib/appDay";
import { userDateStr, userMinutesIntoDay } from "@/lib/timezone";
import { disconnectGoogleCalendar, ensureDefaultTemplates, newDay } from "./actions";
import { giveArticleFeedback } from "./newsActions";
import { toggleHabitLog } from "./habits/actions";
import DayTimeline from "./DayTimeline";
import AddTaskButton from "./AddTaskButton";
import EditRecurringTasksButton from "./EditRecurringTasksButton";
import TodoList from "./TodoList";
import JournalDropzone from "./JournalDropzone";
import InstantCheck from "@/components/InstantCheck";
import MessageBoard from "./MessageBoard";
import NewDayWizard from "./NewDayWizard";
import type { Habit, RecurringTemplate, Task } from "@/types";

// The Calendar widget is the one deliberate exception to the app-wide 4am
// ET day boundary (see src/lib/appDay.ts) — a day view should show a real
// midnight-to-midnight 24-hour day, not one that starts at 4am.
function calendarDayStr() {
  return userDateStr();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function briefingTitle(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${ordinal(d)} Daily Briefing`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null; // middleware redirects unauthenticated users

  // Independent of each other, so they run concurrently rather than one
  // after another.
  await Promise.all([
    ensureDefaultTemplates(user.id),
    ensureDefaultNewsSources(user.id),
    ensureDefaultKeywordScores(user.id),
  ]);
  // Recurring tasks (meals, "Catch up on texts") spawn for the new app-day
  // as soon as it begins — independent of the New Day wizard, which is
  // just the morning review step, not what makes the fixed tasks exist.
  // Gated to actually spawn at most once per app-day (see newDay in
  // actions.ts), so this is a cheap no-op on every load after the first.
  await newDay();

  const today = getAppDay();
  const calendarDay = calendarDayStr();

  // This whole function reruns on nearly every click (toggling a task,
  // dragging a habit, etc. all revalidate "/"), so everything below —
  // independent of each other — runs concurrently instead of as ~12
  // sequential round trips. getEmailBoard/getCachedTodaysEvents are
  // themselves short-TTL-cached against Gmail/Outlook/Google Calendar, so
  // routine actions don't re-hit those APIs at all most of the time.
  const [
    { data: recurringTemplatesData },
    briefing,
    emailBoard,
    { data: projects },
    userStateResult,
    overdueResult,
    todosResult,
    { data: mitTasks },
    { data: habitsData },
    { data: habitLogsToday },
    calendarResult,
  ] = await Promise.all([
    supabase
      .from("recurring_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    getTodaysBriefing(user.id, today),
    getEmailBoard(user.id),
    supabase.from("projects").select("id, name").order("created_at", { ascending: true }),
    supabase.from("user_state").select("last_new_day").eq("user_id", user.id).maybeSingle(),
    // "Hanging" tasks from previous app-days that were never checked off
    // or rescheduled — the whole point of the New Day wizard's first step.
    // Recurring-template tasks (template_id set — "Catch up on texts", the
    // meal reminders, etc.) are excluded: a fresh instance gets spawned
    // for today regardless, so a stale unchecked one from yesterday is
    // never a meaningful thing to flag, just noise.
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .eq("is_done", false)
      .lt("due_date", today)
      .not("due_date", "is", null)
      .is("parent_task_id", null)
      .is("template_id", null)
      .order("due_date", { ascending: true }),
    // The homepage checklist is scoped to today only — This Week /
    // Overdue / Evergreen / All views belong on the dedicated task list
    // page instead. Fetches top-level to-dos and their subtasks together
    // (a subtask always shares its parent's due_date/section), then
    // splits them apart below — one query instead of two round trips.
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .eq("due_date", today)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("tasks").select("*").eq("is_mit", true).eq("due_date", today),
    supabase.from("habits").select("*").eq("active", true),
    supabase.from("habit_logs").select("habit_id").eq("log_date", today),
    getCachedTodaysEvents(user.id, calendarDay),
  ]);

  const recurringTemplates = (recurringTemplatesData ?? []) as RecurringTemplate[];
  const { accounts: emailAccounts, items: emailItems, errors: emailErrors } = emailBoard;

  const { data: userState, error: userStateError } = userStateResult;
  if (userStateError) console.error("Failed to read user_state:", userStateError);
  const newDayAutoOpen = userState?.last_new_day !== today;

  const { data: overdueTasksRaw, error: overdueError } = overdueResult;
  if (overdueError) console.error("Failed to fetch overdue tasks:", overdueError);
  const overdueTasks = (overdueTasksRaw ?? []) as Task[];

  const { data: todosRaw, error: todosError } = todosResult;
  if (todosError) console.error("Failed to fetch today's tasks:", todosError);

  const todos = (todosRaw ?? []).filter((t) => !t.parent_task_id) as Task[];
  const subtasksByParent: Record<string, Task[]> = {};
  for (const t of (todosRaw ?? []) as Task[]) {
    if (!t.parent_task_id) continue;
    const list = subtasksByParent[t.parent_task_id] ?? [];
    list.push(t);
    subtasksByParent[t.parent_task_id] = list;
  }

  const mitCount = mitTasks?.length ?? 0;

  const habits = (habitsData ?? []) as Habit[];
  const habitsDoneTodaySet = new Set((habitLogsToday ?? []).map((l) => l.habit_id));
  const habitGroups = groupByCategory(habits);

  const { calendarConnected, calendarEvents, calendarError } = calendarResult;
  const { timed: timedEvents, allDay: allDayEvents } = layoutDayEvents(calendarEvents, calendarDay);
  const nowMinutes = userMinutesIntoDay();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Control Center</h1>
          <p className="text-sm text-muted">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <NewDayWizard overdueTasks={overdueTasks} today={today} autoOpen={newDayAutoOpen} />
          <JournalDropzone today={today} />
        </div>
      </header>

      {searchParams.error && (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {searchParams.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <section>
          <details className="group">
            <summary className="mb-2 flex cursor-pointer items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted [&::-webkit-details-marker]:hidden marker:hidden">
              <span className="inline-block text-[10px] transition-transform group-open:rotate-90">
                ▶
              </span>
              {briefingTitle(today)}
              {briefing.length > 0 && (
                <span className="rounded bg-border/60 px-1.5 py-0.5 text-[11px] normal-case text-muted">
                  {briefing.length}
                </span>
              )}
            </summary>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] p-3">
              {briefing.length === 0 && (
                <p className="text-sm text-muted">
                  No articles yet today — check back after your sources have updated.
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {briefing.map((a) => (
                <li key={a.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={a.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-text hover:text-accent"
                    >
                      {a.title}
                    </a>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <span className="rounded bg-border/60 px-1.5 py-0.5">{a.topic}</span>
                    <span>{a.sourceLabel}</span>
                    <span className="ml-auto flex items-center gap-1">
                      {/* Emoji glyphs render with their own built-in color
                          from the system font — CSS text color has no
                          effect on them, so the reacted/unreacted state is
                          shown via opacity + background instead. */}
                      <form action={giveArticleFeedback.bind(null, a.id, "like")}>
                        <button
                          type="submit"
                          aria-label="Like this article"
                          className={`rounded px-1 py-0.5 transition ${
                            a.reaction === "like"
                              ? "bg-good/20 opacity-100"
                              : "opacity-40 hover:opacity-80"
                          }`}
                        >
                          👍
                        </button>
                      </form>
                      <form action={giveArticleFeedback.bind(null, a.id, "dislike")}>
                        <button
                          type="submit"
                          aria-label="Not interested in this article"
                          className={`rounded px-1 py-0.5 transition ${
                            a.reaction === "dislike"
                              ? "bg-bad/20 opacity-100"
                              : "opacity-40 hover:opacity-80"
                          }`}
                        >
                          👎
                        </button>
                      </form>
                    </span>
                  </div>
                </li>
              ))}
              </ul>
            </div>
          </details>
        </section>

        <MessageBoard
          emailAccounts={emailAccounts}
          emailItems={emailItems}
          emailErrors={emailErrors}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-4 md:items-start">
        <div className="flex flex-col gap-8 md:col-span-3">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              3 Things — today&apos;s core wins ({mitCount}/3)
            </h2>
            <div className="rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] p-3">
              {mitCount === 0 && (
                <p className="text-sm text-muted">
                  Nothing picked yet — check the star on up to 3 tasks below.
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {mitTasks?.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <span className="text-warn">★</span>
                    <span className={t.is_done ? "text-muted line-through" : ""}>{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Today&apos;s Checklist
              </h2>
              <div className="flex items-center gap-2">
                <AddTaskButton today={today} projects={projects ?? []} />
                <EditRecurringTasksButton templates={recurringTemplates} />
              </div>
            </div>
            <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="p-3">
                <div className="mb-2 flex items-center justify-between gap-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">To-Do</h3>
                </div>
                <TodoList todos={todos} subtasksByParent={subtasksByParent} />
              </div>

              <div className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Habits ({habitsDoneTodaySet.size}/{habits.length})
                  </h3>
                  <Link href="/habits" className="text-[11px] text-muted hover:text-accent">
                    Full tracker →
                  </Link>
                </div>
                {habits.length === 0 && <p className="text-sm text-muted">No habits yet.</p>}
                <ul className="flex flex-col gap-3">
                  {habitGroups.map((group) => (
                    <li key={group.category}>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {group.category}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {group.habits.map((h) => {
                          const checked = habitsDoneTodaySet.has(h.id);
                          return (
                            <li key={h.id} className="flex items-center gap-2 text-sm">
                              <InstantCheck
                                checked={checked}
                                onToggle={toggleHabitLog.bind(null, h.id, today)}
                                ariaLabel={`Toggle ${h.title} for today`}
                                boxClassName="h-3.5 w-3.5"
                              >
                                {h.title}
                              </InstantCheck>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

        </div>

        <div className="flex flex-col gap-8 md:col-span-1">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Calendar
            </h2>
            <div className="rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] p-4 text-sm">
              {!calendarConnected && (
                <div className="flex flex-col gap-2">
                  <p className="text-muted">Connect Google Calendar to see today&apos;s schedule here.</p>
                  <a
                    href="/api/auth/google/start"
                    className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"
                  >
                    Connect Google Calendar
                  </a>
                </div>
              )}

              {calendarConnected && calendarError && (
                <div className="flex flex-col gap-2">
                  <p className="text-bad">
                    Couldn&apos;t load your calendar right now — try disconnecting and reconnecting.
                  </p>
                  <form action={disconnectGoogleCalendar}>
                    <button
                      type="submit"
                      className="self-start rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
                    >
                      Disconnect
                    </button>
                  </form>
                </div>
              )}

              {calendarConnected && !calendarError && (
                <div className="flex flex-col gap-2">
                  {calendarEvents.length === 0 && (
                    <p className="text-muted">Nothing on your calendar today.</p>
                  )}
                  <DayTimeline events={timedEvents} allDayEvents={allDayEvents} nowMinutes={nowMinutes} />

                  <form action={disconnectGoogleCalendar}>
                    <button type="submit" className="self-start text-xs text-muted hover:text-bad">
                      Disconnect
                    </button>
                  </form>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

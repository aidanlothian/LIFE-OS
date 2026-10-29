import type { Habit } from "@/types";

export function daysBetweenUTC(earlier: string, later: string) {
  const a = new Date(`${earlier}T00:00:00Z`).getTime();
  const b = new Date(`${later}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

export function addDaysUTC(dateStr: string, n: number) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Calendar days between start and end inclusive, minus any dates in
// `excludedDates` — the actual count used as a stats denominator, not just
// raw date arithmetic, so an excluded stretch shrinks the window instead of
// diluting it.
function countTrackedDays(start: string, end: string, excludedDates: Set<string>) {
  const totalDays = daysBetweenUTC(start, end) + 1;
  if (excludedDates.size === 0) return Math.max(1, totalDays);
  let excluded = 0;
  for (let i = 0; i < totalDays; i++) {
    if (excludedDates.has(addDaysUTC(start, i))) excluded++;
  }
  return Math.max(1, totalDays - excluded);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// All calendar days in a given month, descending (most recent first). If
// `capAt` falls inside this month, stops there instead of running to the
// month's last day — used for the current month, where days after today
// haven't happened yet.
export function monthDaysDescending(year: number, month: number, capAt?: string) {
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthPrefix = `${year}-${pad2(month)}-`;
  const days: string[] = [];
  for (let day = lastOfMonth; day >= 1; day--) {
    const dateStr = `${monthPrefix}${pad2(day)}`;
    if (capAt && dateStr > capAt) continue;
    days.push(dateStr);
  }
  return days;
}

export interface HabitLogRow {
  habit_id: string;
  log_date: string;
}

// Generalizes the old fixed-30-day-window stats to any date window (a full
// calendar month, or the current month capped at today). "All-time" still
// looks across every log regardless of the window; "window%" is scoped to
// just the given days, both clamped so backfilling before a habit's
// created_at (or before the window) widens the denominator instead of
// letting the percentage blow past 100. `excludedDates` removes days from
// both the numerator (a check-off on an excluded day doesn't count) and the
// denominator (an excluded day isn't a "missed" day either) — a stretch of
// not using the tracker shrinks the measured window instead of dragging
// every percentage down.
export function habitStatsForWindow(
  habit: Habit,
  logs: HabitLogRow[],
  windowDays: string[],
  excludedDates: Set<string> = new Set()
) {
  const habitLogs = logs.filter((l) => l.habit_id === habit.id && !excludedDates.has(l.log_date));
  const windowStart = windowDays[windowDays.length - 1];
  const windowEnd = windowDays[0];

  const allTimeCompleted = habitLogs.length;
  const windowCompleted = habitLogs.filter(
    (l) => l.log_date >= windowStart && l.log_date <= windowEnd
  ).length;

  const createdDate = habit.created_at.slice(0, 10);
  const earliestLogDate = habitLogs.reduce(
    (min, l) => (l.log_date < min ? l.log_date : min),
    windowEnd
  );
  const allTimeStart = earliestLogDate < createdDate ? earliestLogDate : createdDate;
  const allTimeDenom = countTrackedDays(allTimeStart, windowEnd, excludedDates);

  const effectiveWindowStart = createdDate > windowStart ? createdDate : windowStart;
  const windowDenom = countTrackedDays(effectiveWindowStart, windowEnd, excludedDates);

  return {
    allTimePct: Math.min(100, Math.round((allTimeCompleted / allTimeDenom) * 100)),
    windowPct: Math.min(100, Math.round((windowCompleted / windowDenom) * 100)),
  };
}

export interface BestWorst {
  habit: Habit;
  pct: number;
}

// Ranks habits by their windowPct for the given days. Ties keep the first
// habit encountered (category/sort_order-ish order, since callers pass
// habits in that order already) — good enough for a personal tool.
export function bestWorstHabit(
  habits: Habit[],
  logs: HabitLogRow[],
  windowDays: string[],
  excludedDates: Set<string> = new Set()
): { best: BestWorst | null; worst: BestWorst | null } {
  if (habits.length === 0) return { best: null, worst: null };

  let best: BestWorst | null = null;
  let worst: BestWorst | null = null;
  for (const habit of habits) {
    const { windowPct } = habitStatsForWindow(habit, logs, windowDays, excludedDates);
    if (!best || windowPct > best.pct) best = { habit, pct: windowPct };
    if (!worst || windowPct < worst.pct) worst = { habit, pct: windowPct };
  }
  return { best, worst };
}

export interface HabitGroup {
  category: string;
  categoryOrder: number;
  habits: Habit[];
}

export function groupByCategory(habits: Habit[]): HabitGroup[] {
  const byCategory = new Map<string, Habit[]>();
  for (const h of habits) {
    const list = byCategory.get(h.category) ?? [];
    list.push(h);
    byCategory.set(h.category, list);
  }

  const groups: HabitGroup[] = Array.from(byCategory.entries()).map(([category, list]) => ({
    category,
    categoryOrder: list[0]?.category_order ?? 0,
    habits: list.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)),
  }));

  groups.sort((a, b) => a.categoryOrder - b.categoryOrder);
  return groups;
}

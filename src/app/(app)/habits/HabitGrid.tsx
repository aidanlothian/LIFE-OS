"use client";

import { Fragment, startTransition, useState, type CSSProperties, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { groupByCategory, habitStatsForWindow, type HabitLogRow } from "@/lib/habits";
import {
  deleteCategory,
  deleteHabit,
  moveCategory,
  reorderHabit,
  renameCategory,
  toggleExcludedDay,
  toggleHabitLog,
  updateHabit,
} from "./actions";
import InstantCheck from "@/components/InstantCheck";
import type { Habit } from "@/types";

const HANDLE_COL = 28;
const STAT_COL = 64;
const NAME_COL = 210;
const PIN_COL = 56;
const DAY_COL = 40;
const ACTIONS_COL = 90;
const SCROLLBAR_H = 8;
// Applied to every body <tr> in both tables so rows line up regardless of
// what's inside them (checkboxes, plain text, or an inline edit form) —
// two independent <table>s side by side only stay aligned if every row is
// forced to the same height.
const ROW_H = "h-9";

function formatDayLabel(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

export default function HabitGrid({
  habits,
  logs,
  days,
  pinToday = false,
  showControls = false,
  editHabitId,
  editCategoryName,
  excludedDates = new Set(),
}: {
  habits: Habit[];
  logs: HabitLogRow[];
  days: string[]; // descending, most recent first
  pinToday?: boolean;
  showControls?: boolean;
  editHabitId?: string;
  editCategoryName?: string;
  excludedDates?: Set<string>;
}) {
  const router = useRouter();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [pendingExclude, setPendingExclude] = useState(false);

  function handleToggleExcluded(dateStr: string, nextExcluded: boolean) {
    if (pendingExclude) return;
    setPendingExclude(true);
    startTransition(async () => {
      await toggleExcludedDay(dateStr, nextExcluded);
      router.refresh();
      setPendingExclude(false);
    });
  }

  const pinned = pinToday ? days[0] : null;
  const history = pinToday ? days.slice(1) : days;
  const groups = groupByCategory(habits);
  const totalHabits = habits.length;
  const pinnedColCount = (showControls ? 1 : 0) + 3 + (pinned ? 1 : 0);

  const dailyCounts = new Map<string, number>();
  for (const l of logs) {
    if (history.includes(l.log_date) || l.log_date === pinned) {
      dailyCounts.set(l.log_date, (dailyCounts.get(l.log_date) ?? 0) + 1);
    }
  }
  const completedSet = new Set(logs.map((l) => `${l.habit_id}|${l.log_date}`));
  const pctFor = (d: string) =>
    totalHabits > 0 ? Math.round(((dailyCounts.get(d) ?? 0) / totalHabits) * 100) : 0;

  const tableStyle = {
    tableLayout: "fixed" as const,
    borderCollapse: "separate" as const,
    borderSpacing: 0,
  };

  function handleDrop(e: DragEvent, category: string, targetIndex: number) {
    e.preventDefault();
    const id = draggedId;
    setDraggedId(null);
    if (!id) return;
    // Calling a Server Action directly from an event handler (rather than a
    // <form action={...}>) doesn't automatically refresh the page's data —
    // that only happens for form submissions. Without the explicit refresh
    // here, the old position can still be showing from stale client-cached
    // state at the same time the new position appears elsewhere.
    startTransition(async () => {
      await reorderHabit(id, category, targetIndex);
      router.refresh();
    });
  }

  return (
    <div className="flex overflow-hidden rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)]">
      <style>{`
        .habit-scroll::-webkit-scrollbar { height: ${SCROLLBAR_H}px; }
        .habit-scroll::-webkit-scrollbar-track { background: transparent; }
        .habit-scroll::-webkit-scrollbar-thumb { background: #ded6c3; border-radius: 9999px; }
        .habit-scroll::-webkit-scrollbar-thumb:hover { background: #8c8372; }
      `}</style>

      <div className="flex shrink-0 flex-col">
        <table className="text-sm" style={tableStyle}>
          <colgroup>
            {showControls && <col style={{ width: HANDLE_COL }} />}
            <col style={{ width: STAT_COL }} />
            <col style={{ width: STAT_COL }} />
            <col style={{ width: NAME_COL }} />
            {pinned && <col style={{ width: PIN_COL }} />}
          </colgroup>
          <thead>
            <tr className={ROW_H}>
              {showControls && <th className="border-b border-r border-border" />}
              <th className="whitespace-nowrap border-b border-r border-border px-2 py-2 text-center text-[11px] font-medium text-muted">
                All-time
              </th>
              <th className="whitespace-nowrap border-b border-r border-border px-2 py-2 text-center text-[11px] font-medium text-muted">
                Month
              </th>
              <th className="whitespace-nowrap border-b border-r border-border px-3 py-2 text-left text-[11px] font-medium text-muted">
                Habit
              </th>
              {pinned && (
                <th
                  className={`cursor-pointer whitespace-nowrap border-b border-r border-border px-1 py-2 text-center text-[11px] font-medium ${
                    excludedDates.has(pinned) ? "bg-border/40 text-muted line-through" : "text-muted"
                  }`}
                  title={`${pinned} — click to ${excludedDates.has(pinned) ? "include in" : "exclude from"} stats`}
                  onClick={() => handleToggleExcluded(pinned, !excludedDates.has(pinned))}
                >
                  Today
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <tr className={`${ROW_H} bg-bg/60`}>
              {showControls && <td className="border-b border-r border-border" />}
              <td className="border-b border-r border-border" />
              <td className="border-b border-r border-border" />
              <td className="whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-xs font-medium text-muted">
                Daily completion
              </td>
              {pinned && (
                <td
                  className={`border-b border-r border-border px-1 py-1.5 text-center text-[11px] text-muted ${
                    excludedDates.has(pinned) ? "bg-border/40" : ""
                  }`}
                >
                  {excludedDates.has(pinned) ? "—" : `${pctFor(pinned)}%`}
                </td>
              )}
            </tr>

            {groups.map((group, gi) => (
              <Fragment key={group.category}>
                <tr
                  className={ROW_H}
                  onDragOver={showControls ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    showControls ? (e) => handleDrop(e, group.category, group.habits.length) : undefined
                  }
                >
                  <td
                    colSpan={pinnedColCount}
                    className="border-b border-border bg-border/30 px-3 py-1"
                  >
                    {showControls && editCategoryName === group.category ? (
                      <form
                        action={renameCategory.bind(null, group.category)}
                        className="flex items-center gap-2"
                      >
                        <input
                          name="name"
                          defaultValue={group.category}
                          autoFocus
                          className="rounded border border-border bg-bg px-2 py-0.5 text-xs outline-none focus:border-accent"
                        />
                        <button type="submit" className="text-xs text-accent hover:opacity-80">
                          Save
                        </button>
                        <Link href="/habits" className="text-xs text-muted hover:text-text">
                          Cancel
                        </Link>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted">
                          {group.category}
                        </span>
                        {showControls && (
                          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted">
                            <form action={moveCategory.bind(null, group.category, "up")}>
                              <button
                                type="submit"
                                disabled={gi === 0}
                                className="hover:text-text disabled:opacity-30"
                                aria-label={`Move ${group.category} up`}
                              >
                                ↑
                              </button>
                            </form>
                            <form action={moveCategory.bind(null, group.category, "down")}>
                              <button
                                type="submit"
                                disabled={gi === groups.length - 1}
                                className="hover:text-text disabled:opacity-30"
                                aria-label={`Move ${group.category} down`}
                              >
                                ↓
                              </button>
                            </form>
                            <Link
                              href={`/habits?editCategory=${encodeURIComponent(group.category)}`}
                              className="hover:text-text"
                            >
                              Rename
                            </Link>
                            <form action={deleteCategory.bind(null, group.category)}>
                              <button type="submit" className="hover:text-bad">
                                Delete section
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                {group.habits.map((habit, hi) => {
                  const { allTimePct, windowPct } = habitStatsForWindow(habit, logs, days, excludedDates);
                  const editing = showControls && editHabitId === habit.id;
                  const checkedPinned = pinned ? completedSet.has(`${habit.id}|${pinned}`) : false;
                  return (
                    <tr
                      key={habit.id}
                      className={`${ROW_H} hover:bg-border/10 ${
                        draggedId === habit.id ? "opacity-40" : ""
                      }`}
                      onDragOver={showControls ? (e) => e.preventDefault() : undefined}
                      onDrop={showControls ? (e) => handleDrop(e, group.category, hi) : undefined}
                    >
                      {showControls && (
                        <td
                          className="cursor-grab select-none border-b border-r border-border text-center text-muted active:cursor-grabbing"
                          draggable
                          style={{ WebkitUserDrag: "element" } as CSSProperties}
                          onDragStart={(e) => {
                            // Firefox (and some others) silently abort the
                            // whole drag sequence — no dragover/drop ever
                            // fire — if dataTransfer has no data set here.
                            e.dataTransfer.setData("text/plain", habit.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDraggedId(habit.id);
                          }}
                          onDragEnd={() => setDraggedId(null)}
                          aria-label={`Drag to reorder ${habit.title}`}
                          title="Drag to reorder"
                        >
                          ⠿
                        </td>
                      )}
                      <td className="border-b border-r border-border px-2 py-1.5 text-center text-xs text-muted">
                        {allTimePct}%
                      </td>
                      <td className="border-b border-r border-border px-2 py-1.5 text-center text-xs text-muted">
                        {windowPct}%
                      </td>
                      <td
                        title={habit.title}
                        className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-border px-3 py-1.5"
                      >
                        {editing ? (
                          <form
                            action={updateHabit.bind(null, habit.id)}
                            className="flex items-center gap-1"
                          >
                            <input
                              name="title"
                              defaultValue={habit.title}
                              autoFocus
                              className="w-20 rounded border border-border bg-bg px-1.5 py-0.5 text-xs outline-none focus:border-accent"
                            />
                            <input
                              name="category"
                              defaultValue={habit.category}
                              className="w-16 rounded border border-border bg-bg px-1.5 py-0.5 text-xs outline-none focus:border-accent"
                            />
                            <button type="submit" className="text-xs text-accent hover:opacity-80">
                              Save
                            </button>
                          </form>
                        ) : (
                          habit.title
                        )}
                      </td>
                      {pinned && (
                        <td
                          className={`border-b border-r border-border px-1 py-1.5 text-center ${
                            excludedDates.has(pinned) ? "bg-border/40" : ""
                          }`}
                        >
                          <InstantCheck
                            checked={checkedPinned}
                            onToggle={toggleHabitLog.bind(null, habit.id, pinned)}
                            ariaLabel={`Toggle ${habit.title} for today`}
                            boxClassName="mx-auto block h-4 w-4"
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div style={{ height: SCROLLBAR_H }} />
      </div>

      <div
        className="habit-scroll overflow-x-auto"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#ded6c3 transparent" }}
      >
        <table className="text-sm" style={tableStyle}>
          <colgroup>
            {history.map((d) => (
              <col key={d} style={{ width: DAY_COL }} />
            ))}
            {showControls && <col style={{ width: ACTIONS_COL }} />}
          </colgroup>
          <thead>
            <tr className={ROW_H}>
              {history.map((d) => (
                <th
                  key={d}
                  title={`${d} — click to ${excludedDates.has(d) ? "include in" : "exclude from"} stats`}
                  onClick={() => handleToggleExcluded(d, !excludedDates.has(d))}
                  className={`cursor-pointer border-b border-border px-1 py-2 text-center text-[11px] font-medium ${
                    excludedDates.has(d) ? "bg-border/40 text-muted line-through" : "text-muted"
                  }`}
                >
                  {formatDayLabel(d)}
                </th>
              ))}
              {showControls && (
                <th className="border-b border-border px-2 py-2 text-center font-medium text-muted">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <tr className={`${ROW_H} bg-bg/60`}>
              {history.map((d) => (
                <td
                  key={d}
                  className={`border-b border-border px-1 py-1.5 text-center text-[11px] text-muted ${
                    excludedDates.has(d) ? "bg-border/40" : ""
                  }`}
                >
                  {excludedDates.has(d) ? "—" : `${pctFor(d)}%`}
                </td>
              ))}
              {showControls && <td className="border-b border-border" />}
            </tr>

            {groups.map((group) => (
              <Fragment key={group.category}>
                <tr
                  className={ROW_H}
                  onDragOver={showControls ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    showControls ? (e) => handleDrop(e, group.category, group.habits.length) : undefined
                  }
                >
                  <td
                    colSpan={history.length + (showControls ? 1 : 0)}
                    className="border-b border-border bg-border/30"
                  />
                </tr>
                {group.habits.map((habit, hi) => (
                  <tr
                    key={habit.id}
                    className={`${ROW_H} hover:bg-border/10 ${
                      draggedId === habit.id ? "opacity-40" : ""
                    }`}
                    onDragOver={showControls ? (e) => e.preventDefault() : undefined}
                    onDrop={showControls ? (e) => handleDrop(e, group.category, hi) : undefined}
                  >
                    {history.map((d) => {
                      const checked = completedSet.has(`${habit.id}|${d}`);
                      return (
                        <td
                          key={d}
                          className={`border-b border-border px-1 py-1.5 text-center ${
                            excludedDates.has(d) ? "bg-border/40" : ""
                          }`}
                        >
                          <InstantCheck
                            checked={checked}
                            onToggle={toggleHabitLog.bind(null, habit.id, d)}
                            ariaLabel={`Toggle ${habit.title} for ${d}`}
                            boxClassName="mx-auto block h-4 w-4"
                          />
                        </td>
                      );
                    })}
                    {showControls && (
                      <td className="border-b border-border px-2 py-1.5">
                        <div className="flex items-center justify-center gap-2 text-xs text-muted">
                          {editHabitId === habit.id ? (
                            <Link href="/habits" className="hover:text-text">
                              Cancel
                            </Link>
                          ) : (
                            <Link href={`/habits?editHabit=${habit.id}`} className="hover:text-text">
                              Edit
                            </Link>
                          )}
                          <form action={deleteHabit.bind(null, habit.id)}>
                            <button type="submit" className="hover:text-bad">
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

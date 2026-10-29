"use client";

import Link from "next/link";
import { startTransition, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { monthLabel } from "@/lib/habits";
import { monthGridDays, nextMonthKey, prevMonthKey } from "@/lib/todoCalendar";
import { clearTaskDueDate, rescheduleTask, toggleDone } from "../actions";
import type { Task } from "@/types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TaskCalendar({
  year,
  month,
  tasksByDate,
  today,
}: {
  year: number;
  month: number;
  tasksByDate: Record<string, Task[]>;
  today: string;
}) {
  const router = useRouter();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [pending, setPending] = useState(false);

  const days = monthGridDays(year, month);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;

  // Clicking a task on the calendar opens this widget instead of toggling
  // it done directly — the calendar is dense enough that an accidental tap
  // shouldn't silently complete something. Done/move both live here.
  function handleToggleDone() {
    if (!selectedTask) return;
    const task = selectedTask;
    setPending(true);
    startTransition(async () => {
      await toggleDone(task.id, !task.is_done);
      router.refresh();
      setPending(false);
      setSelectedTask(null);
    });
  }

  function handleMoveDate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedTask) return;
    const formData = new FormData(e.currentTarget);
    const newDate = String(formData.get("due_date") || "");
    if (!newDate) return;
    const task = selectedTask;
    // Same day picked back — nothing to save, just close.
    if (newDate === task.due_date) {
      setSelectedTask(null);
      return;
    }
    setPending(true);
    startTransition(async () => {
      await rescheduleTask(task.id, newDate);
      router.refresh();
      setPending(false);
      setSelectedTask(null);
    });
  }

  // Every task on the calendar has a date, so this always means "take it off
  // the calendar and make it evergreen".
  function handleClearDate() {
    if (!selectedTask) return;
    const task = selectedTask;
    setPending(true);
    startTransition(async () => {
      await clearTaskDueDate(task.id);
      router.refresh();
      setPending(false);
      setSelectedTask(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Link
          href={`/todo?month=${prevMonthKey(year, month)}`}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
        >
          ← Prev
        </Link>
        <h2 className="text-base font-semibold">{monthLabel(year, month)}</h2>
        <Link
          href={`/todo?month=${nextMonthKey(year, month)}`}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
        >
          Next →
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="bg-panel px-2 py-1.5 text-center font-medium text-muted">
            {w}
          </div>
        ))}

        {days.map((d) => {
          const inMonth = d.startsWith(monthPrefix);
          const isToday = d === today;
          const dayNumber = Number(d.slice(8, 10));
          // Unchecked-first is purely a calendar-view convenience — the
          // actual to-do lists elsewhere keep their own drag order.
          const dayTasks = [...(tasksByDate[d] ?? [])].sort((a, b) => {
            if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
            return a.sort_order - b.sort_order;
          });

          return (
            <div
              key={d}
              className={`flex min-h-[84px] flex-col gap-0.5 bg-panel p-1.5 ${
                inMonth ? "" : "bg-bg/60"
              }`}
            >
              <span
                className={`self-start rounded px-1 text-[11px] ${
                  isToday
                    ? "bg-accent font-semibold text-bg"
                    : inMonth
                      ? "text-muted"
                      : "text-muted/50"
                }`}
              >
                {dayNumber}
              </span>
              <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 64 }}>
                {dayTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.title}
                    onClick={() => setSelectedTask(t)}
                    className={`w-full shrink-0 truncate rounded px-1 py-0.5 text-left text-[11px] ${
                      t.is_done
                        ? "text-muted line-through"
                        : "bg-border/50 text-text hover:bg-border"
                    }`}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-panel p-4 shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-text">{selectedTask.title}</h3>

            <button
              type="button"
              onClick={handleToggleDone}
              disabled={pending}
              className={`mb-3 w-full rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                selectedTask.is_done
                  ? "border-border text-muted hover:text-text"
                  : "border-good bg-good/10 text-good hover:bg-good/20"
              }`}
            >
              {selectedTask.is_done ? "Mark not done" : "Mark done"}
            </button>

            <form onSubmit={handleMoveDate} className="flex flex-col gap-2">
              <label className="text-xs text-muted">Move to a different day</label>
              <div className="flex items-center gap-2">
                <input
                  name="due_date"
                  type="date"
                  required
                  defaultValue={selectedTask.due_date ?? today}
                  disabled={pending}
                  className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  Move
                </button>
              </div>
            </form>

            <button
              type="button"
              onClick={handleClearDate}
              disabled={pending}
              title="Takes it off the calendar and puts it in Evergreen"
              className="mt-2 text-xs text-muted hover:text-accent disabled:opacity-50"
            >
              Remove date (make evergreen)
            </button>

            <button
              type="button"
              onClick={() => setSelectedTask(null)}
              disabled={pending}
              className="mt-3 block text-sm text-muted hover:text-text"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

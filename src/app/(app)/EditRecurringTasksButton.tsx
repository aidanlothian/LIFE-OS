"use client";

import { startTransition, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addRecurringTemplate,
  deleteRecurringTemplate,
  reorderRecurringTemplate,
  toggleRecurringTemplateActive,
  updateRecurringTemplate,
} from "./recurringActions";
import { moveItem } from "@/lib/recurring";
import type { RecurrenceType, RecurringTemplate } from "@/types";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A fixed leap year so Feb 29 is selectable — only the month/day the user
// picks is ever saved (see parseTemplateForm), the year is discarded.
function toYearlyDateValue(month: number | null, day: number | null) {
  if (!month || !day) return "";
  return `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function recurrenceSummary(t: RecurringTemplate) {
  if (t.recurrence_type === "daily") return "Every day";
  if (t.recurrence_type === "weekly") {
    return t.days_of_week.length > 0
      ? t.days_of_week
          .slice()
          .sort((a, b) => a - b)
          .map((d) => DOW_LABELS[d])
          .join(", ")
      : "No days selected";
  }
  if (t.yearly_month && t.yearly_day) {
    return `Yearly on ${t.yearly_month}/${t.yearly_day}`;
  }
  return "";
}

// Shared by both the "add new" and "edit existing" forms — which extra
// fields show depends on the currently-selected recurrence type, so this
// needs to be a controlled input rather than a plain uncontrolled form.
function RecurrenceFields({
  recurrenceType,
  onRecurrenceTypeChange,
  defaultDaysOfWeek,
  defaultYearlyDate,
}: {
  recurrenceType: RecurrenceType;
  onRecurrenceTypeChange: (t: RecurrenceType) => void;
  defaultDaysOfWeek: number[];
  defaultYearlyDate: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {(
          [
            ["daily", "Every day"],
            ["weekly", "Specific days"],
            ["yearly", "Once a year"],
          ] as [RecurrenceType, string][]
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-1">
            <input
              type="radio"
              name="recurrence_type"
              value={value}
              checked={recurrenceType === value}
              onChange={() => onRecurrenceTypeChange(value)}
            />
            {label}
          </label>
        ))}
      </div>

      {recurrenceType === "weekly" && (
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          {DOW_LABELS.map((label, i) => (
            <label key={i} className="flex items-center gap-1">
              <input type="checkbox" name={`dow_${i}`} defaultChecked={defaultDaysOfWeek.includes(i)} />
              {label}
            </label>
          ))}
        </div>
      )}

      {recurrenceType === "yearly" && (
        <input
          type="date"
          name="yearly_date"
          required
          defaultValue={defaultYearlyDate}
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
        />
      )}
    </div>
  );
}

export default function EditRecurringTasksButton({ templates }: { templates: RecurringTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [pending, setPending] = useState(false);
  const [formRecurrence, setFormRecurrence] = useState<RecurrenceType>("daily");
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Which row is showing its inline "Delete? Yes / Cancel" — an in-page
  // confirmation instead of the browser's native pop-up.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // A local copy of the server's order so a drop reorders instantly instead
  // of waiting on the save + refresh; it re-syncs to the server's order
  // whenever fresh data arrives (which also undoes the move if a save fails).
  const [items, setItems] = useState(templates);
  useEffect(() => {
    setItems(templates);
  }, [templates]);

  function handleDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const id = draggedId;
    setDraggedId(null);
    if (!id) return;
    const from = items.findIndex((t) => t.id === id);
    if (from === -1 || from === targetIndex) return;

    setItems(moveItem(items, from, targetIndex));
    setError(null);
    setPending(true);
    startTransition(async () => {
      const ok = await reorderRecurringTemplate(id, targetIndex);
      if (!ok) setError("Couldn't save the new order. Try again.");
      router.refresh();
      setPending(false);
    });
  }

  function startEditing(t: RecurringTemplate) {
    setFormRecurrence(t.recurrence_type);
    setEditingId(t.id);
  }

  function startAdding() {
    setFormRecurrence("daily");
    setEditingId("new");
  }

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await addRecurringTemplate(formData);
      router.refresh();
      setEditingId(null);
      setPending(false);
    });
  }

  function handleUpdate(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await updateRecurringTemplate(id, formData);
      router.refresh();
      setEditingId(null);
      setPending(false);
    });
  }

  function handleDelete(t: RecurringTemplate) {
    setConfirmingId(null);
    setError(null);
    setPending(true);
    startTransition(async () => {
      const ok = await deleteRecurringTemplate(t.id);
      if (!ok) setError(`Couldn't delete "${t.title}". Try again.`);
      router.refresh();
      setPending(false);
    });
  }

  function handleToggleActive(id: string, next: boolean) {
    startTransition(async () => {
      await toggleRecurringTemplateActive(id, next);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
      >
        Edit recurring tasks
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-text">Recurring tasks</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-muted hover:text-text"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {error && (
                <p className="mb-2 rounded-md border border-bad/40 bg-bad/10 px-2 py-1 text-xs text-bad">
                  {error}
                </p>
              )}
              {items.length === 0 && (
                <p className="text-sm text-muted">No recurring tasks yet.</p>
              )}
              {items.length > 1 && (
                <p className="mb-2 text-[11px] text-muted">
                  Drag ⠿ to set the order they appear on your list each day.
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {items.map((t, index) => (
                  <li
                    key={t.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`rounded-md border border-border p-2.5 ${
                      draggedId === t.id ? "opacity-40" : ""
                    }`}
                  >
                    {editingId === t.id ? (
                      <form onSubmit={(e) => handleUpdate(t.id, e)} className="flex flex-col gap-2">
                        <input
                          name="title"
                          defaultValue={t.title}
                          required
                          autoFocus
                          className="rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                        />
                        <RecurrenceFields
                          recurrenceType={formRecurrence}
                          onRecurrenceTypeChange={setFormRecurrence}
                          defaultDaysOfWeek={t.days_of_week}
                          defaultYearlyDate={toYearlyDateValue(t.yearly_month, t.yearly_day)}
                        />
                        <div className="flex items-center gap-3">
                          <button
                            type="submit"
                            disabled={pending}
                            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-muted hover:text-text"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <span
                            draggable
                            onDragStart={(e) => {
                              // Firefox (and some others) silently abort the
                              // drag without data set here.
                              e.dataTransfer.setData("text/plain", t.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDraggedId(t.id);
                            }}
                            onDragEnd={() => setDraggedId(null)}
                            aria-label={`Drag to reorder ${t.title}`}
                            title="Drag to reorder"
                            className="mt-0.5 cursor-grab select-none text-muted active:cursor-grabbing"
                          >
                            ⠿
                          </span>
                          <div className="flex flex-col gap-0.5">
                            <span className={`text-sm ${t.active ? "text-text" : "text-muted line-through"}`}>
                              {t.title}
                            </span>
                            {confirmingId === t.id ? (
                              <span className="text-[11px] text-bad">
                                Also comes off today&apos;s list if it isn&apos;t checked off yet.
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted">{recurrenceSummary(t)}</span>
                            )}
                          </div>
                        </div>
                        {confirmingId === t.id ? (
                          <div className="flex shrink-0 items-center gap-2 text-xs">
                            <span className="text-muted">Delete?</span>
                            <button
                              type="button"
                              onClick={() => handleDelete(t)}
                              disabled={pending}
                              className="font-medium text-bad hover:opacity-80 disabled:opacity-50"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              className="text-muted hover:text-text"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(t.id, !t.active)}
                              className="hover:text-accent"
                            >
                              {t.active ? "Pause" : "Resume"}
                            </button>
                            <button type="button" onClick={() => startEditing(t)} className="hover:text-accent">
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(t.id)}
                              disabled={pending}
                              className="hover:text-bad disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-3 border-t border-border pt-3">
                {editingId === "new" ? (
                  <form onSubmit={handleAdd} className="flex flex-col gap-2">
                    <input
                      name="title"
                      placeholder="Task name"
                      required
                      autoFocus
                      className="rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                    />
                    <RecurrenceFields
                      recurrenceType={formRecurrence}
                      onRecurrenceTypeChange={setFormRecurrence}
                      defaultDaysOfWeek={[]}
                      defaultYearlyDate=""
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={pending}
                        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={startAdding} className="text-xs text-accent hover:opacity-80">
                    + Add recurring task
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

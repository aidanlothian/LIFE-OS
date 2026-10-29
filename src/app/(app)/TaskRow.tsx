"use client";

import {
  startTransition,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  addSubtask,
  clearTaskDueDate,
  deleteTask,
  listProjectsForPicker,
  rescheduleTask,
  toggleDone,
  toggleMit,
  updateTask,
} from "./actions";
import InstantCheck from "@/components/InstantCheck";
import type { Task } from "@/types";

export default function TaskRow({
  task,
  showStar,
  subtasks = [],
  dragHandle,
  dateAsIcon = false,
}: {
  task: Task;
  showStar: boolean;
  subtasks?: Task[];
  dragHandle?: ReactNode;
  // In a day's own list the date is obvious, so only the calendar icon shows.
  dateAsIcon?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  // Edits show immediately and save in the background; these clear once the
  // server's copy of the task catches up (or show the real values if a save
  // failed).
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [editedProject, setEditedProject] = useState<{ name: string | null } | null>(null);
  useEffect(() => setEditedTitle(null), [task.title]);
  useEffect(() => setEditedProject(null), [task.project_id]);

  const title = editedTitle ?? task.title;
  const projectName = editedProject ? editedProject.name : (task.project?.name ?? null);

  // Click the name to type over it in place; Enter or clicking away saves,
  // Esc cancels.
  function saveTitle(value: string) {
    setEditingTitle(false);
    const next = value.trim();
    if (!next || next === title) return;
    setEditedTitle(next);
    startTransition(async () => {
      await updateTask(task.id, { title: next });
      router.refresh();
    });
  }

  function handleTitleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      e.currentTarget.value = title;
      e.currentTarget.blur();
    }
  }

  function openProjectPicker() {
    setEditingProject(true);
    if (!projects) listProjectsForPicker().then(setProjects);
  }

  // Picking a project saves straight away — no extra confirm step.
  function saveProject(projectId: string | null) {
    setEditingProject(false);
    if (projectId === task.project_id) return;
    const name = projectId ? (projects?.find((p) => p.id === projectId)?.name ?? null) : null;
    setEditedProject({ name });
    startTransition(async () => {
      await updateTask(task.id, { projectId });
      router.refresh();
    });
  }

  function handleAddSubtask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await addSubtask(task.id, formData);
      router.refresh();
      setAdding(false);
      setPending(false);
    });
  }

  function handleSaveDate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newDate = String(formData.get("due_date") || "");
    if (!newDate) return;
    // Same date picked back — nothing to save, skip the server round trip.
    if (newDate === task.due_date) {
      setEditingDate(false);
      return;
    }
    setSavingDate(true);
    startTransition(async () => {
      await rescheduleTask(task.id, newDate);
      router.refresh();
      setEditingDate(false);
      setSavingDate(false);
    });
  }

  function handleClearDate() {
    setSavingDate(true);
    startTransition(async () => {
      await clearTaskDueDate(task.id);
      router.refresh();
      setEditingDate(false);
      setSavingDate(false);
    });
  }

  // Only takes up space when there's actually something to show — no
  // permanent indent/border under tasks that have no subtasks.
  const showSubtaskBlock = subtasks.length > 0 || adding;

  return (
    <div className="py-1">
      <div className="group flex items-center gap-2 text-sm">
        {dragHandle}
        <InstantCheck
          checked={task.is_done}
          onToggle={toggleDone.bind(null, task.id)}
          ariaLabel="Toggle done"
          boxClassName="h-4 w-4"
          labelClassName="min-w-0 flex-1"
        >
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={title}
              onBlur={(e) => saveTitle(e.currentTarget.value)}
              onKeyDown={handleTitleKey}
              aria-label="Task name"
              className="w-full border-b border-accent bg-transparent text-sm text-text no-underline outline-none"
            />
          ) : (
            <span
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
              className="cursor-text"
            >
              {title}
            </span>
          )}
        </InstantCheck>

        {editingProject ? (
          <select
            autoFocus
            defaultValue={task.project_id ?? ""}
            onChange={(e) => saveProject(e.currentTarget.value || null)}
            onBlur={() => setEditingProject(false)}
            onKeyDown={(e) => e.key === "Escape" && setEditingProject(false)}
            aria-label="Project"
            className="max-w-[9rem] rounded border border-border bg-bg px-1 py-0.5 text-[11px] text-muted outline-none focus:border-accent"
          >
            <option value="">No project</option>
            {/* Until the list loads, keep the current project showing. */}
            {!projects && task.project && <option value={task.project.id}>{task.project.name}</option>}
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            {projectName && (
              <button
                type="button"
                onClick={openProjectPicker}
                title="Change project"
                className="rounded bg-border/60 px-1.5 py-0.5 text-[11px] text-muted hover:text-accent"
              >
                {projectName}
              </button>
            )}
            {/* Hover-reveal: most tasks have no project, so it stays out of sight. */}
            <button
              type="button"
              onClick={openProjectPicker}
              aria-label="Set project"
              title={projectName ? "Change project" : "Add to a project"}
              className="text-muted opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100"
            >
              <FolderIcon />
            </button>
          </>
        )}

        {/* Calendar icon opens the date picker; evergreen tasks use it to
            get a date. Outside a day's own list the date shows beside it. */}
        {!editingDate && (
          <button
            type="button"
            onClick={() => setEditingDate(true)}
            title={task.due_date ? "Change due date" : "Set a due date"}
            aria-label={task.due_date ? `Due ${task.due_date}, change date` : "Set a due date"}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted hover:bg-border/50 hover:text-accent"
          >
            <CalendarIcon />
            {!dateAsIcon && task.due_date && <span>{shortDate(task.due_date)}</span>}
          </button>
        )}

        {editingDate && (
          <form onSubmit={handleSaveDate} className="flex items-center gap-1">
            <input
              name="due_date"
              type="date"
              autoFocus
              required
              defaultValue={task.due_date ?? ""}
              disabled={savingDate}
              className="rounded border border-border bg-bg px-1 py-0.5 text-[11px] outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={savingDate}
              aria-label="Save date"
              className="text-[11px] text-good hover:opacity-80 disabled:opacity-50"
            >
              ✓
            </button>
            {task.due_date && (
              <button
                type="button"
                onClick={handleClearDate}
                disabled={savingDate}
                title="Remove the due date (makes it evergreen)"
                className="text-[11px] text-muted hover:text-accent disabled:opacity-50"
              >
                No date
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditingDate(false)}
              disabled={savingDate}
              aria-label="Cancel"
              className="text-[11px] text-muted hover:text-text"
            >
              ✕
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          aria-label="Add subtask"
          title="Add subtask"
          className={adding ? "text-accent" : "text-muted hover:text-accent"}
        >
          ⊕
        </button>

        {showStar && (
          <form action={toggleMit.bind(null, task.id, !task.is_mit, task.due_date)}>
            <button
              type="submit"
              aria-label="Toggle 3 things"
              className={task.is_mit ? "text-warn" : "text-muted hover:text-warn"}
            >
              ★
            </button>
          </form>
        )}

        <form action={deleteTask.bind(null, task.id)}>
          <button type="submit" aria-label="Delete" className="text-muted hover:text-bad">
            ✕
          </button>
        </form>
      </div>

      {showSubtaskBlock && (
        <div className="ml-6 mt-1 flex flex-col gap-1 border-l border-border pl-3">
          {subtasks.map((st) => (
            <div key={st.id} className="flex items-center gap-2 text-xs">
              <InstantCheck
                checked={st.is_done}
                onToggle={toggleDone.bind(null, st.id)}
                ariaLabel="Toggle done"
                boxClassName="h-3.5 w-3.5"
                labelClassName="flex-1"
              >
                {st.title}
              </InstantCheck>
              <form action={deleteTask.bind(null, st.id)}>
                <button type="submit" aria-label="Delete" className="text-muted hover:text-bad">
                  ✕
                </button>
              </form>
            </div>
          ))}

          {adding && (
            <form onSubmit={handleAddSubtask} className="flex items-center gap-1">
              <input
                name="title"
                autoFocus
                disabled={pending}
                placeholder="Subtask name"
                className="w-32 rounded border border-border bg-bg px-1.5 py-0.5 text-xs outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-[11px] text-muted hover:text-text"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// "2026-10-20" -> "Oct 20" (parsed as a plain date, no timezone shift).
function shortDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Inline SVG rather than an emoji so it takes the text color (emoji ignore CSS color).
function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

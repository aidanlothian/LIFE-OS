"use client";

import { startTransition, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { addTask } from "./actions";

// The "Add a task" popup, shared by the Home / To-Do "+ Add task" buttons and
// the Associated To-Dos workspace widget (which opens it with its project
// already picked). Portalled to <body> so it covers the page even when opened
// from inside a transformed workspace widget.
export default function AddTaskModal({
  today,
  projects,
  defaultProjectId = "",
  onClose,
}: {
  today: string;
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await addTask(formData);
      router.refresh();
      onClose();
      setPending(false);
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-panel p-4 shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-text">Add a task</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            name="title"
            required
            autoFocus
            placeholder="Task name"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="due_date"
            type="date"
            defaultValue={today}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <select
            name="project_id"
            defaultValue={defaultProjectId}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
            <button type="button" onClick={onClose} className="text-sm text-muted hover:text-text">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

"use client";

import { startTransition, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addTask } from "./actions";

// Same modal pattern as AddTaskButton, but with no due-date field at all —
// an evergreen task is defined by having no due date, so there's nothing
// to default or clear here, just title (+ optional project).
export default function AddEvergreenTaskButton({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await addTask(formData);
      router.refresh();
      setOpen(false);
      setPending(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
      >
        + Add evergreen task
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-panel p-4 shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-text">Add an evergreen task</h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <input
                name="title"
                required
                autoFocus
                placeholder="Task name"
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
              <select
                name="project_id"
                defaultValue=""
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
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-muted hover:text-text"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import AddTaskModal from "./AddTaskModal";

export default function AddTaskButton({
  today,
  projects,
}: {
  today: string;
  projects: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
      >
        + Add task
      </button>

      {open && <AddTaskModal today={today} projects={projects} onClose={() => setOpen(false)} />}
    </>
  );
}

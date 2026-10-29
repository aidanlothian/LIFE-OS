"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import AddTaskModal from "@/app/(app)/AddTaskModal";
import { formatDeadline } from "@/lib/projects";
import type { SectionContent, WorkspaceTask } from "@/types";

// What an Associated To-Dos widget needs from its page: the live tasks
// (they belong to the To-Do list, not to the widget), the projects (for the
// picker and the add-task popup), and ways to check one off or delete one.
// On a project's own workspace `ownerProjectId` is that project and the
// widget always shows it; elsewhere each widget picks a project (saved as
// content.projectId).
export interface TodoApi {
  // False until the page has loaded task data (right after the first one of
  // these widgets is added, before the reload lands).
  loaded: boolean;
  ownerProjectId: string | null;
  projects: { id: string; name: string }[];
  tasks: WorkspaceTask[];
  today: string;
  setDone: (taskId: string, done: boolean) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<boolean>;
}

export const TodoContext = createContext<TodoApi>({
  loaded: false,
  ownerProjectId: null,
  projects: [],
  tasks: [],
  today: "",
  setDone: async () => false,
  deleteTask: async () => false,
});

// Soonest due date first (undated after), then oldest.
function byDue(a: WorkspaceTask, b: WorkspaceTask) {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  return a.created_at.localeCompare(b.created_at);
}

export default function TodosSection({
  content,
  onChange,
}: {
  content: SectionContent;
  onChange: (patch: SectionContent) => void;
}) {
  const api = useContext(TodoContext);
  const router = useRouter();
  const projectId = api.ownerProjectId ?? content.projectId ?? null;
  const project = api.projects.find((p) => p.id === projectId);

  // Checkboxes and deletes show instantly; both settle when the refreshed
  // tasks arrive from the server.
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDoneOverride({});
    setDeleted(new Set());
  }, [api.tasks]);

  // Side by side only when there's room for three readable columns; a
  // narrow widget (or a phone) falls back to stacked.
  const boxRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, [api.loaded, projectId]);
  const columns = content.layout === "columns" && wide;

  if (!api.loaded) return <p className="text-sm text-muted">Loading to-dos…</p>;

  if (!projectId || (!api.ownerProjectId && !project)) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted">
          {projectId ? "That project no longer exists." : "Show the to-dos tagged with a project:"}
        </p>
        <ProjectPicker
          projects={api.projects}
          value=""
          onPick={(id) => onChange({ projectId: id })}
        />
      </div>
    );
  }

  const tasks = api.tasks
    .filter((t) => t.project_id === projectId && !deleted.has(t.id))
    .map((t) => (t.id in doneOverride ? { ...t, is_done: doneOverride[t.id] } : t))
    .sort(byDue);
  const isOverdue = (t: WorkspaceTask) => !t.is_done && !!t.due_date && t.due_date < api.today;
  const overdue = tasks.filter(isOverdue);
  const active = tasks.filter((t) => !t.is_done && !isOverdue(t));
  const complete = tasks.filter((t) => t.is_done);

  function toggle(task: WorkspaceTask) {
    const next = !task.is_done;
    setError(null);
    setDoneOverride((prev) => ({ ...prev, [task.id]: next }));
    startTransition(async () => {
      if (!(await api.setDone(task.id, next))) setError("Couldn't save that. Try again.");
      router.refresh();
    });
  }

  function remove(task: WorkspaceTask) {
    setError(null);
    setDeleted((prev) => new Set(prev).add(task.id));
    startTransition(async () => {
      if (!(await api.deleteTask(task.id))) setError("Couldn't delete that. Try again.");
      router.refresh();
    });
  }

  const row = (task: WorkspaceTask) => (
    <li key={task.id} className="group/item flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => toggle(task)}
        aria-label={task.is_done ? "Mark not done" : "Mark done"}
        aria-pressed={task.is_done}
        className={`h-4 w-4 shrink-0 rounded border ${
          task.is_done ? "border-good bg-good" : "border-muted"
        }`}
      />
      <span
        className={`min-w-0 flex-1 truncate ${task.is_done ? "text-muted line-through" : "text-text"}`}
        title={task.title}
      >
        {task.title}
      </span>
      {task.due_date && (
        <span className={`shrink-0 text-[11px] ${isOverdue(task) ? "text-bad" : "text-muted"}`}>
          {formatDeadline(task.due_date, api.today)}
        </span>
      )}
      <button
        type="button"
        aria-label="Delete to-do"
        onClick={() => remove(task)}
        className="shrink-0 text-muted opacity-0 hover:text-bad focus:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100"
      >
        ✕
      </button>
    </li>
  );

  const heading = (label: string, count: number, tone = "text-muted") => (
    <h4 className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
      {label} <span className="font-normal">{count}</span>
    </h4>
  );

  const list = (items: WorkspaceTask[]) => <ul className="flex flex-col gap-1">{items.map(row)}</ul>;
  const empty = (text: string) => <p className="text-sm text-muted">{text}</p>;

  const activeGroup = (
    <div className="flex min-w-0 flex-col gap-1">
      {heading("Active", active.length)}
      {active.length === 0
        ? empty(tasks.length === 0 ? "No to-dos tagged with this project yet." : "Nothing active.")
        : list(active)}
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="self-start px-1 py-0.5 text-sm text-muted hover:text-accent"
      >
        + Add to-do
      </button>
    </div>
  );
  // Stacked, an empty Overdue group is left out; side by side, every column
  // stays so the three line up.
  const overdueGroup =
    overdue.length > 0 || columns ? (
      <div className="flex min-w-0 flex-col gap-1">
        {heading("Overdue", overdue.length, overdue.length > 0 ? "text-bad" : "text-muted")}
        {overdue.length > 0 ? list(overdue) : empty("Nothing overdue.")}
      </div>
    ) : null;
  // Complete is folded away when stacked; side by side it has its own
  // column, so it's simply shown.
  const completeGroup = columns ? (
    <div className="flex min-w-0 flex-col gap-1">
      {heading("Complete", complete.length)}
      {complete.length > 0 ? list(complete) : empty("Nothing done yet.")}
    </div>
  ) : complete.length > 0 ? (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => setShowComplete((v) => !v)}
        className="mt-1 self-start text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-accent"
      >
        <span className={`mr-1 inline-block transition-transform ${showComplete ? "rotate-90" : ""}`}>
          ▸
        </span>
        Complete <span className="font-normal">{complete.length}</span>
      </button>
      {showComplete && list(complete)}
    </div>
  ) : null;

  return (
    <div ref={boxRef} className="flex flex-col gap-1">
      {!api.ownerProjectId && (
        <div className="mb-1">
          <ProjectPicker
            projects={api.projects}
            value={projectId}
            onPick={(id) => onChange({ projectId: id })}
            compact
          />
        </div>
      )}

      <Groups columns={columns}>
        {activeGroup}
        {overdueGroup}
        {completeGroup}
      </Groups>

      {error && <p className="text-xs text-bad">{error}</p>}

      {adding && (
        <AddTaskModal
          today={api.today}
          projects={api.projects}
          defaultProjectId={projectId}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function Groups({ columns, children }: { columns: boolean; children: ReactNode }) {
  return (
    <div className={columns ? "grid grid-cols-3 gap-4" : "flex flex-col gap-1"}>{children}</div>
  );
}

function ProjectPicker({
  projects,
  value,
  onPick,
  compact = false,
}: {
  projects: { id: string; name: string }[];
  value: string;
  onPick: (id: string) => void;
  compact?: boolean;
}) {
  if (projects.length === 0) {
    return <p className="text-xs text-muted">No projects yet. Create one in Project Center.</p>;
  }
  return (
    <select
      value={value}
      onChange={(e) => e.target.value && onPick(e.target.value)}
      aria-label="Project"
      className={`max-w-full rounded-md border border-border bg-bg outline-none focus:border-accent ${
        compact ? "px-1.5 py-0.5 text-xs text-muted" : "px-2 py-1 text-sm text-text"
      }`}
    >
      {!value && <option value="">Pick a project…</option>}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

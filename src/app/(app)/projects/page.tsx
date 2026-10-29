import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { STATUS_LABELS, STATUS_ORDER, deadlineInfo } from "@/lib/projects";
import { signPhotoUrls } from "@/lib/workspaceServer";
import { createProject } from "./actions";
import type { Project, ProjectStatus } from "@/types";

const TONE_CLASS = {
  bad: "bg-bad/10 text-bad",
  warn: "bg-warn/10 text-warn",
  muted: "bg-border/60 text-muted",
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const [{ data: projectRows, error }, { data: taskRows, error: tasksError }] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("project_id, is_done")
      .not("project_id", "is", null)
      .is("parent_task_id", null),
  ]);
  if (error) console.error("Failed to fetch projects:", error);
  if (tasksError) console.error("Failed to fetch project tasks:", tasksError);
  const projects = (projectRows ?? []) as Project[];

  const taskCounts = new Map<string, { done: number; total: number }>();
  for (const t of taskRows ?? []) {
    const c = taskCounts.get(t.project_id as string) ?? { done: 0, total: 0 };
    c.total += 1;
    if (t.is_done) c.done += 1;
    taskCounts.set(t.project_id as string, c);
  }

  const coverUrls = await signPhotoUrls(
    supabase,
    projects.map((p) => p.cover_path).filter((p): p is string => !!p)
  );
  const today = getAppDay();

  // Soonest deadline first; open-ended projects after, newest first.
  const byStatus = new Map<ProjectStatus, Project[]>(STATUS_ORDER.map((s) => [s, []]));
  for (const p of projects) byStatus.get(p.status)?.push(p);
  for (const list of byStatus.values()) {
    list.sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Project Center</h1>
          <p className="mt-1 text-sm text-muted">
            Every project, each with its own workspace.
          </p>
        </div>
        <form action={createProject}>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            + New project
          </button>
        </form>
      </header>

      {searchParams.error === "create" && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          Couldn&apos;t create the project. Try again.
        </p>
      )}

      {projects.length === 0 && (
        <p className="text-sm text-muted">
          No projects yet. Use “+ New project” to start one.
        </p>
      )}

      {STATUS_ORDER.map((status) => {
        const list = byStatus.get(status) ?? [];
        if (list.length === 0) return null;
        const grid = (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {list.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                coverUrl={p.cover_path ? coverUrls[p.cover_path] : undefined}
                counts={taskCounts.get(p.id)}
                today={today}
              />
            ))}
          </div>
        );
        const heading = (
          <>
            {STATUS_LABELS[status]}
            <span className="ml-1.5 font-normal normal-case tracking-normal">{list.length}</span>
          </>
        );
        // Complete projects are tucked away until opened.
        if (status === "complete") {
          return (
            <details key={status} className="group flex flex-col gap-3">
              <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-wide text-muted hover:text-accent">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
                {heading}
              </summary>
              <div className="mt-3">{grid}</div>
            </details>
          );
        }
        return (
          <section key={status} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{heading}</h2>
            {grid}
          </section>
        );
      })}
    </div>
  );
}

function ProjectCard({
  project,
  coverUrl,
  counts,
  today,
}: {
  project: Project;
  coverUrl?: string;
  counts?: { done: number; total: number };
  today: string;
}) {
  const due = project.deadline ? deadlineInfo(project.deadline, today, project.status) : null;
  const pct = counts && counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] transition hover:border-accent hover:shadow-[0_2px_8px_rgba(58,53,44,0.16)]"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-border/50">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl font-semibold text-muted/50">
            {project.name.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-text group-hover:text-accent">{project.name}</h3>
          {project.description && (
            <p className="truncate text-sm text-muted">{project.description}</p>
          )}
        </div>
        <div className="mt-auto flex flex-col gap-1.5">
          {due && (
            <span className={`self-start rounded px-1.5 py-0.5 text-[11px] ${TONE_CLASS[due.tone]}`}>
              {due.label}
            </span>
          )}
          {counts && counts.total > 0 ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/70">
                <div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 text-[11px] text-muted">
                {counts.done}/{counts.total} tasks
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-muted">No tasks yet</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// Server-side helpers shared by every workspace owner (Deep Memory pages,
// projects). Kept out of the "use server" actions file so they can't be
// called from the browser.
import type { createClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "@/lib/memoryLayout";
import { ownerColumn, type WorkspaceRef } from "@/lib/workspace";
import { getAppDay } from "@/lib/appDay";
import type { MemorySection, PhotoItem, WorkspaceTask } from "@/types";

type Supabase = ReturnType<typeof createClient>;

// Photo files live in Storage, outside the database, so nothing cascades to
// them: whenever a photo, a Gallery, a Section holding Galleries, a page or a
// project goes away, its files are removed explicitly.
const PHOTO_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i;

export function isPhotoPath(p: unknown): p is string {
  return typeof p === "string" && PHOTO_PATH_RE.test(p);
}

export function photoPathsIn(rows: { type: string; content: unknown }[]): string[] {
  return rows.flatMap((r) => {
    if (r.type !== "gallery") return [];
    const items = (r.content as { items?: { path?: unknown }[] } | null)?.items ?? [];
    return items.map((i) => i.path).filter((p): p is string => typeof p === "string");
  });
}

export async function removePhotoFiles(
  supabase: Supabase,
  userId: string,
  paths: string[]
): Promise<boolean> {
  // Only ever this user's own files (Storage policies enforce it as well).
  const own = paths.filter((p) => isPhotoPath(p) && p.startsWith(`${userId}/`));
  if (own.length === 0) return true;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(own);
  if (error) console.error("Removing photo files failed:", error);
  return !error;
}

// Signs many private photo paths in one request. Missing ones are skipped.
export async function signPhotoUrls(
  supabase: Supabase,
  paths: string[]
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  if (paths.length === 0) return urls;
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
  if (error) console.error("Signing photo URLs failed:", error);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return urls;
}

// Everything a workspace canvas needs to render: its widgets, and signed
// URLs for the photos in its Galleries.
export async function loadWorkspace(supabase: Supabase, ref: WorkspaceRef) {
  const { data: rows, error } = await supabase
    .from("memory_sections")
    .select("*")
    .eq(ownerColumn(ref), ref.id)
    .order("y", { ascending: true })
    .order("x", { ascending: true });
  if (error) console.error("Failed to fetch workspace sections:", error);

  const sections = ((rows ?? []) as MemorySection[]).map((s) => ({
    ...s,
    // These columns are missing on rows read before they were added to the
    // database; those rows are all top-level Deep Memory widgets.
    parent_id: s.parent_id ?? null,
    project_id: s.project_id ?? null,
  }));
  const photoPaths = sections
    .filter((s) => s.type === "gallery")
    .flatMap((s) => ((s.content.items ?? []) as PhotoItem[]).map((p) => p.path));
  const hasTodos = sections.some((s) => s.type === "todos");
  const [photoUrls, todos] = await Promise.all([
    signPhotoUrls(supabase, photoPaths),
    hasTodos ? loadTodoData(supabase, ref) : Promise.resolve(null),
  ]);
  return { sections, photoUrls, todos };
}

// Data for Associated To-Dos widgets: every top-level task tagged with a
// project (the same set the Project Center cards count) and the projects
// (for a widget's picker and the add-task popup). Only loaded when the
// workspace has one of those widgets.
async function loadTodoData(supabase: Supabase, ref: WorkspaceRef) {
  const ownerProjectId = ref.kind === "project" ? ref.id : null;
  let tasksQuery = supabase
    .from("tasks")
    .select("id, title, is_done, due_date, project_id, created_at")
    .is("parent_task_id", null);
  tasksQuery = ownerProjectId
    ? tasksQuery.eq("project_id", ownerProjectId)
    : tasksQuery.not("project_id", "is", null);
  const [{ data: tasks, error: tasksError }, { data: projects, error: projectsError }] =
    await Promise.all([
      tasksQuery,
      supabase.from("projects").select("id, name").order("created_at", { ascending: true }),
    ]);
  if (tasksError) console.error("Failed to fetch workspace to-dos:", tasksError);
  if (projectsError) console.error("Failed to fetch projects for to-dos:", projectsError);
  return {
    ownerProjectId,
    projects: (projects ?? []) as { id: string; name: string }[],
    tasks: (tasks ?? []) as WorkspaceTask[],
    today: getAppDay(),
  };
}

export type WorkspaceTodoData = Awaited<ReturnType<typeof loadTodoData>>;

// Every Gallery photo inside the given owners' workspaces, for cleanup when
// those owners are deleted.
export async function workspacePhotoPaths(
  supabase: Supabase,
  kind: WorkspaceRef["kind"],
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("memory_sections")
    .select("type, content")
    .in(ownerColumn({ kind, id: "" }), ids)
    .eq("type", "gallery");
  if (error) console.error("Reading workspace photos failed:", error);
  return photoPathsIn(data ?? []);
}

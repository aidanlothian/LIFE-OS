"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  isPhotoPath,
  removePhotoFiles,
  workspacePhotoPaths,
} from "@/lib/workspaceServer";
import type { ProjectStatus } from "@/types";

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const STATUSES: ProjectStatus[] = ["active", "on_hold", "complete"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidateProjects(projectId?: string) {
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  // Task rows on Home and To-Do show project names.
  revalidatePath("/");
  revalidatePath("/todo");
}

// "+ New project": creates a blank project and opens its workspace, where
// it gets named and built out.
export async function createProject() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: user.id, name: "Untitled project" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createProject failed:", error);
    redirect("/projects?error=create");
  }
  revalidateProjects();
  redirect(`/projects/${data.id}?new=1`);
}

// Saves whichever header fields changed. Returns whether it worked so the
// page can show a "couldn't save" state.
export async function updateProject(
  projectId: string,
  patch: {
    name?: string;
    description?: string;
    status?: string;
    deadline?: string | null;
  }
): Promise<boolean> {
  const { supabase } = await requireUser();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return false;
    update.name = name.slice(0, 200);
  }
  if (patch.description !== undefined) {
    update.description = patch.description.trim().slice(0, 2000) || null;
  }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status as ProjectStatus)) return false;
    update.status = patch.status;
  }
  if (patch.deadline !== undefined) {
    if (patch.deadline !== null && !DATE_RE.test(patch.deadline)) return false;
    update.deadline = patch.deadline;
  }
  if (Object.keys(update).length === 0) return true;

  const { error } = await supabase.from("projects").update(update).eq("id", projectId);
  if (error) console.error("updateProject failed:", error);
  else revalidateProjects(projectId);
  return !error;
}

// Sets (path) or removes (null) the cover photo. The photo itself was
// already uploaded through /api/memory/photo; the old one is deleted.
export async function setProjectCover(
  projectId: string,
  path: string | null
): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (path !== null && !(isPhotoPath(path) && path.startsWith(`${user.id}/`))) return false;

  const { data: current } = await supabase
    .from("projects")
    .select("cover_path")
    .eq("id", projectId)
    .maybeSingle();
  const { error } = await supabase
    .from("projects")
    .update({ cover_path: path })
    .eq("id", projectId);
  if (error) {
    console.error("setProjectCover failed:", error);
    return false;
  }
  const old = current?.cover_path as string | null | undefined;
  if (old && old !== path) await removePhotoFiles(supabase, user.id, [old]);
  revalidateProjects(projectId);
  return true;
}

// Deletes the project, its workspace (cascade) and their photos. Its tasks
// stay, just no longer tagged with the project.
export async function deleteProject(projectId: string) {
  const { supabase, user } = await requireUser();
  const [{ data: project }, galleryPaths] = await Promise.all([
    supabase.from("projects").select("cover_path").eq("id", projectId).maybeSingle(),
    workspacePhotoPaths(supabase, "project", [projectId]),
  ]);
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) {
    console.error("deleteProject failed:", error);
    redirect(`/projects/${projectId}?error=delete`);
  }
  const paths = [...galleryPaths];
  if (project?.cover_path) paths.push(project.cover_path as string);
  await removePhotoFiles(supabase, user.id, paths);
  revalidateProjects();
  redirect("/projects");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GRID_COLS, isSectionType } from "@/lib/memoryLayout";
import { isWorkspaceRef, ownerColumn, ownerFields, type WorkspaceRef } from "@/lib/workspace";
import { photoPathsIn, removePhotoFiles } from "@/lib/workspaceServer";
import type { SectionContent } from "@/types";

// ---- Workspace canvas sections ---------------------------------------------
//
// These back the snap-grid workspace canvas used by Deep Memory pages and
// project pages. They're called on nearly every edit (each drag, each
// keystroke pause), and the canvas keeps its own optimistic copy of the
// sections, so they deliberately skip revalidatePath (which would re-render
// the page for no reason) and instead return whether the write succeeded, so
// the UI can show a "couldn't save" state rather than failing silently.

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT_BYTES = 200_000;

function validRef(ref: unknown): ref is WorkspaceRef {
  return isWorkspaceRef(ref) && UUID_RE.test(ref.id);
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

function contentTooLarge(content: unknown) {
  return JSON.stringify(content ?? {}).length > MAX_CONTENT_BYTES;
}

// A section can only sit inside a group in the same workspace, and never
// inside itself or one of its own descendants (that would cut the branch
// loose). `movingId` is the section being placed, when it already exists.
async function validParent(
  supabase: ReturnType<typeof createClient>,
  workspace: WorkspaceRef,
  parentId: string,
  movingId?: string
): Promise<boolean> {
  if (!UUID_RE.test(parentId)) return false;
  const { data, error } = await supabase
    .from("memory_sections")
    .select("id, parent_id, type")
    .eq(ownerColumn(workspace), workspace.id);
  if (error || !data) {
    if (error) console.error("validParent failed:", error);
    return false;
  }
  const byId = new Map(data.map((s) => [s.id as string, s]));
  if (byId.get(parentId)?.type !== "group") return false;
  let cur: string | null = parentId;
  for (let depth = 0; cur && depth <= data.length; depth++) {
    if (cur === movingId) return false;
    cur = (byId.get(cur)?.parent_id as string | null) ?? null;
  }
  return true;
}

// The client generates the id so a new section can appear instantly
// (optimistically) and be saved afterward under that same id.
export async function addSection(input: {
  id: string;
  workspace: WorkspaceRef;
  parentId: string | null;
  type: string;
  content: SectionContent;
  x: number;
  y: number;
  w: number;
  h: number;
}): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (!UUID_RE.test(input.id) || !validRef(input.workspace)) return false;
  if (!isSectionType(input.type) || contentTooLarge(input.content)) return false;
  if (input.parentId && !(await validParent(supabase, input.workspace, input.parentId))) {
    return false;
  }

  const owner = ownerFields(input.workspace);
  const { error } = await supabase.from("memory_sections").insert({
    id: input.id,
    user_id: user.id,
    page_id: owner.page_id,
    // Only sent when set, so Deep Memory pages keep saving on a database
    // that hasn't had the project_id / parent_id columns added yet.
    ...(owner.project_id ? { project_id: owner.project_id } : {}),
    ...(input.parentId ? { parent_id: input.parentId } : {}),
    type: input.type,
    content: input.content,
    x: clampInt(input.x, 0, GRID_COLS - 1, 0),
    y: clampInt(input.y, 0, 10_000, 0),
    w: clampInt(input.w, 1, GRID_COLS, 6),
    h: clampInt(input.h, 1, 200, 6),
  });
  if (error) console.error("addSection failed:", error);
  return !error;
}

export async function updateSectionContent(
  sectionId: string,
  content: SectionContent
): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!UUID_RE.test(sectionId) || contentTooLarge(content)) return false;

  const { error } = await supabase
    .from("memory_sections")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", sectionId);
  if (error) console.error("updateSectionContent failed:", error);
  return !error;
}

// Saves positions/sizes for every section that moved in one drag or resize —
// dropping one section onto another pushes the other out of the way, so a
// single gesture can change several.
export async function saveSectionLayouts(
  workspace: WorkspaceRef,
  layouts: { id: string; x: number; y: number; w: number; h: number }[]
): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!validRef(workspace) || layouts.some((l) => !UUID_RE.test(l.id))) return false;

  const results = await Promise.all(
    layouts.map((l) =>
      supabase
        .from("memory_sections")
        .update({
          x: clampInt(l.x, 0, GRID_COLS - 1, 0),
          y: clampInt(l.y, 0, 10_000, 0),
          w: clampInt(l.w, 1, GRID_COLS, 6),
          h: clampInt(l.h, 1, 200, 6),
          updated_at: new Date().toISOString(),
        })
        .eq("id", l.id)
        .eq(ownerColumn(workspace), workspace.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) console.error("saveSectionLayouts failed:", failed.error);
  return !failed;
}

// "Move to…": puts a section (and everything inside it) into another group,
// or back onto the workspace itself (parentId null), at the given spot.
export async function moveSection(input: {
  id: string;
  workspace: WorkspaceRef;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!UUID_RE.test(input.id) || !validRef(input.workspace)) return false;
  if (
    input.parentId &&
    !(await validParent(supabase, input.workspace, input.parentId, input.id))
  ) {
    return false;
  }

  const { error } = await supabase
    .from("memory_sections")
    .update({
      parent_id: input.parentId,
      x: clampInt(input.x, 0, GRID_COLS - 1, 0),
      y: clampInt(input.y, 0, 10_000, 0),
      w: clampInt(input.w, 1, GRID_COLS, 6),
      h: clampInt(input.h, 1, 200, 6),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq(ownerColumn(input.workspace), input.workspace.id);
  if (error) console.error("moveSection failed:", error);
  return !error;
}

// Called after a photo has been taken out of its Gallery's content.
export async function deletePhotos(paths: string[]): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) return false;
  return removePhotoFiles(supabase, user.id, paths);
}

// Deleting a group deletes everything inside it (on delete cascade), and any
// photos in Galleries anywhere inside it.
export async function deleteSection(sectionId: string): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (!UUID_RE.test(sectionId)) return false;

  const { data: target } = await supabase
    .from("memory_sections")
    .select("*")
    .eq("id", sectionId)
    .maybeSingle();
  let photoPaths: string[] = [];
  if (target) {
    const workspace: WorkspaceRef = target.project_id
      ? { kind: "project", id: target.project_id }
      : { kind: "page", id: target.page_id };
    const { data: rows, error: rowsError } = await supabase
      .from("memory_sections")
      .select("*")
      .eq(ownerColumn(workspace), workspace.id);
    if (rowsError) console.error("deleteSection: reading sections failed:", rowsError);
    const all = (rows ?? []) as { id: string; parent_id?: string | null; type: string; content: unknown }[];
    const doomed = new Set([sectionId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of all) {
        if (r.parent_id && doomed.has(r.parent_id) && !doomed.has(r.id)) {
          doomed.add(r.id);
          grew = true;
        }
      }
    }
    photoPaths = photoPathsIn(all.filter((r) => doomed.has(r.id)));
  }

  const { error } = await supabase.from("memory_sections").delete().eq("id", sectionId);
  if (error) {
    console.error("deleteSection failed:", error);
    return false;
  }
  await removePhotoFiles(supabase, user.id, photoPaths);
  return true;
}

// ---- Associated To-Dos widget ------------------------------------------------
//
// The widget shows real tasks from the To-Do list, so these write to the
// tasks table and refresh the pages that list tasks.

function revalidateTaskPages() {
  revalidatePath("/");
  revalidatePath("/todo");
  revalidatePath("/projects", "layout");
}

export async function setTaskDone(taskId: string, done: boolean): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!UUID_RE.test(taskId) || typeof done !== "boolean") return false;
  const { error } = await supabase
    .from("tasks")
    .update({ is_done: done, completed_at: done ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (error) console.error("setTaskDone failed:", error);
  else revalidateTaskPages();
  return !error;
}

// Deletes a to-do (and its subtasks, by cascade) from the To-Do list.
export async function deleteWorkspaceTask(taskId: string): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!UUID_RE.test(taskId)) return false;
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) console.error("deleteWorkspaceTask failed:", error);
  else revalidateTaskPages();
  return !error;
}

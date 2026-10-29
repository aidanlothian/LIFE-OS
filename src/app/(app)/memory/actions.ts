"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { removePhotoFiles, workspacePhotoPaths } from "@/lib/workspaceServer";

const DEFAULT_CATEGORIES = ["Hobbies", "Career", "Family", "Health", "Home"];

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// Idempotent, upsert-based (matches the pattern used across the rest of
// the app) — seeds the starter categories once, and never disturbs ones
// the user has since renamed/added/deleted.
export async function ensureDefaultCategories(userId: string) {
  const supabase = createClient();
  await supabase.from("memory_categories").upsert(
    DEFAULT_CATEGORIES.map((name, i) => ({ user_id: userId, name, category_order: i + 1 })),
    { onConflict: "user_id,name", ignoreDuplicates: true }
  );
}

async function nextCategoryOrder(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data } = await supabase.from("memory_categories").select("category_order").eq("user_id", userId);
  const max = (data ?? []).reduce((m, c) => Math.max(m, c.category_order as number), 0);
  return max + 1;
}

export async function addCategory(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;

  const order = await nextCategoryOrder(supabase, user.id);
  // Upsert (ignoring the conflict) guards against a double-submit creating
  // a duplicate group with the same name.
  await supabase.from("memory_categories").upsert(
    { user_id: user.id, name, category_order: order },
    { onConflict: "user_id,name", ignoreDuplicates: true }
  );
  revalidatePath("/memory");
}

export async function renameCategory(categoryId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await supabase.from("memory_categories").update({ name }).eq("id", categoryId);
  revalidatePath("/memory");
}

// Deletes the category's pages along with it, via cascade.
export async function deleteCategory(categoryId: string) {
  const { supabase, user } = await requireUser();
  const { data: pages } = await supabase
    .from("memory_pages")
    .select("id")
    .eq("category_id", categoryId);
  const pageIds = (pages ?? []).map((p) => p.id as string);
  const photoPaths = await workspacePhotoPaths(supabase, "page", pageIds);
  const { error } = await supabase.from("memory_categories").delete().eq("id", categoryId);
  if (error) console.error("deleteCategory failed:", error);
  else await removePhotoFiles(supabase, user.id, photoPaths);
  revalidatePath("/memory");
}

export async function moveCategory(categoryId: string, direction: "left" | "right") {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("memory_categories")
    .select("id, category_order")
    .eq("user_id", user.id)
    .order("category_order", { ascending: true });
  if (!data) return;

  const idx = data.findIndex((c) => c.id === categoryId);
  const swapIdx = direction === "left" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= data.length) return;

  const a = data[idx];
  const b = data[swapIdx];
  await supabase.from("memory_categories").update({ category_order: b.category_order }).eq("id", a.id);
  await supabase.from("memory_categories").update({ category_order: a.category_order }).eq("id", b.id);
  revalidatePath("/memory");
}

export async function addPage(categoryId: string, formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = String(formData.get("title") || "").trim();
  if (!title) return;

  const { data: siblings } = await supabase
    .from("memory_pages")
    .select("page_order")
    .eq("category_id", categoryId);
  const order =
    siblings && siblings.length > 0
      ? Math.max(...siblings.map((p) => p.page_order as number)) + 1
      : 1;

  await supabase.from("memory_pages").insert({
    user_id: user.id,
    category_id: categoryId,
    title,
    page_order: order,
  });
  revalidatePath("/memory");
}

export async function renamePage(pageId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  await supabase
    .from("memory_pages")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", pageId);
  revalidatePath("/memory");
  revalidatePath(`/memory/${pageId}`);
}

// Redirects back to the board rather than leaving the caller on a page
// that no longer exists.
export async function deletePage(pageId: string) {
  const { supabase, user } = await requireUser();
  const photoPaths = await workspacePhotoPaths(supabase, "page", [pageId]);
  const { error } = await supabase.from("memory_pages").delete().eq("id", pageId);
  if (error) console.error("deletePage failed:", error);
  else await removePhotoFiles(supabase, user.id, photoPaths);
  revalidatePath("/memory");
  redirect("/memory");
}

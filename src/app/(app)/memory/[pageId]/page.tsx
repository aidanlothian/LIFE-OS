import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { deletePage, renamePage } from "../actions";
import {
  addSection,
  deletePhotos,
  deleteSection,
  deleteWorkspaceTask,
  moveSection,
  saveSectionLayouts,
  setTaskDone,
  updateSectionContent,
} from "../../workspaceActions";
import WorkspaceCanvas from "@/components/workspace/WorkspaceCanvas";
import { loadWorkspace } from "@/lib/workspaceServer";

export default async function MemoryPageDetail({
  params,
}: {
  params: { pageId: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null; // middleware redirects unauthenticated users

  const workspace = { kind: "page" as const, id: params.pageId };
  const [{ data: page }, { sections, photoUrls, todos }] = await Promise.all([
    supabase
      .from("memory_pages")
      .select("*, category:memory_categories(name)")
      .eq("id", params.pageId)
      .maybeSingle(),
    loadWorkspace(supabase, workspace),
  ]);
  if (!page) notFound();
  const category = page.category as { name: string } | null;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link href="/memory" className="text-xs text-muted hover:text-accent">
          ← Deep Memory
        </Link>
        {category?.name && (
          <span className="rounded bg-border/60 px-1.5 py-0.5 text-[11px] text-muted">
            {category.name}
          </span>
        )}
      </div>

      <form action={renamePage.bind(null, page.id)} className="flex items-center gap-2">
        <input
          name="title"
          defaultValue={page.title}
          className="w-full border-b border-transparent bg-transparent text-2xl font-semibold text-text outline-none focus:border-border"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
        >
          Save title
        </button>
      </form>

      <WorkspaceCanvas
        workspace={workspace}
        initialSections={sections}
        initialPhotoUrls={photoUrls}
        addSectionAction={addSection}
        updateContentAction={updateSectionContent}
        saveLayoutsAction={saveSectionLayouts}
        deleteSectionAction={deleteSection}
        moveSectionAction={moveSection}
        deletePhotosAction={deletePhotos}
        todos={todos}
        setTaskDoneAction={setTaskDone}
        deleteTaskAction={deleteWorkspaceTask}
      />

      <form action={deletePage.bind(null, page.id)} className="self-end">
        <button type="submit" className="text-xs text-muted hover:text-bad">
          Delete page
        </button>
      </form>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { loadWorkspace, signPhotoUrls } from "@/lib/workspaceServer";
import WorkspaceCanvas from "@/components/workspace/WorkspaceCanvas";
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
import ProjectHeader, { DeleteProjectButton } from "./ProjectHeader";
import type { Project } from "@/types";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { projectId: string };
  searchParams: { new?: string; error?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null; // middleware redirects unauthenticated users

  const workspace = { kind: "project" as const, id: params.projectId };
  const [{ data: projectRow, error }, { sections, photoUrls, todos }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", params.projectId).maybeSingle(),
    loadWorkspace(supabase, workspace),
  ]);
  if (error) console.error("Failed to fetch project:", error);
  if (!projectRow) notFound();
  const project = projectRow as Project;
  const coverUrl = project.cover_path
    ? (await signPhotoUrls(supabase, [project.cover_path]))[project.cover_path]
    : undefined;

  return (
    <div className="flex w-full flex-col gap-4">
      <Link href="/projects" className="self-start text-xs text-muted hover:text-accent">
        ← Project Center
      </Link>

      {searchParams.error === "delete" && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          Couldn&apos;t delete the project. Try again.
        </p>
      )}

      <ProjectHeader
        key={project.id}
        project={project}
        coverUrl={coverUrl}
        today={getAppDay()}
        isNew={searchParams.new === "1"}
      />

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

      <DeleteProjectButton projectId={project.id} />
    </div>
  );
}

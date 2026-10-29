"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT, uploadPhoto } from "@/components/workspace/gallery";
import { STATUS_LABELS, STATUS_ORDER, deadlineInfo } from "@/lib/projects";
import { deleteProject, setProjectCover, updateProject } from "../actions";
import type { Project } from "@/types";

const TONE_CLASS = {
  bad: "text-bad",
  warn: "text-warn",
  muted: "text-muted",
};

// Cover photo, name, description, status and deadline for one project.
// Each field saves on its own when it changes (text fields on blur/Enter).
export default function ProjectHeader({
  project,
  coverUrl,
  today,
  isNew,
}: {
  project: Project;
  coverUrl?: string;
  today: string;
  isNew: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [cover, setCover] = useState(coverUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setCover(coverUrl), [coverUrl]);

  // A brand-new project opens with its placeholder name selected, ready to
  // be typed over.
  useEffect(() => {
    if (isNew) {
      nameRef.current?.focus();
      nameRef.current?.select();
      router.replace(`/projects/${project.id}`, { scroll: false });
    }
  }, [isNew, project.id, router]);

  function save(patch: Parameters<typeof updateProject>[1]) {
    setError(null);
    startTransition(async () => {
      const ok = await updateProject(project.id, patch);
      if (!ok) setError("Couldn't save that change. Try again.");
      router.refresh();
    });
  }

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(project.name);
      return;
    }
    if (trimmed !== project.name) save({ name: trimmed });
  }

  function saveDescription() {
    if (description.trim() !== (project.description ?? "")) save({ description });
  }

  async function handleCoverFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { path, url } = await uploadPhoto(file);
      const ok = await setProjectCover(project.id, path);
      if (!ok) throw new Error("Couldn't save the cover photo. Try again.");
      if (url) setCover(url);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  function removeCover() {
    setError(null);
    setCover(undefined);
    startTransition(async () => {
      const ok = await setProjectCover(project.id, null);
      if (!ok) setError("Couldn't remove the cover photo. Try again.");
      router.refresh();
    });
  }

  const due = project.deadline ? deadlineInfo(project.deadline, today, project.status) : null;
  const coverButton =
    "rounded-md bg-panel/90 px-2 py-1 text-xs text-text shadow-sm hover:text-accent disabled:opacity-60";

  return (
    <div className="flex flex-col gap-3">
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={handleCoverFile} />

      {cover ? (
        <div className="group relative h-44 w-full overflow-hidden rounded-lg border border-border bg-border/50 sm:h-56">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
          <img src={cover} alt="" className="h-full w-full object-cover" />
          <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={coverButton}
            >
              {uploading ? "Uploading…" : "Change cover"}
            </button>
            <button type="button" onClick={removeCover} disabled={uploading} className={coverButton}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="self-start text-xs text-muted hover:text-accent disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "+ Add cover photo"}
        </button>
      )}

      <div className="flex flex-col gap-1">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Project name"
          className="w-full border-b border-transparent bg-transparent text-2xl font-semibold text-text outline-none hover:border-border focus:border-border"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Add a short description"
          aria-label="Project description"
          className="w-full border-b border-transparent bg-transparent text-sm text-muted outline-none placeholder:text-muted/60 hover:border-border focus:border-border"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted">
          Status
          <select
            value={project.status}
            onChange={(e) => save({ status: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text outline-none focus:border-accent"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          Deadline
          <input
            type="date"
            value={project.deadline ?? ""}
            onChange={(e) => save({ deadline: e.target.value || null })}
            className="rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-text outline-none focus:border-accent"
          />
        </label>
        {project.deadline ? (
          <>
            {due && <span className={TONE_CLASS[due.tone]}>{due.label}</span>}
            <button
              type="button"
              onClick={() => save({ deadline: null })}
              className="text-muted hover:text-accent"
            >
              Clear deadline
            </button>
          </>
        ) : (
          <span className="text-muted/70">Open-ended</span>
        )}
      </div>

      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

// Inline "are you sure" (no browser pop-ups). The project's tasks are kept,
// just no longer tagged with it.
export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-end text-xs text-muted hover:text-bad"
      >
        Delete project
      </button>
    );
  }
  return (
    <form
      action={deleteProject.bind(null, projectId)}
      className="flex flex-wrap items-center justify-end gap-2 self-end text-xs"
    >
      <span className="text-muted">
        Delete this project and its workspace? Its tasks will stay on your to-do list.
      </span>
      <button type="submit" className="rounded-md bg-bad px-2 py-1 font-medium text-bg hover:opacity-90">
        Delete
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-border px-2 py-1 text-muted hover:border-accent hover:text-accent"
      >
        Cancel
      </button>
    </form>
  );
}

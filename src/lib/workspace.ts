// A workspace is the free-form widget canvas (src/components/workspace) that
// several parts of the app build pages from. Its widgets live in the
// memory_sections table, each row owned by exactly one thing: a Deep Memory
// page or a project. A WorkspaceRef names that owner.
export type WorkspaceKind = "page" | "project";

export interface WorkspaceRef {
  kind: WorkspaceKind;
  id: string;
}

// The memory_sections column that points at the owner.
export function ownerColumn(ref: WorkspaceRef): "page_id" | "project_id" {
  return ref.kind === "project" ? "project_id" : "page_id";
}

// Both owner columns as they'd appear on a row owned by `ref`.
export function ownerFields(ref: WorkspaceRef): { page_id: string | null; project_id: string | null } {
  return ref.kind === "project"
    ? { page_id: null, project_id: ref.id }
    : { page_id: ref.id, project_id: null };
}

export function isWorkspaceRef(v: unknown): v is WorkspaceRef {
  const r = v as WorkspaceRef | null;
  return !!r && (r.kind === "page" || r.kind === "project") && typeof r.id === "string";
}

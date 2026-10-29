export type Section = "schedule" | "todo";

export type ProjectStatus = "active" | "on_hold" | "complete";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  // Optional: open-ended projects have none. "YYYY-MM-DD".
  deadline: string | null;
  // Cover photo's key in the memory-photos Storage bucket, if one is set.
  cover_path: string | null;
  created_at: string;
}

export type RecurrenceType = "daily" | "weekly" | "yearly";

export interface RecurringTemplate {
  id: string;
  user_id: string;
  title: string;
  section: Section;
  sort_order: number;
  active: boolean;
  recurrence_type: RecurrenceType;
  days_of_week: number[]; // 0=Sunday..6=Saturday, used when recurrence_type is "weekly"
  yearly_month: number | null; // used when recurrence_type is "yearly"
  yearly_day: number | null;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  section: Section;
  notes: string | null;
  due_date: string | null; // YYYY-MM-DD
  project_id: string | null;
  is_done: boolean;
  completed_at: string | null;
  is_mit: boolean;
  template_id: string | null;
  parent_task_id: string | null;
  sort_order: number;
  created_at: string;
  project?: Pick<Project, "id" | "name"> | null;
}

export type ViewKey = "today" | "week" | "overdue" | "evergreen" | "all";

export interface Habit {
  id: string;
  user_id: string;
  title: string;
  category: string;
  category_order: number;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface HabitLog {
  id: string;
  user_id: string;
  habit_id: string;
  log_date: string; // YYYY-MM-DD
  created_at: string;
}

export interface MemoryCategory {
  id: string;
  user_id: string;
  name: string;
  category_order: number;
  created_at: string;
}

// The modules that can be placed on a workspace canvas. Each one stores its
// data as JSON in MemorySection.content (shapes below).
// "group" is a container (labelled "Section" in the app) holding its own
// grid of child sections.
// "todos" ("Associated To-Dos") shows live tasks from the To-Do list that are
// tagged with a project; the tasks themselves live in the tasks table.
export type SectionType =
  | "group"
  | "heading"
  | "text"
  | "checklist"
  | "links"
  | "gallery"
  | "todos"
  | "table";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

// One photo in a Gallery widget. `path` is the file's key in the
// memory-photos Storage bucket; caption and link are optional ("").
export interface PhotoItem {
  id: string;
  path: string;
  caption: string;
  link: string;
}

export interface LinkItem {
  id: string;
  label: string;
  url: string;
}

// heading/text use { text }, checklist/links/gallery use { items } — kept as one
// loose shape because it round-trips through a jsonb column. `title` is the
// optional header shown at the top of every box except the Heading module
// (which is itself the title).
export interface SectionContent {
  title?: string;
  // group only: folded shut down to its header bar. While collapsed its saved
  // h is 1 and expandedH holds the height to restore when it opens.
  collapsed?: boolean;
  expandedH?: number;
  // Background color (see src/lib/memoryColors.ts); none when absent.
  color?: { hue: string; strength: number } | null;
  // Boxed (a card with a border) or flat on the background. Absent means the
  // type's default; see isBoxed in src/lib/memoryLayout.ts.
  boxed?: boolean;
  text?: string;
  items?: unknown[];
  // todos only, on workspaces not owned by a project (e.g. Deep Memory):
  // which project's to-dos to show. A project's own workspace ignores it.
  projectId?: string | null;
  // todos only: Active / Overdue / Complete stacked (default) or side by side.
  layout?: "stacked" | "columns";
  // table only (see TableColumn / TableRow).
  columns?: TableColumn[];
  rows?: TableRow[];
  sort?: { columnId: string; dir: "asc" | "desc" } | null;
}

// A Table widget is a small spreadsheet: typed columns, and rows holding a
// value per column id. Values: text/date/select are strings ("" = empty),
// number is a number or null, checkbox is a boolean.
export type TableColumnType = "text" | "number" | "checkbox" | "date" | "select";

export interface TableColumn {
  id: string;
  name: string;
  type: TableColumnType;
  // select only: the dropdown's choices.
  options?: string[];
  // Width in px set by dragging the header's right edge; absent = the column
  // shares whatever room the table has.
  width?: number;
}

export interface TableRow {
  id: string;
  cells: Record<string, string | number | boolean | null>;
}

// One task as shown in an Associated To-Dos widget.
export interface WorkspaceTask {
  id: string;
  title: string;
  is_done: boolean;
  due_date: string | null;
  project_id: string;
  created_at: string;
}

// One widget on a workspace canvas (src/components/workspace). A workspace
// belongs to exactly one owner: a Deep Memory page (page_id) or a project
// (project_id); the other is null.
export interface MemorySection {
  id: string;
  user_id: string;
  page_id: string | null;
  project_id: string | null;
  // The group section this one sits inside; null at the top of the page.
  parent_id: string | null;
  type: SectionType;
  content: SectionContent;
  // Position/size on its parent's 12-column snap grid (the page's, when
  // top-level), in grid units (not pixels).
  x: number;
  y: number;
  w: number;
  h: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryPage {
  id: string;
  user_id: string;
  category_id: string;
  title: string;
  content: string | null;
  page_order: number;
  created_at: string;
  updated_at: string;
}

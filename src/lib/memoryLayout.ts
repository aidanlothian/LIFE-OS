import type { SectionContent, SectionType } from "@/types";

// Deep Memory pages are a snap grid: every section's x/y/w/h is in grid
// units, so edges always line up no matter where it's dropped.
export const GRID_COLS = 12;
export const ROW_HEIGHT = 30; // px per grid row
export const GRID_MARGIN = 12; // px gap between cells
// Below this container width the grid stacks into a single column instead —
// a free layout can't usefully fit on a narrow screen.
export const STACK_BELOW_PX = 640;

export const SECTION_DEFAULTS: Record<
  SectionType,
  { label: string; w: number; h: number; minW: number; minH: number }
> = {
  // minH is 4 (not 3) for the boxes that carry a title row, so there's
  // still room for content below the title and, in edit mode, the title bar.
  // A group ("Section") is a box with its own grid inside; see groupInnerRows.
  group: { label: "Section", w: 12, h: 14, minW: 3, minH: 4 },
  heading: { label: "Heading", w: 12, h: 2, minW: 2, minH: 2 },
  text: { label: "Text", w: 6, h: 7, minW: 2, minH: 4 },
  checklist: { label: "Checklist", w: 4, h: 8, minW: 2, minH: 4 },
  links: { label: "Links", w: 4, h: 6, minW: 2, minH: 4 },
  gallery: { label: "Gallery", w: 6, h: 9, minW: 2, minH: 4 },
  todos: { label: "Associated To-Dos", w: 4, h: 8, minW: 2, minH: 4 },
  table: { label: "Table", w: 12, h: 8, minW: 3, minH: 4 },
};

// The private Storage bucket that Gallery photos are uploaded to.
export const PHOTO_BUCKET = "memory-photos";
// How long a photo's signed URL works; the page fetches fresh ones on load.
export const PHOTO_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export const SECTION_TYPES = Object.keys(SECTION_DEFAULTS) as SectionType[];

export function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as string[]).includes(value);
}

export function defaultSectionContent(type: SectionType): SectionContent {
  if (type === "group" || type === "todos") return {};
  if (type === "table") {
    const name = crypto.randomUUID();
    const notes = crypto.randomUUID();
    return {
      columns: [
        { id: name, name: "Name", type: "text" },
        { id: notes, name: "Notes", type: "text" },
      ],
      rows: [0, 1, 2].map(() => ({ id: crypto.randomUUID(), cells: {} })),
    };
  }
  return type === "checklist" || type === "links" || type === "gallery"
    ? { items: [] }
    : { text: "" };
}

export function sectionHasContent(type: SectionType, content: SectionContent): boolean {
  if ((content.title ?? "").trim().length > 0) return true;
  if (type === "checklist" || type === "links" || type === "gallery") {
    return (content.items?.length ?? 0) > 0;
  }
  if (type === "table") {
    return (content.rows ?? []).some((r) =>
      Object.values(r.cells).some((v) => v !== null && v !== "" && v !== false)
    );
  }
  return (content.text ?? "").trim().length > 0;
}

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// First row below everything already on the page — where a newly added
// section goes so it never lands on top of anything.
export function nextFreeY(rects: Rect[]): number {
  return rects.reduce((max, r) => Math.max(max, r.y + r.h), 0);
}

// "Tidy up": slides every section as far up as it can go without hitting
// another one, closing vertical gaps while leaving columns (and any
// side-by-side arrangement) exactly as they are. Processes top-to-bottom,
// left-to-right so each section settles against ones already placed above it.
export function tidyLayout(rects: Rect[]): Rect[] {
  const order = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Rect[] = [];
  for (const r of order) {
    let y = r.y;
    while (y > 0 && !placed.some((p) => overlaps({ ...r, y: y - 1 }, p))) y--;
    placed.push({ ...r, y });
  }
  const byId = new Map(placed.map((p) => [p.id, p]));
  return rects.map((r) => byId.get(r.id) ?? r);
}

// ---- Sections (groups) -----------------------------------------------------
//
// A group keeps the size you give it; its children live on their own
// 12-column grid inside it and must fit. The group's chrome is a fixed-height
// header plus padding, so the number of child rows that fit follows exactly
// from its own height in rows:
//   box px   = h*ROW_HEIGHT + (h-1)*GRID_MARGIN
//   inner px = box px - border(2) - header - bottom padding
//   rows     = floor((inner px + GRID_MARGIN) / (ROW_HEIGHT + GRID_MARGIN))
// With the numbers below that works out to h - 1 rows. A collapsed group
// shows only its header, which is exactly one grid row tall.
export const GROUP_HEADER_PX = ROW_HEIGHT - 2;
export const GROUP_PAD_PX = 8;

export function groupInnerRows(h: number): number {
  const box = h * ROW_HEIGHT + (h - 1) * GRID_MARGIN;
  const inner = box - 2 - GROUP_HEADER_PX - GROUP_PAD_PX;
  return Math.max(0, Math.floor((inner + GRID_MARGIN) / (ROW_HEIGHT + GRID_MARGIN)));
}

// Smallest group height (in rows) whose inside still fits `rows` rows.
export function groupHeightFor(rows: number): number {
  let h = 1;
  while (groupInnerRows(h) < rows) h++;
  return h;
}

// Top-left-most free spot for a w×h box among `rects` on a 12-column grid
// that's `maxRows` tall, or null when it doesn't fit anywhere.
export function findFreeSpot(
  rects: Rect[],
  w: number,
  h: number,
  maxRows: number
): { x: number; y: number } | null {
  const width = Math.min(Math.max(1, w), GRID_COLS);
  for (let y = 0; y + h <= maxRows; y++) {
    for (let x = 0; x + width <= GRID_COLS; x++) {
      const probe = { id: "", x, y, w: width, h };
      if (!rects.some((r) => overlaps(probe, r))) return { x, y };
    }
  }
  return null;
}

// A grid after some of its groups collapse: each collapsed group shrinks to
// one row, and whatever sat below it in its columns slides up to close the
// gap — but never further than the space the collapsed groups above it gave
// up, so gaps you left on purpose stay put. The result is saved, so the page
// looks the same in edit mode and while drawing new widgets.
export function collapsedLayout(rects: Rect[], collapsedIds: Set<string>): Rect[] {
  if (collapsedIds.size === 0) return rects;
  const collapsed = rects.filter((r) => collapsedIds.has(r.id));
  const sideBySide = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w;
  const order = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Rect[] = [];
  for (const r of order) {
    const shown = collapsedIds.has(r.id) ? { ...r, h: 1 } : { ...r };
    const freed = collapsed
      .filter((c) => c.id !== r.id && c.y + c.h <= r.y && sideBySide(c, r))
      .reduce((sum, c) => sum + (c.h - 1), 0);
    const floor = Math.max(0, r.y - freed);
    while (shown.y > floor && !placed.some((p) => overlaps({ ...shown, y: shown.y - 1 }, p))) {
      shown.y--;
    }
    placed.push(shown);
  }
  const byId = new Map(placed.map((p) => [p.id, p]));
  return rects.map((r) => byId.get(r.id) ?? r);
}

// The reverse, for a group expanding back to full height: anything the
// taller group now overlaps moves down just enough to clear it, and anything
// those moves run into moves down in turn. Nothing else changes.
export function pushDown(rects: Rect[], fixedId: string): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  const fixed = out.find((r) => r.id === fixedId);
  if (!fixed) return out;
  const settled: Rect[] = [fixed];
  const order = out.filter((r) => r.id !== fixedId).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const r of order) {
    for (let moved = true; moved; ) {
      moved = false;
      for (const p of settled) {
        if (overlaps(r, p)) {
          r.y = p.y + p.h;
          moved = true;
        }
      }
    }
    settled.push(r);
  }
  return out;
}

// Headings and tables sit flat on the background unless you box them;
// everything else starts boxed.
export function isBoxed(type: SectionType, content: SectionContent): boolean {
  return content.boxed ?? (type !== "heading" && type !== "table");
}

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  GRID_COLS,
  GRID_MARGIN,
  GROUP_HEADER_PX,
  GROUP_PAD_PX,
  ROW_HEIGHT,
  SECTION_DEFAULTS,
  SECTION_TYPES,
  STACK_BELOW_PX,
  collapsedLayout,
  pushDown,
  defaultSectionContent,
  findFreeSpot,
  groupHeightFor,
  groupInnerRows,
  isBoxed,
  nextFreeY,
  overlaps,
  sectionHasContent,
  tidyLayout,
  type Rect,
} from "@/lib/memoryLayout";
import { HUES, STRENGTHS, swatchColor, tintFor } from "@/lib/memoryColors";
import SectionBody, { SectionTitle } from "./sections";
import { PhotoContext, type PhotoApi } from "./gallery";
import { TodoContext, type TodoApi } from "./todos";
import { MenuButton, MenuItem } from "./menus";
import type {
  addSection,
  deletePhotos,
  deleteSection,
  deleteWorkspaceTask,
  moveSection,
  saveSectionLayouts,
  setTaskDone,
  updateSectionContent,
} from "@/app/(app)/workspaceActions";
import type { WorkspaceTodoData } from "@/lib/workspaceServer";
import { ownerFields, type WorkspaceRef } from "@/lib/workspace";
import type { MemorySection, SectionContent, SectionType } from "@/types";

// The server actions arrive as props (rather than being imported here) so
// the canvas stays independent of where its saves go.
interface WorkspaceCanvasProps {
  // Whose workspace this is: a Deep Memory page or a project.
  workspace: WorkspaceRef;
  initialSections: MemorySection[];
  addSectionAction: typeof addSection;
  updateContentAction: typeof updateSectionContent;
  saveLayoutsAction: typeof saveSectionLayouts;
  deleteSectionAction: typeof deleteSection;
  moveSectionAction: typeof moveSection;
  // Signed URLs for the photos already in this page's Galleries, by path.
  initialPhotoUrls: Record<string, string>;
  deletePhotosAction: typeof deletePhotos;
  // Live tasks for Associated To-Dos widgets; null when the workspace had
  // none of those widgets when it loaded (adding one reloads the data).
  todos: WorkspaceTodoData | null;
  setTaskDoneAction: typeof setTaskDone;
  deleteTaskAction: typeof deleteWorkspaceTask;
}

type SaveState = "idle" | "saving" | "saved" | "error";

// After picking a widget from an Add menu you draw it: click and drag across
// empty squares to set where it goes and how big it is. `scope` is where it
// may be drawn: anywhere ("any", from the toolbar) or only inside one Section
// (from that Section's own +).
interface Placing {
  type: SectionType;
  scope: "any" | string;
}

// Everything a grid (the page's, or the one inside a Section) needs from the
// canvas. Grids nest to any depth, so this is shared through context rather
// than passed down level by level.
interface CanvasApi {
  editing: boolean;
  stacked: boolean;
  childrenOf: (parentId: string | null) => MemorySection[];
  onChange: (id: string, patch: SectionContent) => void;
  onToggleCollapse: (id: string) => void;
  onDelete: (section: MemorySection) => void;
  placing: Placing | null;
  onAdd: (type: SectionType, scope: "any" | string) => void;
  onPlace: (parentId: string | null, drawn: Rect, isClick: boolean) => void;
  onMove: (id: string, parentId: string | null) => void;
  onGridChange: (layout: Layout[]) => void;
}

const CanvasContext = createContext<CanvasApi | null>(null);

function useCanvas() {
  const api = useContext(CanvasContext);
  if (!api) throw new Error("useCanvas must be used inside WorkspaceCanvas");
  return api;
}

function toRect(s: MemorySection): Rect {
  return { id: s.id, x: s.x, y: s.y, w: s.w, h: s.h };
}

function sectionLabel(s: MemorySection) {
  return s.content.title?.trim() || `Untitled ${SECTION_DEFAULTS[s.type].label.toLowerCase()}`;
}

// A colored box: its background, plus a matching border outside edit mode
// (edit mode keeps the dashed accent border so you can see what's movable).
function tintStyle(tint: ReturnType<typeof tintFor>, editing: boolean) {
  if (!tint) return undefined;
  return editing
    ? { backgroundColor: tint.background }
    : { backgroundColor: tint.background, borderColor: tint.border };
}

// On Medium/Strong colors the usual muted grey labels get too faint, so
// they're darkened everywhere inside that box (still readable on the lighter
// boxes that may be nested in it).
const STRONG_TINT_TEXT = "[&_.text-muted]:text-[#5e5648]";

// Each grid gets its own drag-handle class. react-grid-layout matches the
// handle by selector anywhere inside an item, so with one shared class,
// grabbing a widget inside a Section would drag the whole Section too.
function handleClassFor(parentId: string | null) {
  return `section-drag-${parentId ?? "page"}`;
}

function AddMenu({
  scope,
  label,
  className,
}: {
  scope: "any" | string;
  label: ReactNode;
  className: string;
}) {
  const { onAdd } = useCanvas();
  return (
    <MenuButton label={label} ariaLabel="Add widget" className={className}>
      {(close) =>
        SECTION_TYPES.map((type) => (
          <MenuItem
            key={type}
            onClick={() => {
              close();
              onAdd(type, scope);
            }}
          >
            {SECTION_DEFAULTS[type].label}
          </MenuItem>
        ))
      }
    </MenuButton>
  );
}

// "Move to…": the page itself plus every Section on it, as an indented tree.
// A Section can't go inside itself or anything inside it (its whole branch
// is left out), and where the widget already is shows but isn't clickable.
function MoveMenu({ section }: { section: MemorySection }) {
  const { childrenOf, onMove } = useCanvas();
  const rows: { s: MemorySection; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const s of childrenOf(parentId)) {
      if (s.type !== "group" || s.id === section.id) continue;
      rows.push({ s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 1);
  return (
    <MenuButton
      label="Move"
      ariaLabel={`Move ${sectionLabel(section)}`}
      className="section-no-drag cursor-pointer hover:text-accent"
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-0.5 text-[11px] text-muted">Move to…</p>
          <MenuItem
            disabled={section.parent_id === null}
            onClick={() => {
              close();
              onMove(section.id, null);
            }}
          >
            This page (top level)
          </MenuItem>
          {rows.map(({ s, depth }) => (
            <MenuItem
              key={s.id}
              indent={depth}
              disabled={section.parent_id === s.id}
              onClick={() => {
                close();
                onMove(section.id, s.id);
              }}
            >
              {sectionLabel(s)}
            </MenuItem>
          ))}
        </>
      )}
    </MenuButton>
  );
}

// "Color": a swatch grid of every hue (columns) at every strength (rows,
// faintest on top), plus None. Picking one applies it straight away.
function ColorMenu({ section }: { section: MemorySection }) {
  const { onChange } = useCanvas();
  const current = section.content.color;
  const swatch = "h-[18px] w-[18px] rounded-[4px] border border-text/10";
  return (
    <MenuButton
      label={
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-text/20"
            style={{ background: tintFor(current)?.background ?? "transparent" }}
          />
          Color
        </span>
      }
      ariaLabel={`Background color for ${sectionLabel(section)}`}
      className="section-no-drag cursor-pointer hover:text-accent"
      width={HUES.length * 21 + 72}
    >
      {(close) => (
        <div className="flex flex-col gap-1 px-2.5 py-1.5 text-[11px] text-muted">
          <button
            type="button"
            onClick={() => {
              close();
              onChange(section.id, { color: null });
            }}
            className={`mb-1 self-start rounded border px-2 py-0.5 hover:text-text ${
              current ? "border-border" : "border-accent text-text"
            }`}
          >
            No color
          </button>
          {STRENGTHS.map((st, si) => (
            <div key={st.label} className="flex items-center gap-[3px]">
              <span className="w-[60px] shrink-0">{st.label}</span>
              {HUES.map((h) => {
                const selected = current?.hue === h.key && current.strength === si;
                return (
                  <button
                    key={h.key}
                    type="button"
                    title={`${h.label}, ${st.label.toLowerCase()}`}
                    aria-label={`${h.label}, ${st.label.toLowerCase()}`}
                    onClick={() => {
                      close();
                      onChange(section.id, { color: { hue: h.key, strength: si } });
                    }}
                    className={`${swatch} ${selected ? "ring-2 ring-text ring-offset-1" : "hover:scale-110"}`}
                    style={{ background: swatchColor(h.key, si) ?? undefined }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

// "Layout" (Associated To-Dos only): its Active / Overdue / Complete groups
// stacked, or side by side for a wide widget.
function TodoLayoutMenu({ section }: { section: MemorySection }) {
  const { onChange } = useCanvas();
  const current = section.content.layout ?? "stacked";
  const options = [
    { value: "stacked", label: "Stacked" },
    { value: "columns", label: "Side by side" },
  ] as const;
  return (
    <MenuButton
      label="Layout"
      ariaLabel={`Layout for ${sectionLabel(section)}`}
      className="section-no-drag cursor-pointer hover:text-accent"
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.value}
            onClick={() => {
              close();
              onChange(section.id, { layout: o.value });
            }}
          >
            {o.value === current ? "✓ " : ""}
            {o.label}
          </MenuItem>
        ))
      }
    </MenuButton>
  );
}

function StyleMenu({ section }: { section: MemorySection }) {
  const { onChange } = useCanvas();
  const boxed = isBoxed(section.type, section.content);
  const options = [
    { value: true, label: "Boxed" },
    { value: false, label: "Flat on the page" },
  ];
  return (
    <MenuButton
      label="Style"
      ariaLabel={`Box or flat for ${sectionLabel(section)}`}
      className="section-no-drag cursor-pointer hover:text-accent"
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.label}
            onClick={() => {
              close();
              onChange(section.id, { boxed: o.value });
            }}
          >
            {o.value === boxed ? "✓ " : ""}
            {o.label}
          </MenuItem>
        ))
      }
    </MenuButton>
  );
}

// Deleting a box that has something in it asks first, right in its title
// bar (not a browser pop-up); an empty one just goes.
function DeleteControl({
  section,
  hasContent,
  confirming,
  setConfirming,
}: {
  section: MemorySection;
  hasContent: boolean;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
}) {
  const { onDelete } = useCanvas();
  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onDelete(section)}
          className="section-no-drag cursor-pointer font-medium text-bad hover:opacity-80"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="section-no-drag cursor-pointer hover:text-text"
        >
          No
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => (hasContent ? setConfirming(true) : onDelete(section))}
      aria-label={`Delete ${SECTION_DEFAULTS[section.type].label}`}
      className="section-no-drag cursor-pointer hover:text-bad"
    >
      ✕
    </button>
  );
}

function SectionCard({ section }: { section: MemorySection }) {
  const { editing, onChange } = useCanvas();
  const tint = tintFor(section.content.color);
  // Flat widgets sit straight on the page (or Section) background with no
  // box. While you're arranging things, or when it has a color, every widget
  // gets its box back so you can see its edges.
  const bare = !isBoxed(section.type, section.content) && !editing && !tint;
  // The Heading module *is* a title, so it doesn't get a second one.
  const hasTitleRow = section.type !== "heading";
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-lg ${
        bare ? "" : "border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
      } ${editing ? "border-dashed border-accent/60" : "border-border"} ${
        tint?.strong ? STRONG_TINT_TEXT : ""
      }`}
      style={tintStyle(tint, editing)}
    >
      {editing && (
        <div
          className={`${handleClassFor(section.parent_id)} flex shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-border/60 px-2 py-1 text-[11px] text-muted active:cursor-grabbing`}
        >
          <span className={`flex items-center gap-1.5 ${confirming ? "text-bad" : ""}`}>
            <span aria-hidden>⠿</span>
            {confirming ? "Delete?" : SECTION_DEFAULTS[section.type].label}
          </span>
          <span className="flex items-center gap-2.5">
            {!confirming && section.type === "todos" && <TodoLayoutMenu section={section} />}
            {!confirming && <StyleMenu section={section} />}
            {!confirming && <ColorMenu section={section} />}
            {!confirming && <MoveMenu section={section} />}
            <DeleteControl
              section={section}
              hasContent={sectionHasContent(section.type, section.content)}
              confirming={confirming}
              setConfirming={setConfirming}
            />
          </span>
        </div>
      )}
      {hasTitleRow && (
        <div className={`shrink-0 ${bare ? "px-0 pt-0.5" : "px-3 pt-2.5"}`}>
          <SectionTitle
            value={section.content.title ?? ""}
            onSave={(title) => onChange(section.id, { title })}
          />
        </div>
      )}
      {/* Headings are a single short line, so they get tight padding even in
          their box — otherwise the 2-row default is too short once the
          edit-mode title bar takes its share. */}
      <div
        className={`min-h-0 flex-1 overflow-auto ${
          !hasTitleRow ? "p-1" : bare ? "px-0 pb-1 pt-1.5" : "px-3 pb-3 pt-1.5"
        }`}
      >
        <SectionBody section={section} onChange={(patch) => onChange(section.id, patch)} />
      </div>
    </div>
  );
}

// A Section: a box with a fixed-height header and its own grid of widgets
// (which can include more Sections). It keeps the size you give it and what's
// inside has to fit, so its header height is fixed in every mode — that's
// what lets groupInnerRows work out the room inside from its height alone.
function GroupCard({ section }: { section: MemorySection }) {
  const { editing, stacked, childrenOf, onChange, onToggleCollapse } = useCanvas();
  const [confirming, setConfirming] = useState(false);
  const childCount = childrenOf(section.id).length;
  const collapsed = !!section.content.collapsed;
  const hasContent = childCount > 0 || sectionHasContent("group", section.content);
  const tint = tintFor(section.content.color);
  const bare = !isBoxed(section.type, section.content) && !editing && !tint;

  return (
    <div
      className={`flex min-h-0 flex-col rounded-lg ${
        bare ? "" : "border bg-bg/70 shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
      } ${stacked ? "" : "h-full"} ${editing ? "border-dashed border-accent/60" : "border-border"} ${
        tint?.strong ? STRONG_TINT_TEXT : ""
      }`}
      style={tintStyle(tint, editing)}
    >
      <div
        className="group/header flex shrink-0 items-center gap-1.5 px-2 text-[11px] text-muted"
        style={{ height: GROUP_HEADER_PX }}
      >
        {editing && (
          <span
            aria-hidden
            className={`${handleClassFor(section.parent_id)} flex cursor-grab select-none items-center self-stretch pr-1 active:cursor-grabbing`}
          >
            ⠿
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggleCollapse(section.id)}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
          aria-expanded={!collapsed}
          className="section-no-drag w-3 shrink-0 text-center hover:text-text"
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <div className="min-w-0 flex-1">
          {confirming ? (
            <span className="text-bad">
              Delete{childCount > 0 ? ` this and the ${childCount} inside it` : ""}?
            </span>
          ) : (
            <SectionTitle
              value={section.content.title ?? ""}
              onSave={(title) => onChange(section.id, { title })}
            />
          )}
        </div>
        {collapsed && childCount > 0 && <span>{childCount}</span>}
        {!confirming && (
          <AddMenu
            scope={section.id}
            label="+"
            className={`section-no-drag px-1 text-sm leading-none hover:text-accent ${
              editing
                ? ""
                : "opacity-0 focus:opacity-100 group-hover/header:opacity-100 [@media(hover:none)]:opacity-100"
            }`}
          />
        )}
        {editing && (
          <span className="flex items-center gap-2.5">
            {!confirming && <StyleMenu section={section} />}
            {!confirming && <ColorMenu section={section} />}
            {!confirming && <MoveMenu section={section} />}
            <DeleteControl
              section={section}
              hasContent={hasContent}
              confirming={confirming}
              setConfirming={setConfirming}
            />
          </span>
        )}
      </div>
      {!collapsed && (
        <div
          className="min-h-0 flex-1"
          style={{ padding: `0 ${GROUP_PAD_PX}px ${GROUP_PAD_PX}px` }}
        >
          <SectionGrid parentId={section.id} maxRows={groupInnerRows(section.h)} />
        </div>
      )}
    </div>
  );
}

function Card({ section }: { section: MemorySection }) {
  return section.type === "group" ? <GroupCard section={section} /> : <SectionCard section={section} />;
}

// The drawing surface for a new widget. It sits underneath the grid's items
// (so you can't draw on top of a widget that's already there) and catches
// presses on the empty squares around them. Press and drag to draw; a plain
// click drops the widget at its default size.
function DrawLayer({
  parentId,
  width,
  maxRows,
  scrollRef,
}: {
  parentId: string | null;
  width: number;
  maxRows: number;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const { childrenOf, onPlace } = useCanvas();
  const [drag, setDrag] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(
    null
  );
  const colW = (width + GRID_MARGIN) / GRID_COLS;
  const rowH = ROW_HEIGHT + GRID_MARGIN;

  function cellAt(e: ReactPointerEvent) {
    const el = scrollRef.current;
    if (!el) return { c: 0, r: 0 };
    const box = el.getBoundingClientRect();
    const c = Math.floor((e.clientX - box.left) / colW);
    const r = Math.floor((e.clientY - box.top + el.scrollTop) / rowH);
    return {
      c: Math.min(GRID_COLS - 1, Math.max(0, c)),
      r: Math.min(maxRows - 1, Math.max(0, r)),
    };
  }

  const rect: Rect | null = drag && {
    id: "",
    x: Math.min(drag.sx, drag.ex),
    y: Math.min(drag.sy, drag.ey),
    w: Math.abs(drag.ex - drag.sx) + 1,
    h: Math.abs(drag.ey - drag.sy) + 1,
  };
  const blocked = !!rect && childrenOf(parentId).some((s) => overlaps(rect, toRect(s)));

  return (
    <div
      className="absolute inset-0 z-0 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const { c, r } = cellAt(e);
        setDrag({ sx: c, sy: r, ex: c, ey: r });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const { c, r } = cellAt(e);
        if (c !== drag.ex || r !== drag.ey) setDrag({ ...drag, ex: c, ey: r });
      }}
      onPointerUp={() => {
        if (!rect || !drag) return;
        setDrag(null);
        onPlace(parentId, rect, drag.sx === drag.ex && drag.sy === drag.ey);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {rect && (
        <div
          className={`pointer-events-none absolute rounded-lg border-2 border-dashed ${
            blocked ? "border-bad bg-bad/10" : "border-accent bg-accent/15"
          }`}
          style={{
            left: rect.x * colW,
            top: rect.y * rowH,
            width: rect.w * colW - GRID_MARGIN,
            height: rect.h * rowH - GRID_MARGIN,
          }}
        />
      )}
    </div>
  );
}

// One snap grid: the page's own (parentId null; grows downward as needed) or
// the inside of a Section (a fixed number of rows).
function SectionGrid({ parentId, maxRows }: { parentId: string | null; maxRows?: number }) {
  const { editing, stacked, placing, childrenOf, onGridChange } = useCanvas();
  const items = childrenOf(parentId);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stacked]);

  const isPage = parentId === null;

  if (stacked) {
    if (items.length === 0) {
      return isPage ? (
        <p className="py-8 text-center text-sm text-muted">
          A blank canvas. Use “+ Add widget” to start building this page.
        </p>
      ) : null;
    }
    return (
      <div className="flex flex-col gap-3">
        {[...items]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((s) => (
            // Sections size to what's inside them here; everything else
            // keeps its height from the grid.
            <div
              key={s.id}
              style={
                s.type === "group"
                  ? undefined
                  : { height: s.h * ROW_HEIGHT + (s.h - 1) * GRID_MARGIN }
              }
            >
              <Card section={s} />
            </div>
          ))}
      </div>
    );
  }

  // A Section can't be shrunk smaller than what's inside it.
  const minHOf = (s: MemorySection) => {
    const d = SECTION_DEFAULTS[s.type];
    if (s.type !== "group") return d.minH;
    const bottom = childrenOf(s.id).reduce((m, c) => Math.max(m, c.y + c.h), 0);
    return Math.max(d.minH, groupHeightFor(bottom));
  };

  // A collapsed Section is saved one row tall; it can be moved but not
  // resized until it's opened again.
  const layout: Layout[] = items.map((s) => {
    const collapsed = s.type === "group" && !!s.content.collapsed;
    return {
      i: s.id,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      minW: SECTION_DEFAULTS[s.type].minW,
      minH: collapsed ? 1 : minHOf(s),
      ...(collapsed ? { maxH: 1, isResizable: false } : {}),
    };
  });

  // Dots at every snap point while arranging, so "snap" is visible: each
  // dot is where a section's top-left corner can land.
  const cellW = (width - GRID_MARGIN * (GRID_COLS - 1)) / GRID_COLS + GRID_MARGIN;
  const cellH = ROW_HEIGHT + GRID_MARGIN;
  const dotStyle =
    editing && width > 0
      ? {
          backgroundImage: "radial-gradient(circle at 0 0, rgba(140,131,114,0.45) 1.5px, transparent 2px)",
          backgroundSize: `${cellW}px ${cellH}px`,
        }
      : undefined;

  // While drawing, presses on empty squares go to the DrawLayer underneath:
  // the grid's own (transparent) container lets them through, and only the
  // widgets themselves still catch them.
  const drawing = !!placing && (placing.scope === "any" || placing.scope === parentId);

  return (
    <div
      ref={ref}
      className={`relative ${
        isPage ? "min-h-[60vh] pb-24" : "h-full overflow-y-auto overflow-x-hidden"
      } ${
        drawing
          ? "[&>.react-grid-layout]:pointer-events-none [&_.react-grid-item]:pointer-events-auto"
          : ""
      }`}
      style={dotStyle}
    >
      {drawing && width > 0 && (
        <DrawLayer
          parentId={parentId}
          width={width}
          maxRows={maxRows ?? Infinity}
          scrollRef={ref}
        />
      )}
      {items.length === 0 &&
        (isPage ? (
          <p className="py-8 text-center text-sm text-muted">
            A blank canvas. Use “+ Add widget” to start building this page.
          </p>
        ) : (
          !editing && <p className="pt-1 text-xs text-muted/70">Empty. Use + to add widgets.</p>
        ))}
      {width > 0 && (
        <GridLayout
          layout={layout}
          cols={GRID_COLS}
          rowHeight={ROW_HEIGHT}
          width={width}
          margin={[GRID_MARGIN, GRID_MARGIN]}
          containerPadding={[0, 0]}
          maxRows={maxRows ?? Infinity}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle={`.${handleClassFor(parentId)}`}
          draggableCancel=".section-no-drag"
          compactType={null}
          // Sections never overlap and are never shoved around. Without
          // this, dragging one across another pushes the other down and
          // leaves it there (nothing pulls it back), so a single drag can
          // scramble the page. A drop onto an occupied spot instead just
          // snaps back to the last free one.
          preventCollision
          onDragStop={onGridChange}
          onResizeStop={onGridChange}
        >
          {items.map((s) => (
            <div key={s.id}>
              <Card section={s} />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}

export default function WorkspaceCanvas({
  workspace,
  initialSections,
  addSectionAction,
  updateContentAction,
  saveLayoutsAction,
  deleteSectionAction,
  moveSectionAction,
  initialPhotoUrls,
  deletePhotosAction,
  todos,
  setTaskDoneAction,
  deleteTaskAction,
}: WorkspaceCanvasProps) {
  const router = useRouter();
  const [sections, setSections] = useState<MemorySection[]>(initialSections);
  // Mirror of `sections` that handlers read and write synchronously. Several
  // changes can land before React re-renders (e.g. a title and a text box
  // both flushing their autosave as you click away); reading the render's
  // snapshot instead would let the later one overwrite the earlier one.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  function commit(next: MemorySection[]) {
    sectionsRef.current = next;
    setSections(next);
  }
  const [photoUrls, setPhotoUrls] = useState(initialPhotoUrls);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // A short message in the toolbar for something that couldn't be done
  // (e.g. no room left in a Section) — inline, never a browser pop-up.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inflight = useRef(0);
  const hadError = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  // Esc stops drawing.
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelPlacing();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  function cancelPlacing() {
    setPlacing(null);
    setNotice(null);
  }

  function showNotice(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }

  // Every save goes through here so the toolbar can show saving / saved /
  // failed. A failure stays visible (rather than being overwritten by the
  // next success) because that earlier change genuinely didn't land.
  function track(op: Promise<boolean>) {
    inflight.current += 1;
    setSaveState("saving");
    op.then(
      (ok) => {
        inflight.current -= 1;
        if (!ok) hadError.current = true;
        if (inflight.current === 0) setSaveState(hadError.current ? "error" : "saved");
      },
      () => {
        inflight.current -= 1;
        hadError.current = true;
        if (inflight.current === 0) setSaveState("error");
      }
    );
  }

  function childrenOf(parentId: string | null) {
    return sectionsRef.current.filter((s) => s.parent_id === parentId);
  }

  // Where a w×h box can go in a grid: the page always has room (it grows
  // downward), a Section only has the room its size gives it. Tries the
  // box's own height, then `minH`, before giving up with a notice.
  function placeIn(
    parentId: string | null,
    w: number,
    h: number,
    minH: number,
    excludeId?: string
  ): { x: number; y: number; h: number } | null {
    const siblings = childrenOf(parentId)
      .filter((s) => s.id !== excludeId)
      .map(toRect);
    if (parentId === null) return { x: 0, y: nextFreeY(siblings), h };
    const parent = sectionsRef.current.find((s) => s.id === parentId);
    if (!parent) return null;
    const rows = groupInnerRows(parent.h);
    for (const tryH of h > minH ? [h, minH] : [h]) {
      const spot = findFreeSpot(siblings, w, tryH, rows);
      if (spot) return { ...spot, h: tryH };
    }
    showNotice(`No room in “${sectionLabel(parent)}”. Make it bigger or clear some space in it first.`);
    return null;
  }

  // Collapsing is part of the saved layout, so the page looks the same in
  // every mode: a collapsed Section is saved one row tall (its full height
  // kept in content.expandedH) and what was below it slides up; opening it
  // restores the height and pushes whatever's in the way back down.
  function collapseSection(s: MemorySection) {
    if (s.type !== "group" || s.h <= 1) {
      handleContentChange(s.id, { collapsed: true, expandedH: s.h });
      return;
    }
    const siblings = childrenOf(s.parent_id).map(toRect);
    handleContentChange(s.id, { collapsed: true, expandedH: s.h });
    applyLayout(collapsedLayout(siblings, new Set([s.id])));
  }

  function expandSection(s: MemorySection) {
    const h = Math.max(SECTION_DEFAULTS.group.minH, s.content.expandedH ?? s.h);
    const siblings = childrenOf(s.parent_id).map((r) => (r.id === s.id ? { ...toRect(r), h } : toRect(r)));
    handleContentChange(s.id, { collapsed: false, expandedH: undefined });
    applyLayout(pushDown(siblings, s.id));
  }

  function handleToggleCollapse(id: string) {
    const s = sectionsRef.current.find((x) => x.id === id);
    if (!s) return;
    if (s.content.collapsed) expandSection(s);
    else collapseSection(s);
  }

  // Sections collapsed before collapsing was saved into the layout still have
  // their full height; fold them properly once, so nothing jumps later.
  useEffect(() => {
    for (const s of sectionsRef.current) {
      if (s.type === "group" && s.content.collapsed && s.content.expandedH == null) {
        const current = sectionsRef.current.find((x) => x.id === s.id);
        if (current) collapseSection(current);
      }
    }
    // Runs once on load, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opens a collapsed Section when something is moved into it, so you can
  // see where it went (and so it has room inside).
  function expandIfCollapsed(parentId: string | null) {
    const parent = parentId ? sectionsRef.current.find((s) => s.id === parentId) : undefined;
    if (parent?.content.collapsed) expandSection(parent);
  }

  // Picking a widget from an Add menu starts drawing it, in edit mode (which
  // leaves the layout exactly as it was, collapsed Sections included). A
  // Section's own + opens that Section first if it's collapsed, since there'd
  // be nowhere to draw. On a narrow screen there's no grid to draw on, so the
  // widget is dropped in the first spot that fits instead.
  function handleAdd(type: SectionType, scope: "any" | string) {
    if (scope !== "any") expandIfCollapsed(scope);
    if (stacked) {
      const parentId = scope === "any" ? null : scope;
      const d = SECTION_DEFAULTS[type];
      const spot = placeIn(parentId, d.w, d.h, d.minH);
      if (spot) createSection(type, parentId, { id: "", x: spot.x, y: spot.y, w: d.w, h: spot.h });
      return;
    }
    setNotice(null);
    setEditing(true);
    setPlacing({ type, scope });
  }

  // Finishes drawing: a drag sets the size (grown to the widget's minimum if
  // drawn smaller); a plain click uses the default size, or the minimum if
  // that's all the room there is. If it doesn't fit, you keep drawing.
  function handlePlace(parentId: string | null, drawn: Rect, isClick: boolean) {
    if (!placing) return;
    const d = SECTION_DEFAULTS[placing.type];
    const parent = parentId ? sectionsRef.current.find((s) => s.id === parentId) : undefined;
    if (parentId && !parent) return;
    const rows = parent ? groupInnerRows(parent.h) : Infinity;
    const siblings = childrenOf(parentId).map(toRect);
    const shape = (w: number, h: number): Rect => {
      const cw = Math.min(w, GRID_COLS);
      return {
        id: "",
        x: Math.min(drawn.x, GRID_COLS - cw),
        y: rows === Infinity ? drawn.y : Math.max(0, Math.min(drawn.y, rows - h)),
        w: cw,
        h,
      };
    };
    const fits = (r: Rect) => r.y + r.h <= rows && !siblings.some((s) => overlaps(r, s));
    const candidates = isClick
      ? [shape(d.w, d.h), shape(d.minW, d.minH)]
      : [shape(Math.max(drawn.w, d.minW), Math.max(drawn.h, d.minH))];
    const r = candidates.find(fits);
    if (!r) {
      showNotice(
        !isClick && siblings.some((s) => overlaps(drawn, s))
          ? "That overlaps something. Draw it over empty squares."
          : `Not enough room there. A ${d.label} needs at least ${d.minW}×${d.minH} empty squares.`
      );
      return;
    }
    setPlacing(null);
    setNotice(null);
    expandIfCollapsed(parentId);
    createSection(placing.type, parentId, r);
  }

  function createSection(type: SectionType, parentId: string | null, r: Rect) {
    const now = new Date().toISOString();
    const section: MemorySection = {
      id: crypto.randomUUID(),
      user_id: "",
      ...ownerFields(workspace),
      parent_id: parentId,
      type,
      content: defaultSectionContent(type),
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      created_at: now,
      updated_at: now,
    };
    commit([...sectionsRef.current, section]);
    track(
      addSectionAction({
        id: section.id,
        workspace,
        parentId,
        type,
        content: section.content,
        x: section.x,
        y: section.y,
        w: section.w,
        h: section.h,
      }).then((ok) => {
        // The first Associated To-Dos on a workspace needs the task data,
        // which the page only loads when one exists.
        if (ok && type === "todos" && !todos) router.refresh();
        return ok;
      })
    );
  }

  // Moves a widget (a Section brings everything inside it along) into
  // another Section or back onto the page, at the first spot it fits.
  function handleMove(id: string, parentId: string | null) {
    const s = sectionsRef.current.find((x) => x.id === id);
    if (!s || s.parent_id === parentId) return;
    expandIfCollapsed(parentId);
    const spot = placeIn(parentId, s.w, s.h, s.h, s.id);
    if (!spot) return;
    const moved = { ...s, parent_id: parentId, x: spot.x, y: spot.y, h: spot.h };
    commit(sectionsRef.current.map((x) => (x.id === id ? moved : x)));
    track(
      moveSectionAction({
        id,
        workspace,
        parentId,
        x: moved.x,
        y: moved.y,
        w: moved.w,
        h: moved.h,
      })
    );
  }

  // `patch` is just the fields one module/title changed; it's merged into the
  // section's existing content here (so typing in the body never drops the
  // title, and vice versa) and the full merged content is what gets saved.
  function handleContentChange(id: string, patch: SectionContent) {
    const current = sectionsRef.current.find((s) => s.id === id);
    if (!current) return; // deleted while an autosave was still pending
    const content = { ...current.content, ...patch };
    commit(sectionsRef.current.map((s) => (s.id === id ? { ...s, content } : s)));
    track(updateContentAction(id, content));
  }

  // The "are you sure" for boxes with content lives in the box's own title
  // bar, so by the time this runs the delete is confirmed. A Section takes
  // everything inside it along, matching the database's cascade.
  function handleDelete(section: MemorySection) {
    const doomed = new Set([section.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of sectionsRef.current) {
        if (s.parent_id && doomed.has(s.parent_id) && !doomed.has(s.id)) {
          doomed.add(s.id);
          grew = true;
        }
      }
    }
    commit(sectionsRef.current.filter((s) => !doomed.has(s.id)));
    track(deleteSectionAction(section.id));
  }

  // Applies a set of new positions/sizes: updates local state and saves only
  // the sections that actually changed (a drop can also push neighbours).
  function applyLayout(next: Rect[]) {
    const byId = new Map(next.map((l) => [l.id, l]));
    const changed: Rect[] = [];
    const updated = sectionsRef.current.map((s) => {
      const l = byId.get(s.id);
      if (!l || (l.x === s.x && l.y === s.y && l.w === s.w && l.h === s.h)) return s;
      changed.push(l);
      return { ...s, x: l.x, y: l.y, w: l.w, h: l.h };
    });
    if (changed.length === 0) return;
    commit(updated);
    track(saveLayoutsAction(workspace, changed));
  }

  function handleGridChange(layout: Layout[]) {
    applyLayout(layout.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
  }

  // Tidies every grid on the page, including the inside of each Section.
  function handleTidy() {
    const parents = new Set(sectionsRef.current.map((s) => s.parent_id));
    applyLayout([...parents].flatMap((p) => tidyLayout(childrenOf(p).map(toRect))));
  }

  const stacked = width > 0 && width < STACK_BELOW_PX;
  const api: CanvasApi = {
    editing: editing && !stacked,
    stacked,
    childrenOf: (parentId) => sections.filter((s) => s.parent_id === parentId),
    onChange: handleContentChange,
    onToggleCollapse: handleToggleCollapse,
    onDelete: handleDelete,
    placing: stacked ? null : placing,
    onAdd: handleAdd,
    onPlace: handlePlace,
    onMove: handleMove,
    onGridChange: handleGridChange,
  };

  const photoApi: PhotoApi = {
    urls: photoUrls,
    addUrl: (path, url) => setPhotoUrls((prev) => ({ ...prev, [path]: url })),
    removeFiles: (paths) => track(deletePhotosAction(paths)),
  };

  const todoApi: TodoApi = {
    loaded: !!todos,
    ownerProjectId: workspace.kind === "project" ? workspace.id : null,
    projects: todos?.projects ?? [],
    tasks: todos?.tasks ?? [],
    today: todos?.today ?? "",
    setDone: (taskId, done) => setTaskDoneAction(taskId, done),
    deleteTask: (taskId) => deleteTaskAction(taskId),
  };

  const placingInto =
    placing && placing.scope !== "any" ? sections.find((s) => s.id === placing.scope) : undefined;

  return (
    <CanvasContext.Provider value={api}>
      <PhotoContext.Provider value={photoApi}>
        <TodoContext.Provider value={todoApi}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AddMenu
                scope="any"
                label="+ Add widget"
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
              />

              <div className="flex items-center gap-3 text-xs">
                <span
                  className={notice || saveState === "error" ? "text-bad" : "text-muted"}
                  aria-live="polite"
                >
                  {notice ??
                    (placing && !stacked ? (
                      <span className="text-text">
                        Drag across empty squares to draw the {SECTION_DEFAULTS[placing.type].label}
                        {placingInto && ` inside “${sectionLabel(placingInto)}”`}.{" "}
                        <button
                          type="button"
                          onClick={cancelPlacing}
                          className="text-muted underline underline-offset-2 hover:text-text"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                    <>
                      {saveState === "saving" && "Saving…"}
                      {saveState === "saved" && "Saved"}
                      {saveState === "error" && "Couldn’t save some changes — reload and try again"}
                    </>
                    ))}
                </span>
                {stacked ? (
                  <span className="text-muted">Widen the window to rearrange</span>
                ) : (
                  <>
                    {editing && (
                      <button
                        type="button"
                        onClick={handleTidy}
                        className="rounded-md border border-border px-2.5 py-1.5 text-muted hover:border-accent hover:text-accent"
                      >
                        Tidy up
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        cancelPlacing();
                        setEditing((e) => !e);
                      }}
                      className={`rounded-md border px-2.5 py-1.5 ${
                        editing
                          ? "border-accent bg-accent text-bg"
                          : "border-border text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      {editing ? "Done" : "Edit layout"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div ref={containerRef}>{width > 0 && <SectionGrid parentId={null} />}</div>
          </div>
        </TodoContext.Provider>
      </PhotoContext.Provider>
    </CanvasContext.Provider>
  );
}

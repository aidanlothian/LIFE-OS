"use client";

import { useState, type DragEvent, type FormEvent, type PointerEvent } from "react";
import { MenuButton, MenuItem } from "./menus";
import type {
  SectionContent,
  TableColumn,
  TableColumnType,
  TableRow,
} from "@/types";

type Cell = TableRow["cells"][string];

const TYPE_LABELS: Record<TableColumnType, string> = {
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  select: "Select (dropdown)",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Best-effort conversion when a column changes type, so switching back and
// forth doesn't silently wipe what was typed.
function convert(value: Cell, to: TableColumnType): Cell {
  const text = value === true ? "Yes" : value === false || value === null ? "" : String(value);
  switch (to) {
    case "number": {
      const n = parseFloat(text.replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return value === true || /^(yes|y|true|x|✓|1|done)$/i.test(text.trim());
    case "date":
      return DATE_RE.test(text) ? text : "";
    default:
      return value === false ? "" : text;
  }
}

function isEmpty(v: Cell) {
  return v === null || v === undefined || v === "";
}

// Sort comparator for one column; empty cells always sink to the bottom.
function compare(a: Cell, b: Cell, type: TableColumnType, dir: 1 | -1) {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (type === "number") return ((a as number) - (b as number)) * dir;
  if (type === "checkbox") return ((a ? 1 : 0) - (b ? 1 : 0)) * -dir;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * dir;
}

function formatNumber(v: Cell) {
  return typeof v === "number" ? String(v) : "";
}

const MIN_COL_PX = 60;
// Columns without a set width get at least this much before the table
// scrolls sideways.
const AUTO_COL_PX = 130;

const cellInput =
  "w-full min-w-0 bg-transparent px-2 py-1 text-sm text-text outline-none focus:bg-bg";

export default function TableSection({
  content,
  onChange,
}: {
  content: SectionContent;
  onChange: (patch: SectionContent) => void;
}) {
  const columns = content.columns ?? [];
  const rows = content.rows ?? [];
  const sort = content.sort ?? null;
  const [dragCol, setDragCol] = useState<string | null>(null);
  // While a column edge is being dragged, its width lives here and is only
  // saved when you let go.
  const [resizing, setResizing] = useState<{ id: string; width: number } | null>(null);
  const widthOf = (c: TableColumn) => (resizing?.id === c.id ? resizing.width : c.width);

  function startResize(e: PointerEvent<HTMLSpanElement>, col: TableColumn) {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest("th");
    const startX = e.clientX;
    const startW = th ? th.getBoundingClientRect().width : (col.width ?? AUTO_COL_PX);
    let latest = startW;
    const move = (ev: globalThis.PointerEvent) => {
      latest = Math.max(MIN_COL_PX, Math.round(startW + ev.clientX - startX));
      setResizing({ id: col.id, width: latest });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(null);
      if (latest !== startW) updateColumn(col.id, { width: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const setColumns = (next: TableColumn[], extra: SectionContent = {}) =>
    onChange({ columns: next, ...extra });
  const setRows = (next: TableRow[]) => onChange({ rows: next });

  function setCell(rowId: string, colId: string, value: Cell) {
    setRows(
      rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r))
    );
  }

  function addColumn() {
    const id = crypto.randomUUID();
    setColumns([...columns, { id, name: `Column ${columns.length + 1}`, type: "text" }]);
  }

  function addRow() {
    setRows([...rows, { id: crypto.randomUUID(), cells: {} }]);
  }

  function updateColumn(id: string, patch: Partial<TableColumn>) {
    setColumns(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function changeType(col: TableColumn, type: TableColumnType) {
    if (col.type === type) return;
    const nextRows = rows.map((r) => ({
      ...r,
      cells: { ...r.cells, [col.id]: convert(r.cells[col.id] ?? null, type) },
    }));
    // A new dropdown starts with whatever values the column already held.
    const options =
      type === "select"
        ? Array.from(
            new Set([
              ...(col.options ?? []),
              ...nextRows.map((r) => String(r.cells[col.id] ?? "")).filter(Boolean),
            ])
          )
        : col.options;
    onChange({
      columns: columns.map((c) => (c.id === col.id ? { ...c, type, options } : c)),
      rows: nextRows,
    });
  }

  function deleteColumn(id: string) {
    onChange({
      columns: columns.filter((c) => c.id !== id),
      rows: rows.map((r) => {
        const cells = { ...r.cells };
        delete cells[id];
        return { ...r, cells };
      }),
      ...(sort?.columnId === id ? { sort: null } : {}),
    });
  }

  // Column drag-to-reorder (native HTML5 drag; setData is required or
  // Firefox aborts the drag).
  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const from = dragCol;
    setDragCol(null);
    if (!from || from === targetId) return;
    const moving = columns.find((c) => c.id === from);
    if (!moving) return;
    const rest = columns.filter((c) => c.id !== from);
    const at = rest.findIndex((c) => c.id === targetId);
    const fromIndex = columns.findIndex((c) => c.id === from);
    const toIndex = columns.findIndex((c) => c.id === targetId);
    // Dropping onto a column to the right puts it after that column.
    rest.splice(fromIndex < toIndex ? at + 1 : at, 0, moving);
    setColumns(rest);
  }

  const sortCol = sort ? columns.find((c) => c.id === sort.columnId) : undefined;
  const shown =
    sort && sortCol
      ? [...rows].sort((a, b) =>
          compare(
            a.cells[sortCol.id] ?? null,
            b.cells[sortCol.id] ?? null,
            sortCol.type,
            sort.dir === "asc" ? 1 : -1
          )
        )
      : rows;

  const allSized = columns.length > 0 && columns.every((c) => widthOf(c));
  const tableWidth = columns.reduce((sum, c) => sum + (widthOf(c) ?? AUTO_COL_PX), 0) + 40;

  return (
    <div className="flex flex-col gap-1">
      {/* Wide tables scroll sideways inside the widget, never the page. */}
      <div
        className={`section-no-drag overflow-x-auto rounded border border-border/70 ${
          allSized ? "max-w-full self-start" : ""
        }`}
      >
        {/* Columns without a width share the leftover room; once every
            column has one, the table is exactly as wide as they add up to. */}
        <table
          className={`${allSized ? "" : "w-full"} table-fixed border-collapse text-sm`}
          style={allSized ? { width: tableWidth } : { minWidth: tableWidth }}
        >
          <colgroup>
            {columns.map((c) => {
              const w = widthOf(c);
              return <col key={c.id} style={w ? { width: w } : undefined} />;
            })}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr className="bg-border/30">
              {columns.map((col) => (
                <th
                  key={col.id}
                  onDragOver={(e) => dragCol && e.preventDefault()}
                  onDrop={(e) => handleDrop(e, col.id)}
                  className={`group/col relative border-b border-r border-border/70 p-0 text-left font-medium ${
                    dragCol === col.id ? "opacity-40" : ""
                  }`}
                >
                  <div className="flex items-center gap-1 pl-1 pr-1">
                    {/* Only the handle is draggable, so text in the name box
                        can still be selected normally. */}
                    <span
                      aria-hidden
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", col.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragCol(col.id);
                      }}
                      onDragEnd={() => setDragCol(null)}
                      className="cursor-grab text-[10px] text-muted opacity-0 group-hover/col:opacity-100"
                      title="Drag to reorder"
                    >
                      ⠿
                    </span>
                    <input
                      key={col.name}
                      defaultValue={col.name}
                      aria-label="Column name"
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== col.name) updateColumn(col.id, { name });
                        else e.target.value = col.name;
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="min-w-0 flex-1 bg-transparent py-1 text-xs font-semibold uppercase tracking-wide text-muted outline-none focus:text-text"
                    />
                    {sort?.columnId === col.id && (
                      <span className="text-[10px] text-accent">{sort.dir === "asc" ? "▲" : "▼"}</span>
                    )}
                    <ColumnMenu
                      col={col}
                      sort={sort}
                      onType={(t) => changeType(col, t)}
                      onSort={(dir) =>
                        onChange({ sort: dir ? { columnId: col.id, dir } : null })
                      }
                      onOptions={(options) => updateColumn(col.id, { options })}
                      onDelete={() => deleteColumn(col.id)}
                    />
                  </div>
                  {/* Drag the right edge to resize; double-click to go back
                      to sharing the table's width. */}
                  <span
                    aria-hidden
                    title="Drag to resize · double-click to reset"
                    onPointerDown={(e) => startResize(e, col)}
                    onDoubleClick={() => updateColumn(col.id, { width: undefined })}
                    className={`absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize touch-none hover:bg-accent/50 ${
                      resizing?.id === col.id ? "bg-accent/60" : ""
                    }`}
                  />
                </th>
              ))}
              <th className="border-b border-border/70 p-0">
                <button
                  type="button"
                  onClick={addColumn}
                  aria-label="Add column"
                  title="Add column"
                  className="w-full py-1 text-muted hover:text-accent"
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} className="group/row border-b border-border/50 last:border-b-0">
                {columns.map((col) => (
                  <td key={col.id} className="border-r border-border/50 p-0 align-middle">
                    <CellEditor
                      col={col}
                      value={row.cells[col.id] ?? null}
                      onSave={(v) => setCell(row.id, col.id, v)}
                    />
                  </td>
                ))}
                <td className="p-0 text-center">
                  <button
                    type="button"
                    aria-label="Delete row"
                    onClick={() => setRows(rows.filter((r) => r.id !== row.id))}
                    className="text-muted opacity-0 hover:text-bad focus:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="self-start px-1 py-0.5 text-sm text-muted hover:text-accent"
      >
        + New row
      </button>
    </div>
  );
}

function CellEditor({
  col,
  value,
  onSave,
}: {
  col: TableColumn;
  value: Cell;
  onSave: (v: Cell) => void;
}) {
  switch (col.type) {
    case "checkbox":
      return (
        <div className="flex justify-center py-1">
          <button
            type="button"
            aria-label={value ? "Uncheck" : "Check"}
            aria-pressed={!!value}
            onClick={() => onSave(!value)}
            className={`h-4 w-4 rounded border ${value ? "border-good bg-good" : "border-muted"}`}
          />
        </div>
      );
    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onSave(e.target.value)}
          aria-label={col.name}
          className={`${cellInput} text-xs`}
        />
      );
    case "select":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onSave(e.target.value)}
          aria-label={col.name}
          className={`${cellInput} cursor-pointer ${value ? "" : "text-muted"}`}
        >
          <option value="">—</option>
          {(col.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {/* A value whose option was since removed still shows. */}
          {typeof value === "string" && value && !(col.options ?? []).includes(value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      );
    case "number":
      return (
        <input
          key={formatNumber(value)}
          type="number"
          defaultValue={formatNumber(value)}
          aria-label={col.name}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const n = raw === "" ? null : Number(raw);
            if (n === null || Number.isFinite(n)) {
              if (n !== value) onSave(n);
            } else e.target.value = formatNumber(value);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`${cellInput} text-right tabular-nums`}
        />
      );
    default:
      return (
        <input
          key={typeof value === "string" ? value : ""}
          defaultValue={typeof value === "string" ? value : ""}
          aria-label={col.name}
          onBlur={(e) => {
            if (e.target.value !== (value ?? "")) onSave(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cellInput}
        />
      );
  }
}

function ColumnMenu({
  col,
  sort,
  onType,
  onSort,
  onOptions,
  onDelete,
}: {
  col: TableColumn;
  sort: SectionContent["sort"];
  onType: (t: TableColumnType) => void;
  onSort: (dir: "asc" | "desc" | null) => void;
  onOptions: (options: string[]) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState("");
  const options = col.options ?? [];
  const sorted = sort?.columnId === col.id ? sort.dir : null;

  function addOption(e: FormEvent) {
    e.preventDefault();
    const o = draft.trim();
    if (o && !options.includes(o)) onOptions([...options, o]);
    setDraft("");
  }

  return (
    <MenuButton
      label="▾"
      ariaLabel={`Options for column ${col.name}`}
      className="shrink-0 px-0.5 text-[11px] text-muted opacity-0 hover:text-accent focus:opacity-100 group-hover/col:opacity-100 [@media(hover:none)]:opacity-100"
      width={220}
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-0.5 text-[11px] text-muted">Type</p>
          {(Object.keys(TYPE_LABELS) as TableColumnType[]).map((t) => (
            <MenuItem
              key={t}
              onClick={() => {
                close();
                onType(t);
              }}
            >
              {col.type === t ? "✓ " : ""}
              {TYPE_LABELS[t]}
            </MenuItem>
          ))}

          {col.type === "select" && (
            <div className="border-t border-border/60 px-3 py-1.5">
              <p className="pb-1 text-[11px] text-muted">Dropdown options</p>
              <ul className="flex flex-col gap-0.5">
                {options.map((o) => (
                  <li key={o} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{o}</span>
                    <button
                      type="button"
                      aria-label={`Remove option ${o}`}
                      onClick={() => onOptions(options.filter((x) => x !== o))}
                      className="text-muted hover:text-bad"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <form onSubmit={addOption}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="+ Add option"
                  className="mt-1 w-full rounded border border-border bg-bg px-1.5 py-0.5 text-sm outline-none focus:border-accent"
                />
              </form>
            </div>
          )}

          <div className="mt-1 border-t border-border/60 pt-1">
            <MenuItem
              onClick={() => {
                close();
                onSort("asc");
              }}
            >
              {sorted === "asc" ? "✓ " : ""}Sort A → Z
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                onSort("desc");
              }}
            >
              {sorted === "desc" ? "✓ " : ""}Sort Z → A
            </MenuItem>
            {sorted && (
              <MenuItem
                onClick={() => {
                  close();
                  onSort(null);
                }}
              >
                Clear sort
              </MenuItem>
            )}
          </div>

          <div className="mt-1 border-t border-border/60 pt-1">
            <button
              type="button"
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                close();
                onDelete();
              }}
              className="block w-full py-1.5 pl-3 pr-3 text-left text-bad hover:bg-border/40"
            >
              {confirmDelete ? "Click again to delete" : "Delete column"}
            </button>
          </div>
        </>
      )}
    </MenuButton>
  );
}

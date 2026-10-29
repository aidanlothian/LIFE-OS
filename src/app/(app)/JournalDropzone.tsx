"use client";

import { startTransition, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { saveJournalItems } from "./actions";

interface ParseResult {
  targets: string[];
  todos: string[];
}

// Local-only id so each editable row has a stable React key even as items
// are added/removed/reordered — never sent anywhere.
let nextId = 1;
interface Row {
  id: number;
  text: string;
}

function toRows(items: string[]): Row[] {
  return items.map((text) => ({ id: nextId++, text }));
}

export default function JournalDropzone({ today }: { today: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<"idle" | "uploading" | "review">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Row[]>([]);
  const [todos, setTodos] = useState<Row[]>([]);
  const [dueDate, setDueDate] = useState(today);
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch("/api/journal/parse", { method: "POST", body: formData });
      const data = (await res.json()) as ParseResult & { error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to read the photo.");
      }
      setTargets(toRows(data.targets.slice(0, 3)));
      setTodos(toRows(data.todos));
      setDueDate(today);
      setStatus("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the photo.");
      setStatus("idle");
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (file) handleFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function updateRow(rows: Row[], setRows: (r: Row[]) => void, id: number, text: string) {
    setRows(rows.map((r) => (r.id === id ? { ...r, text } : r)));
  }

  function removeRow(rows: Row[], setRows: (r: Row[]) => void, id: number) {
    setRows(rows.filter((r) => r.id !== id));
  }

  function addRow(rows: Row[], setRows: (r: Row[]) => void) {
    setRows([...rows, { id: nextId++, text: "" }]);
  }

  function closeReview() {
    setStatus("idle");
    setTargets([]);
    setTodos([]);
  }

  function handleSave() {
    const targetTexts = targets.map((r) => r.text.trim()).filter(Boolean);
    const todoTexts = todos.map((r) => r.text.trim()).filter(Boolean);
    setSaving(true);
    startTransition(async () => {
      await saveJournalItems(targetTexts, todoTexts, dueDate);
      router.refresh();
      setSaving(false);
      closeReview();
    });
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        title="Drop a photo of today's journal page, or click to choose one"
        className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
          dragOver
            ? "border-accent bg-accent/10 text-accent"
            : "border-border text-muted hover:border-accent hover:text-accent"
        }`}
      >
        <span>📷</span>
        <span>{status === "uploading" ? "Reading photo…" : "Journal photo"}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={handleInputChange}
      />
      {error && <p className="mt-1 max-w-[220px] text-right text-[11px] text-bad">{error}</p>}

      {status === "review" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
          onClick={closeReview}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Review journal photo</h3>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-md border border-border bg-bg px-1.5 py-1 text-xs outline-none focus:border-accent"
                />
              </label>
            </div>

            <p className="text-xs text-muted">
              Double-check what was read from your handwriting before saving — fix, remove, or add
              anything below.
            </p>

            <EditableSection
              label={`3 Things (${targets.length}/3)`}
              rows={targets}
              placeholder="e.g. Organize room"
              disableAdd={targets.length >= 3}
              onChange={(id, text) => updateRow(targets, setTargets, id, text)}
              onRemove={(id) => removeRow(targets, setTargets, id)}
              onAdd={() => targets.length < 3 && addRow(targets, setTargets)}
            />

            <EditableSection
              label="To-Do"
              rows={todos}
              placeholder="e.g. Call dentist"
              onChange={(id, text) => updateRow(todos, setTodos, id, text)}
              onRemove={(id) => removeRow(todos, setTodos, id)}
              onAdd={() => addRow(todos, setTodos)}
            />

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to Control Center"}
              </button>
              <button
                type="button"
                onClick={closeReview}
                className="text-sm text-muted hover:text-text"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditableSection({
  label,
  rows,
  placeholder,
  disableAdd,
  onChange,
  onRemove,
  onAdd,
}: {
  label: string;
  rows: Row[];
  placeholder: string;
  disableAdd?: boolean;
  onChange: (id: number, text: string) => void;
  onRemove: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h4>
      {rows.length === 0 && <p className="text-xs text-muted">Nothing found — add manually below.</p>}
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              value={row.text}
              onChange={(e) => onChange(row.id, e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              aria-label="Remove"
              className="text-muted hover:text-bad"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={disableAdd}
        className="self-start text-xs text-accent hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add item
      </button>
    </section>
  );
}

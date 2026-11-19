"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { hostOf, isSafeHref, normalizeUrl } from "@/lib/urls";
import type { ChecklistItem, LinkItem, MemorySection, SectionContent } from "@/types";
import GallerySection from "./gallery";
import TodosSection from "./todos";
import TableSection from "./table";

interface BodyProps {
  content: SectionContent;
  // Receives only the fields this module changed (e.g. { text } or
  // { items }); the canvas merges it into the section's existing content,
  // so a module never has to know about (or accidentally wipe) the title.
  onChange: (patch: SectionContent) => void;
}

// Free-typing modules (heading, text) save after a pause in typing, on blur,
// and on unmount — so nothing typed is lost whether you click away, switch
// pages, or just stop. Callbacks/values live in refs so the timer isn't
// reset by unrelated re-renders.
function useAutosave(value: string, onSave: (value: string) => void) {
  const saved = useRef(value);
  const latest = useRef(value);
  const onSaveRef = useRef(onSave);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = value;
  onSaveRef.current = onSave;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current !== saved.current) {
      saved.current = latest.current;
      onSaveRef.current(latest.current);
    }
  }, []);

  useEffect(() => {
    if (value === saved.current) return;
    timer.current = setTimeout(flush, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, flush]);

  // Flush whatever's pending when the section unmounts.
  useEffect(() => flush, [flush]);

  return flush;
}

// The header row shown at the top of every box except the Heading module.
// The placeholder stays faintly visible so there's always an obvious place
// to click and name the box.
export function SectionTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(value);
  const flush = useAutosave(title, onSave);
  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={flush}
      placeholder="Title"
      aria-label="Box title"
      className="block w-full bg-transparent text-sm font-semibold text-text outline-none placeholder:font-normal placeholder:text-muted/40"
    />
  );
}

function HeadingSection({ content, onChange }: BodyProps) {
  const [text, setText] = useState(content.text ?? "");
  const flush = useAutosave(text, (t) => onChange({ text: t }));
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={flush}
      placeholder="Heading"
      className="block h-full w-full bg-transparent text-xl font-semibold text-text outline-none placeholder:text-muted/50"
    />
  );
}

function TextSection({ content, onChange }: BodyProps) {
  const [text, setText] = useState(content.text ?? "");
  const flush = useAutosave(text, (t) => onChange({ text: t }));
  // The box grows with the text instead of scrolling inside itself. On the
  // grid it still fills its widget (min-h-full) and the widget scrolls; on a
  // phone, where widgets size to their content, this is the widget's height.
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={flush}
      placeholder="Write something…"
      className="block min-h-full w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-text outline-none placeholder:text-muted/50"
    />
  );
}

// Items are stored flat; a sub-item carries its parent's id. Tab on an item
// tucks it under the item above, Shift+Tab pulls it back out.
function ChecklistSection({ content, onChange }: BodyProps) {
  const items = (content.items ?? []) as ChecklistItem[];
  const [draft, setDraft] = useState("");
  // The top-level item whose "add sub-item" box is open, if any.
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState("");
  // After Tab / Shift+Tab the row moves (and remounts), so focus follows it.
  const [focusId, setFocusId] = useState<string | null>(null);

  const commit = (next: ChecklistItem[]) => onChange({ items: next });
  const top = items.filter((i) => !i.parentId || !items.some((p) => p.id === i.parentId));
  const childrenOf = (id: string) => items.filter((i) => i.parentId === id);

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    commit([...items, { id: crypto.randomUUID(), text, done: false }]);
    setDraft("");
  }

  function handleAddSub(e: FormEvent, parentId: string) {
    e.preventDefault();
    const text = subDraft.trim();
    if (!text) return;
    commit([...items, { id: crypto.randomUUID(), text, done: false, parentId }]);
    setSubDraft("");
  }

  // Checking a parent checks (or unchecks) its sub-items with it.
  function toggle(item: ChecklistItem) {
    const done = !item.done;
    commit(
      items.map((i) =>
        i.id === item.id || (!item.parentId && i.parentId === item.id) ? { ...i, done } : i
      )
    );
  }

  function remove(item: ChecklistItem) {
    commit(items.filter((i) => i.id !== item.id && i.parentId !== item.id));
  }

  // `text` is what's typed in the row right now (not saved until blur).
  function indent(item: ChecklistItem, text = item.text) {
    if (item.parentId) return;
    const at = top.findIndex((i) => i.id === item.id);
    const parent = at > 0 ? top[at - 1] : null;
    if (!parent) return;
    // Its own sub-items come along under the new parent.
    commit(
      items.map((i) =>
        i.id === item.id
          ? { ...i, text, parentId: parent.id }
          : i.parentId === item.id
            ? { ...i, parentId: parent.id }
            : i
      )
    );
    setFocusId(item.id);
  }

  function outdent(item: ChecklistItem, text = item.text) {
    if (!item.parentId) return;
    const rest = items.filter((i) => i.id !== item.id);
    // Lands right after its old parent's group.
    const siblings = rest.filter((i) => i.parentId === item.parentId);
    const anchor = siblings.length
      ? siblings[siblings.length - 1].id
      : item.parentId;
    const at = rest.findIndex((i) => i.id === anchor);
    rest.splice(at + 1, 0, { ...item, text, parentId: undefined });
    commit(rest);
    setFocusId(item.id);
  }

  function Row({ item, sub }: { item: ChecklistItem; sub: boolean }) {
    return (
      <li className={`group/item flex items-center gap-2 text-sm ${sub ? "pl-6" : ""}`}>
        <button
          type="button"
          aria-label={item.done ? "Mark not done" : "Mark done"}
          onClick={() => toggle(item)}
          className={`shrink-0 rounded border ${sub ? "h-3.5 w-3.5" : "h-4 w-4"} ${
            item.done ? "border-good bg-good" : "border-muted"
          }`}
        />
        <input
          key={item.text}
          defaultValue={item.text}
          aria-label={sub ? "Sub-item" : "Item"}
          autoFocus={focusId === item.id}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const text = e.currentTarget.value.trim() || item.text;
              if (e.shiftKey) outdent(item, text);
              else indent(item, text);
            } else if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const text = e.target.value.trim();
            if (text && text !== item.text) {
              commit(items.map((i) => (i.id === item.id ? { ...i, text } : i)));
            } else {
              e.target.value = item.text;
            }
          }}
          className={`min-w-0 flex-1 bg-transparent outline-none ${
            item.done ? "text-muted line-through" : "text-text"
          }`}
        />
        <span className="flex shrink-0 items-center gap-2 opacity-0 focus-within:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100">
          {sub ? (
            <button
              type="button"
              aria-label="Make a main item"
              title="Make a main item"
              onClick={() => outdent(item)}
              className="text-xs text-muted hover:text-accent"
            >
              ⇤
            </button>
          ) : (
            <button
              type="button"
              aria-label="Add sub-item"
              title="Add sub-item"
              onClick={() => {
                setSubFor(item.id);
                setSubDraft("");
              }}
              className="text-xs text-muted hover:text-accent"
            >
              + sub
            </button>
          )}
          <button
            type="button"
            aria-label="Remove item"
            onClick={() => remove(item)}
            className="text-muted hover:text-bad"
          >
            ✕
          </button>
        </span>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {top.map((item) => {
          const kids = childrenOf(item.id);
          return (
            <li key={item.id} className="flex flex-col gap-1">
              <ul className="flex flex-col gap-1">
                {Row({ item, sub: false })}
                {kids.map((k) => (
                  <Fragment key={k.id}>{Row({ item: k, sub: true })}</Fragment>
                ))}
                {subFor === item.id && (
                  <li className="pl-6">
                    <form onSubmit={(e) => handleAddSub(e, item.id)}>
                      <input
                        autoFocus
                        value={subDraft}
                        onChange={(e) => setSubDraft(e.target.value)}
                        onBlur={() => !subDraft.trim() && setSubFor(null)}
                        onKeyDown={(e) => e.key === "Escape" && setSubFor(null)}
                        placeholder="+ Add sub-item"
                        className="w-full rounded border border-border bg-bg px-1 py-0.5 text-sm text-text outline-none"
                      />
                    </form>
                  </li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
      <form onSubmit={handleAdd}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ Add item"
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted outline-none focus:border-border focus:bg-bg"
        />
      </form>
    </div>
  );
}

function LinksSection({ content, onChange }: BodyProps) {
  const items = (content.items ?? []) as LinkItem[];
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [invalid, setInvalid] = useState(false);

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    onChange({
      items: [...items, { id: crypto.randomUUID(), label: label.trim(), url: normalized }],
    });
    setLabel("");
    setUrl("");
    setInvalid(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="group/item flex items-center gap-2 text-sm">
            {isSafeHref(item.url) ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={item.url}
                className="min-w-0 flex-1 truncate text-text underline decoration-border underline-offset-2 hover:text-accent"
              >
                {item.label || hostOf(item.url)}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted">{item.label || item.url}</span>
            )}
            <button
              type="button"
              aria-label="Remove link"
              onClick={() => onChange({ items: items.filter((i) => i.id !== item.id) })}
              className="text-muted opacity-0 hover:text-bad focus:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex flex-col gap-1">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted outline-none focus:border-border focus:bg-bg"
        />
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setInvalid(false);
          }}
          placeholder="+ Paste a link, press Enter"
          className={`w-full rounded border bg-transparent px-1 py-0.5 text-sm text-muted outline-none focus:bg-bg ${
            invalid ? "border-bad" : "border-transparent focus:border-border"
          }`}
        />
        {invalid && <span className="text-[11px] text-bad">That doesn&apos;t look like a web link.</span>}
      </form>
    </div>
  );
}

export default function SectionBody({
  section,
  onChange,
}: {
  section: MemorySection;
  onChange: (patch: SectionContent) => void;
}) {
  switch (section.type) {
    // A group's body is its own grid of sections, drawn by the canvas.
    case "group":
      return null;
    case "heading":
      return <HeadingSection content={section.content} onChange={onChange} />;
    case "text":
      return <TextSection content={section.content} onChange={onChange} />;
    case "checklist":
      return <ChecklistSection content={section.content} onChange={onChange} />;
    case "links":
      return <LinksSection content={section.content} onChange={onChange} />;
    case "gallery":
      return <GallerySection content={section.content} onChange={onChange} />;
    case "todos":
      return <TodosSection content={section.content} onChange={onChange} />;
    case "table":
      return <TableSection content={section.content} onChange={onChange} />;
  }
}

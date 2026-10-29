"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={flush}
      placeholder="Write something…"
      className="block h-full w-full resize-none bg-transparent text-sm leading-relaxed text-text outline-none placeholder:text-muted/50"
    />
  );
}

function ChecklistSection({ content, onChange }: BodyProps) {
  const items = (content.items ?? []) as ChecklistItem[];
  const [draft, setDraft] = useState("");

  const commit = (next: ChecklistItem[]) => onChange({ items: next });

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    commit([...items, { id: crypto.randomUUID(), text, done: false }]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="group/item flex items-center gap-2 text-sm">
            <button
              type="button"
              aria-label={item.done ? "Mark not done" : "Mark done"}
              onClick={() =>
                commit(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
              }
              className={`h-4 w-4 shrink-0 rounded border ${
                item.done ? "border-good bg-good" : "border-muted"
              }`}
            />
            <input
              defaultValue={item.text}
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
            <button
              type="button"
              aria-label="Remove item"
              onClick={() => commit(items.filter((i) => i.id !== item.id))}
              className="text-muted opacity-0 hover:text-bad focus:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
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

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { hostOf, isSafeHref, normalizeUrl } from "@/lib/urls";
import type { PhotoItem, SectionContent } from "@/types";

// What a Gallery needs from the canvas: the signed URLs to show its photos
// (they're private), a way to record the URL of a new upload, and a way to
// delete photo files once they're taken out of a Gallery.
export interface PhotoApi {
  urls: Record<string, string>;
  addUrl: (path: string, url: string) => void;
  removeFiles: (paths: string[]) => void;
}

export const PhotoContext = createContext<PhotoApi>({
  urls: {},
  addUrl: () => {},
  removeFiles: () => {},
});

export const ACCEPT = "image/*,.heic,.heif";

export async function uploadPhoto(file: File): Promise<{ path: string; url: string | null }> {
  const body = new FormData();
  body.append("photo", file);
  const res = await fetch("/api/memory/photo", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as {
    path?: string;
    url?: string | null;
    error?: string;
  };
  if (!res.ok || !json.path) throw new Error(json.error || "Couldn't upload that photo.");
  return { path: json.path, url: json.url ?? null };
}

// The full-size view of one photo, over the page (inline, not a browser
// pop-up). Click anywhere outside the photo or press Esc to close.
function Lightbox({ photo, url, onClose }: { photo: PhotoItem; url?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-text/70 p-6"
      onClick={onClose}
    >
      {url && (
        // Signed Storage URLs change on every load, so next/image's
        // optimizer would only add a cache miss; a plain <img> is right here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={photo.caption || "Photo"}
          className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-lg"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {(photo.caption || photo.link) && (
        <div
          className="flex max-w-full items-center gap-3 rounded-md bg-panel px-3 py-1.5 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {photo.caption && <span className="truncate text-text">{photo.caption}</span>}
          {photo.link && isSafeHref(photo.link) && (
            <a
              href={photo.link}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-accent underline underline-offset-2"
            >
              {hostOf(photo.link)} ↗
            </a>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

function PhotoTile({
  photo,
  url,
  onOpen,
  onUpdate,
  onRemove,
}: {
  photo: PhotoItem;
  url?: string;
  onOpen: () => void;
  onUpdate: (patch: Partial<PhotoItem>) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);

  function saveLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("link") ?? "");
    if (!raw.trim()) {
      onUpdate({ link: "" });
      setEditingLink(false);
      return;
    }
    const normalized = normalizeUrl(raw);
    if (!normalized) {
      setLinkInvalid(true);
      return;
    }
    onUpdate({ link: normalized });
    setEditingLink(false);
    setLinkInvalid(false);
  }

  return (
    <li className="group/photo flex min-w-0 flex-col gap-1">
      <div className="relative aspect-square overflow-hidden rounded-md bg-border/40">
        {url ? (
          <button type="button" onClick={onOpen} className="block h-full w-full" aria-label="View photo">
            {/* eslint-disable-next-line @next/next/no-img-element -- see Lightbox */}
            <img
              src={url}
              alt={photo.caption || "Photo"}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <span className="flex h-full items-center justify-center p-2 text-center text-[11px] text-muted">
            Photo unavailable — reload the page
          </span>
        )}
        {confirming ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-panel/90 text-xs">
            <span className="text-bad">Remove photo?</span>
            <span className="flex gap-3">
              <button type="button" onClick={onRemove} className="font-medium text-bad hover:opacity-80">
                Yes
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-muted hover:text-text">
                No
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Remove photo"
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-panel/90 text-[11px] text-muted opacity-0 hover:text-bad focus:opacity-100 group-hover/photo:opacity-100 [@media(hover:none)]:opacity-100"
          >
            ✕
          </button>
        )}
      </div>

      <input
        defaultValue={photo.caption}
        onBlur={(e) => {
          const caption = e.target.value.trim();
          if (caption !== photo.caption) onUpdate({ caption });
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="Caption"
        aria-label="Photo caption"
        className="w-full truncate bg-transparent text-xs text-text outline-none placeholder:text-muted/50"
      />

      {editingLink ? (
        <form onSubmit={saveLink}>
          <input
            name="link"
            autoFocus
            defaultValue={photo.link}
            onChange={() => setLinkInvalid(false)}
            onBlur={() => {
              setEditingLink(false);
              setLinkInvalid(false);
            }}
            onKeyDown={(e) => e.key === "Escape" && setEditingLink(false)}
            placeholder="Paste a link, press Enter"
            className={`w-full rounded border bg-bg px-1 py-0.5 text-[11px] text-text outline-none ${
              linkInvalid ? "border-bad" : "border-border"
            }`}
          />
        </form>
      ) : photo.link && isSafeHref(photo.link) ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <a
            href={photo.link}
            target="_blank"
            rel="noreferrer"
            title={photo.link}
            className="min-w-0 truncate text-muted underline decoration-border underline-offset-2 hover:text-accent"
          >
            {hostOf(photo.link)} ↗
          </a>
          <button
            type="button"
            onClick={() => setEditingLink(true)}
            className="shrink-0 text-muted opacity-0 hover:text-text focus:opacity-100 group-hover/photo:opacity-100 [@media(hover:none)]:opacity-100"
          >
            edit
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setEditingLink(true)}
          className="self-start text-[11px] text-muted opacity-0 hover:text-text focus:opacity-100 group-hover/photo:opacity-100 [@media(hover:none)]:opacity-100"
        >
          + link
        </button>
      )}
    </li>
  );
}

// A grid of photos, each with an optional caption and link (so a Gallery
// also works as a visual wishlist). Photos are added from your computer —
// with the "+ Add photos" tile or by dropping files onto the Gallery — and
// are shrunk on upload (see /api/memory/photo).
export default function GallerySection({
  content,
  onChange,
}: {
  content: SectionContent;
  onChange: (patch: SectionContent) => void;
}) {
  const { urls, addUrl, removeFiles } = useContext(PhotoContext);
  const items = (content.items ?? []) as PhotoItem[];
  // Uploads finish one at a time, after the render that started them; each
  // one appends to the newest list, not the one from when it began.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function save(next: PhotoItem[]) {
    itemsRef.current = next;
    onChange({ items: next });
  }

  async function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name));
    if (images.length === 0) return;
    setError(null);
    setUploading((u) => [...u, ...images.map((f) => f.name)]);
    for (const file of images) {
      try {
        const { path, url } = await uploadPhoto(file);
        if (url) addUrl(path, url);
        save([...itemsRef.current, { id: crypto.randomUUID(), path, caption: "", link: "" }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload that photo.");
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name);
          return i === -1 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
  }

  function update(id: string, patch: Partial<PhotoItem>) {
    save(itemsRef.current.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function remove(photo: PhotoItem) {
    save(itemsRef.current.filter((p) => p.id !== photo.id));
    removeFiles([photo.path]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  const open = openId ? items.find((p) => p.id === openId) : undefined;

  return (
    <div
      className={`flex min-h-full flex-col gap-2 rounded-md ${dragOver ? "bg-accent/10 ring-2 ring-accent/50" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <ul
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
      >
        {items.map((photo) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            url={urls[photo.path]}
            onOpen={() => setOpenId(photo.id)}
            onUpdate={(patch) => update(photo.id, patch)}
            onRemove={() => remove(photo)}
          />
        ))}
        {uploading.map((name, i) => (
          <li key={`${name}-${i}`} className="flex flex-col gap-1">
            <div className="flex aspect-square items-center justify-center rounded-md bg-border/40 text-[11px] text-muted">
              Uploading…
            </div>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border text-xs text-muted hover:border-accent hover:text-accent"
          >
            <span className="text-lg leading-none">+</span>
            Add photos
          </button>
        </li>
      </ul>
      {error && <p className="text-[11px] text-bad">{error}</p>}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {open && <Lightbox photo={open} url={urls[open.path]} onClose={() => setOpenId(null)} />}
    </div>
  );
}

import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  addCategory,
  addPage,
  deleteCategory,
  ensureDefaultCategories,
  moveCategory,
  renameCategory,
} from "./actions";
import type { MemoryCategory, MemoryPage } from "@/types";

export default async function MemoryBoardPage({
  searchParams,
}: {
  searchParams: { editCategory?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null; // middleware redirects unauthenticated users

  await ensureDefaultCategories(user.id);

  const { data: categoriesData } = await supabase
    .from("memory_categories")
    .select("*")
    .order("category_order", { ascending: true });
  const categories = (categoriesData ?? []) as MemoryCategory[];

  const { data: pagesData } = await supabase
    .from("memory_pages")
    .select("*")
    .order("page_order", { ascending: true });
  const pages = (pagesData ?? []) as MemoryPage[];

  const pagesByCategory = new Map<string, MemoryPage[]>();
  for (const p of pages) {
    const list = pagesByCategory.get(p.category_id) ?? [];
    list.push(p);
    pagesByCategory.set(p.category_id, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Deep Memory</h1>
        <p className="mt-1 text-sm text-muted">
          Long-term notes and reference pages, organized by category.
        </p>
      </header>

      {/* One row of equal-width columns that share the page width (flex-1 +
          min-w-0 means no column can force the row wider), so there's never
          a horizontal scrollbar however many groups exist. Stacks on narrow
          windows rather than squeezing into unreadable slivers. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {categories.map((cat, i) => {
          const catPages = pagesByCategory.get(cat.id) ?? [];
          const editing = searchParams.editCategory === cat.id;

          return (
            <div
              key={cat.id}
              className="group flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-panel p-3 shadow-[0_1px_3px_rgba(58,53,44,0.10)] md:flex-1"
            >
              <div className="relative flex min-h-6 items-center">
                {editing ? (
                  <form
                    action={renameCategory.bind(null, cat.id)}
                    className="flex w-full flex-col gap-1.5"
                  >
                    <input
                      name="name"
                      defaultValue={cat.name}
                      autoFocus
                      className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-sm outline-none focus:border-accent"
                    />
                    <div className="flex items-center gap-3">
                      <button type="submit" className="text-xs text-accent hover:opacity-80">
                        Save
                      </button>
                      <Link href="/memory" className="text-xs text-muted hover:text-text">
                        Cancel
                      </Link>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-text">{cat.name}</span>
                      <span className="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[11px] text-muted">
                        {catPages.length}
                      </span>
                    </div>
                    {/* Too wide to sit beside the name in a narrow column, so
                        it overlays the header's right edge on hover/focus
                        (always shown on touch screens, which can't hover). */}
                    <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 bg-panel pl-2 text-xs text-muted opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <form action={moveCategory.bind(null, cat.id, "left")}>
                        <button
                          type="submit"
                          disabled={i === 0}
                          className="hover:text-text disabled:opacity-30"
                          aria-label={`Move ${cat.name} left`}
                        >
                          ←
                        </button>
                      </form>
                      <form action={moveCategory.bind(null, cat.id, "right")}>
                        <button
                          type="submit"
                          disabled={i === categories.length - 1}
                          className="hover:text-text disabled:opacity-30"
                          aria-label={`Move ${cat.name} right`}
                        >
                          →
                        </button>
                      </form>
                      <Link
                        href={`/memory?editCategory=${cat.id}`}
                        aria-label={`Rename ${cat.name}`}
                        title="Rename"
                        className="hover:text-text"
                      >
                        ✎
                      </Link>
                      <form action={deleteCategory.bind(null, cat.id)}>
                        <button
                          type="submit"
                          aria-label={`Delete ${cat.name}`}
                          title="Delete group"
                          className="hover:text-bad"
                        >
                          ✕
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                {catPages.map((p) => (
                  <Link
                    key={p.id}
                    href={`/memory/${p.id}`}
                    className="break-words rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text shadow-[0_1px_2px_rgba(58,53,44,0.06)] hover:border-accent"
                  >
                    {p.title}
                  </Link>
                ))}
              </div>

              <form action={addPage.bind(null, cat.id)}>
                <input
                  name="title"
                  placeholder="+ New page"
                  className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-muted outline-none focus:border-border focus:bg-bg"
                />
              </form>
            </div>
          );
        })}

        <form action={addCategory} className="md:w-32 md:shrink-0">
          <input
            name="name"
            placeholder="+ New group"
            className="w-full rounded-lg border border-dashed border-border bg-transparent px-3 py-2.5 text-sm text-muted outline-none focus:border-accent focus:bg-panel"
          />
        </form>
      </div>
    </div>
  );
}

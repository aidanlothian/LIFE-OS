"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { reorderTasks } from "./actions";
import TaskRow from "./TaskRow";
import { moveItem } from "@/lib/recurring";
import type { Task } from "@/types";

// Pointer-driven drag-to-reorder (not native HTML5 drag-and-drop): the
// grabbed row follows the cursor, the other rows slide out of the way, and a
// dashed slot marks exactly where it will land. On release the new order
// shows instantly and saves in the background — previously the list sat in
// the old order until the server answered, which read as "snapping back".
type Drag = {
  id: string;
  from: number;
  over: number;
  startY: number;
  dy: number;
  tops: number[]; // row tops relative to the list
  heights: number[];
  gap: number;
};

export default function TodoList({
  todos,
  subtasksByParent,
}: {
  todos: Task[];
  subtasksByParent: Record<string, Task[]>;
}) {
  const router = useRouter();
  const serverIds = useMemo(() => todos.map((t) => t.id), [todos]);
  const serverKey = serverIds.join(",");
  const [order, setOrder] = useState<string[]>(serverIds);
  // Re-sync whenever the server's list changes (a save landed, a task was
  // added or deleted). A failed save therefore shows the real order again.
  useEffect(() => setOrder(serverIds), [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const byId = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos]);
  const shown = [
    ...order.filter((id) => byId.has(id)),
    ...serverIds.filter((id) => !order.includes(id)),
  ].map((id) => byId.get(id)!);

  if (shown.length === 0) {
    return <p className="text-sm text-muted">Nothing here.</p>;
  }

  function startDrag(e: ReactPointerEvent, id: string) {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const listTop = listRef.current.getBoundingClientRect().top;
    const rects = shown.map((t) => rowRefs.current.get(t.id)!.getBoundingClientRect());
    const from = shown.findIndex((t) => t.id === id);
    setDrag({
      id,
      from,
      over: from,
      startY: e.clientY,
      dy: 0,
      tops: rects.map((r) => r.top - listTop),
      heights: rects.map((r) => r.height),
      gap: rects.length > 1 ? rects[1].top - rects[0].bottom : 0,
    });
  }

  function moveDrag(e: ReactPointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    // The slot is decided by where the grabbed row's middle is: past
    // another row's middle means it goes on the other side of that row.
    const center = drag.tops[drag.from] + dy + drag.heights[drag.from] / 2;
    let over = drag.from;
    drag.tops.forEach((top, i) => {
      const mid = top + drag.heights[i] / 2;
      if (i > drag.from && center > mid) over = Math.max(over, i);
      if (i < drag.from && center < mid) over = Math.min(over, i);
    });
    setDrag({ ...drag, dy, over });
  }

  function endDrag() {
    if (!drag) return;
    const { from, over } = drag;
    setDrag(null);
    if (from === over) return;
    const next = moveItem(
      shown.map((t) => t.id),
      from,
      over
    );
    setOrder(next);
    startTransition(async () => {
      await reorderTasks(next);
      router.refresh();
    });
  }

  // How far each non-grabbed row shifts to open the slot.
  function shiftFor(i: number) {
    if (!drag || i === drag.from) return 0;
    const space = drag.heights[drag.from] + drag.gap;
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -space;
    if (drag.over < drag.from && i >= drag.over && i < drag.from) return space;
    return 0;
  }

  // Where the grabbed row will sit once dropped (list-relative top).
  const slotTop = drag
    ? drag.over > drag.from
      ? drag.tops[drag.over] + drag.heights[drag.over] - drag.heights[drag.from]
      : drag.tops[drag.over]
    : 0;

  return (
    <ul ref={listRef} className="relative flex flex-col gap-1">
      {drag && (
        <li
          aria-hidden
          className="pointer-events-none absolute inset-x-0 rounded-md border-2 border-dashed border-accent/70 bg-accent/10"
          style={{ top: slotTop, height: drag.heights[drag.from] }}
        />
      )}
      {shown.map((t, i) => {
        const grabbed = drag?.id === t.id;
        return (
          <li
            key={t.id}
            ref={(el) => {
              if (el) rowRefs.current.set(t.id, el);
              else rowRefs.current.delete(t.id);
            }}
            className={
              grabbed
                ? "relative z-10 rounded-md bg-panel shadow-[0_6px_16px_rgba(58,53,44,0.22)] ring-1 ring-accent/50"
                : "relative transition-transform duration-150 ease-out"
            }
            style={{ transform: `translateY(${grabbed ? drag!.dy : shiftFor(i)}px)` }}
          >
            <TaskRow
              task={t}
              showStar
              dateAsIcon
              subtasks={subtasksByParent[t.id] ?? []}
              dragHandle={
                <span
                  onPointerDown={(e) => startDrag(e, t.id)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={() => setDrag(null)}
                  className={`shrink-0 touch-none select-none px-0.5 text-muted hover:text-accent ${
                    grabbed ? "cursor-grabbing text-accent" : "cursor-grab"
                  }`}
                  aria-label={`Drag to reorder ${t.title}`}
                  title="Drag to reorder"
                >
                  ⠿
                </span>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

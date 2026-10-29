"use client";

import { startTransition, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { CalendarEvent, PositionedEvent } from "@/lib/googleCalendar";
import { addCalendarEvent, editCalendarEvent, removeCalendarEvent } from "./calendarActions";

const HOUR_HEIGHT = 32;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SNAP_MINUTES = 15;
const DEFAULT_DURATION = 30; // minutes, used for a plain click rather than a drag

function formatHourLabel(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function formatTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function minutesToTimeInputValue(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function snap(min: number) {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

interface Range {
  startMin: number;
  endMin: number;
}

export default function DayTimeline({
  events,
  allDayEvents,
  nowMinutes,
}: {
  events: PositionedEvent[];
  allDayEvents: CalendarEvent[];
  nowMinutes: number;
}) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  const dragStartMin = useRef<number | null>(null);

  const [dragRange, setDragRange] = useState<Range | null>(null); // live, while actively dragging
  const [pendingRange, setPendingRange] = useState<Range | null>(null); // finalized, showing the create form
  const [editingEvent, setEditingEvent] = useState<PositionedEvent | null>(null);
  const [pending, setPending] = useState(false);

  function minutesFromClientY(clientY: number) {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const y = clientY - rect.top;
    const min = (y / HOUR_HEIGHT) * 60;
    return Math.max(0, Math.min(24 * 60, snap(min)));
  }

  function handleGridMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (pending) return;
    const startMin = minutesFromClientY(e.clientY);
    dragStartMin.current = startMin;
    setEditingEvent(null);
    setPendingRange(null);
    setDragRange({ startMin, endMin: startMin });
  }

  function handleGridMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (dragStartMin.current === null) return;
    const current = minutesFromClientY(e.clientY);
    const start = dragStartMin.current;
    setDragRange(
      current >= start ? { startMin: start, endMin: current } : { startMin: current, endMin: start }
    );
  }

  function finishDrag() {
    if (dragStartMin.current === null || !dragRange) return;
    const tooShort = dragRange.endMin - dragRange.startMin < SNAP_MINUTES;
    const range = tooShort
      ? { startMin: dragRange.startMin, endMin: dragRange.startMin + DEFAULT_DURATION }
      : dragRange;
    dragStartMin.current = null;
    setDragRange(null);
    setPendingRange(range);
  }

  function cancelCreate() {
    setPendingRange(null);
  }

  function cancelEdit() {
    setEditingEvent(null);
  }

  function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingRange) return;
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await addCalendarEvent(formData);
      router.refresh();
      setPendingRange(null);
      setPending(false);
    });
  }

  function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingEvent) return;
    const formData = new FormData(e.currentTarget);
    setPending(true);
    startTransition(async () => {
      await editCalendarEvent(editingEvent.id, formData);
      router.refresh();
      setEditingEvent(null);
      setPending(false);
    });
  }

  function handleDelete() {
    if (!editingEvent) return;
    setPending(true);
    startTransition(async () => {
      await removeCalendarEvent(editingEvent.id);
      router.refresh();
      setEditingEvent(null);
      setPending(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {allDayEvents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allDayEvents.map((e) => (
            <span
              key={e.id}
              className="rounded px-2 py-0.5 text-xs text-text"
              style={{ backgroundColor: `${e.color}26` }}
            >
              {e.title}
            </span>
          ))}
        </div>
      )}

      <div className="relative rounded-md border border-border">
        <div className="flex" style={{ height: HOUR_HEIGHT * 24 }}>
          <div className="w-12 shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-t border-border/60 pl-1 pr-2 text-right text-[10px] text-muted"
                style={{ height: HOUR_HEIGHT }}
              >
                {formatHourLabel(h)}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex-1 cursor-crosshair select-none border-l border-border"
            onMouseDown={handleGridMouseDown}
            onMouseMove={handleGridMouseMove}
            onMouseUp={finishDrag}
            onMouseLeave={() => {
              if (dragStartMin.current !== null) finishDrag();
            }}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className="pointer-events-none border-t border-border/60"
                style={{ height: HOUR_HEIGHT }}
              />
            ))}

            {events.map((e) => (
              <div
                key={e.id}
                title={`${e.title} · ${formatTime(e.startMin)}–${formatTime(e.endMin)} · click to edit`}
                onMouseDown={(ev) => {
                  ev.stopPropagation();
                  setPendingRange(null);
                  setEditingEvent(e);
                }}
                className="absolute cursor-pointer overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-[11px] leading-tight text-text hover:brightness-95"
                style={{
                  top: (e.startMin / 60) * HOUR_HEIGHT,
                  height: Math.max(((e.endMin - e.startMin) / 60) * HOUR_HEIGHT, 16),
                  left: `${(e.col / e.totalCols) * 100}%`,
                  width: `calc(${100 / e.totalCols}% - 3px)`,
                  borderLeftColor: e.color,
                  backgroundColor: `${e.color}26`,
                  outline: editingEvent?.id === e.id ? `2px solid ${e.color}` : undefined,
                }}
              >
                <span className="font-medium">{e.title}</span>
              </div>
            ))}

            {dragRange && (
              <div
                className="pointer-events-none absolute inset-x-0 rounded-md border-l-2 border-dashed border-accent bg-accent/15"
                style={{
                  top: (dragRange.startMin / 60) * HOUR_HEIGHT,
                  height: Math.max(((dragRange.endMin - dragRange.startMin) / 60) * HOUR_HEIGHT, 4),
                }}
              />
            )}

            <div
              className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
              style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
            >
              <span className="-ml-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />
              <div className="h-px flex-1 bg-bad" />
            </div>
          </div>
        </div>
      </div>

      {pendingRange && (
        <form
          onSubmit={handleCreateSubmit}
          className="flex flex-col gap-2 rounded-md border border-accent bg-accent/5 p-2"
        >
          <p className="text-xs text-muted">
            {formatTime(pendingRange.startMin)}–{formatTime(pendingRange.endMin)}
          </p>
          <input type="hidden" name="start_time" value={minutesToTimeInputValue(pendingRange.startMin)} />
          <input type="hidden" name="end_time" value={minutesToTimeInputValue(pendingRange.endMin)} />
          <input
            name="title"
            required
            autoFocus
            placeholder="Event title"
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
            <button type="button" onClick={cancelCreate} className="text-xs text-muted hover:text-text">
              Cancel
            </button>
          </div>
        </form>
      )}

      {editingEvent && (
        <form
          onSubmit={handleEditSubmit}
          className="flex flex-col gap-2 rounded-md border border-border p-2"
        >
          <input
            name="title"
            required
            defaultValue={editingEvent.title}
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            Start
            <input
              name="start_time"
              type="time"
              required
              defaultValue={minutesToTimeInputValue(editingEvent.startMin)}
              className="ml-auto rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            End
            <input
              name="end_time"
              type="time"
              required
              defaultValue={minutesToTimeInputValue(editingEvent.endMin)}
              className="ml-auto rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" onClick={cancelEdit} className="text-xs text-muted hover:text-text">
              Cancel
            </button>
            <span className="flex-1" />
            <button
              type="button"
              disabled={pending}
              onClick={handleDelete}
              className="text-xs text-muted hover:text-bad disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </form>
      )}

      <p className="text-[11px] text-muted">Click and drag on the grid to add an event.</p>
    </div>
  );
}

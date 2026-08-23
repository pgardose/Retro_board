import React, { useRef, useState, useCallback, useEffect } from "react";
import { X, GripVertical, ThumbsUp } from "lucide-react";
import type { NoteData, NoteColor } from "../hooks/useMultiplayerRoom";

// ─── Color definitions ────────────────────────────────────────────────────────

interface ColorDef {
  bg: string;
  dot: string;
  border: string;
  header: string;
  textarea: string;
}

const COLOR_MAP: Record<NoteColor, ColorDef> = {
  yellow: {
    bg: "bg-amber-100",
    dot: "bg-amber-400",
    border: "border-amber-400",
    header: "bg-amber-200",
    textarea: "bg-amber-50",
  },
  blue: {
    bg: "bg-sky-100",
    dot: "bg-sky-400",
    border: "border-sky-400",
    header: "bg-sky-200",
    textarea: "bg-sky-50",
  },
  pink: {
    bg: "bg-pink-100",
    dot: "bg-pink-400",
    border: "border-pink-400",
    header: "bg-pink-200",
    textarea: "bg-pink-50",
  },
  green: {
    bg: "bg-emerald-100",
    dot: "bg-emerald-400",
    border: "border-emerald-400",
    header: "bg-emerald-200",
    textarea: "bg-emerald-50",
  },
};

const NOTE_COLORS: NoteColor[] = ["yellow", "blue", "pink", "green"];

// ─── Props ────────────────────────────────────────────────────────────────────

interface StickyNoteProps {
  note: NoteData;
  /**
   * Ref to the 4000×3000 canvas div. Used to convert viewport pointer
   * positions into canvas-space coordinates.
   */
  canvasRef: React.RefObject<HTMLDivElement>;
  localUserName: string;
  /**
   * Whether the board is in "revealed" state. When false, notes authored by
   * other users have their text blurred.
   */
  isRevealed: boolean;
  /**
   * Current zoom scale of the canvas. Pointer movement deltas arrive in
   * screen pixels; dividing by `scale` converts them into canvas-space
   * (unscaled) pixels, keeping the note pinned perfectly to the cursor.
   */
  scale: number;
  onUpdate: (id: string, patch: Partial<Omit<NoteData, "id">>) => void;
  onDelete: (id: string) => void;
  onUpvote: (id: string) => void;
  /**
   * Called on any pointer-down on the note (before a drag begins), so the
   * note being interacted with always renders above its neighbors.
   */
  onBringToFront: (id: string) => void;
  /**
   * Called after the user releases a drag with the note's final X position.
   * Canvas uses this to recalculate the note's retro column category.
   */
  onDragEnd: (id: string, finalX: number) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * StickyNote — v4
 *
 * Interaction model:
 *
 * CLICK ANYWHERE ON NOTE  → calls `onBringToFront` (raises z-index) and
 *                           focuses the textarea if not already editing.
 *
 * DRAG VIA GRIP HANDLE    → moves the note in canvas space. Pointer capture
 *                           is set on the root div (not the handle) so the
 *                           pointermove/pointerup stream is never interrupted
 *                           if the cursor leaves the handle during fast drags.
 *
 * DRAG MATH               → uses `getBoundingClientRect()` of the canvas div
 *                           (which already reflects the current CSS transform)
 *                           then divides by `scale`. This avoids any scrollLeft/
 *                           scrollTop arithmetic and works correctly at any
 *                           zoom level. The anchor approach (delta from drag
 *                           origin) means the note never jumps on pick-up.
 *
 * Z-INDEX                 → persisted value `note.zIndex` is used when idle.
 *                           While dragging, we force 9999 locally so the note
 *                           renders on top immediately, without waiting for the
 *                           Yjs round-trip from `onBringToFront`.
 *
 * CANVAS PAN ISOLATION    → stopPropagation on pointerdown prevents the canvas
 *                           viewport's pan handler from firing when the user
 *                           clicks or drags a note.
 */
export const StickyNote: React.FC<StickyNoteProps> = ({
  note,
  canvasRef,
  localUserName,
  isRevealed,
  scale,
  onUpdate,
  onDelete,
  onUpvote,
  onBringToFront,
  onDragEnd,
}) => {
  const colors = COLOR_MAP[note.color];

  // Ref to the root element — used for pointer capture (not the handle, so
  // fast drags that leave the handle area don't lose the event stream).
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Text buffering ────────────────────────────────────────────────────────
  const [localText, setLocalText] = useState(note.text);
  const isEditingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync remote text updates into the local draft, but only when this user
  // isn't actively typing (avoids clobbering in-progress keystrokes).
  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalText(note.text);
    }
  }, [note.text]);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false); // sync copy for event handlers

  /**
   * Stores the drag anchor: the canvas-space pointer position at the moment
   * the drag started, and the note's position at that same moment.
   * Each pointermove recomputes the delta from this anchor rather than from
   * the previous frame, which eliminates cumulative floating-point drift.
   */
  const dragAnchor = useRef<{
    pointerCanvasX: number;
    pointerCanvasY: number;
    noteStartX: number;
    noteStartY: number;
  } | null>(null);

  // Running X value updated each move so onDragEnd gets the final position.
  const currentXRef = useRef<number>(note.x);

  /**
   * Convert a viewport-space pointer position (clientX/clientY) into the
   * canvas's own unscaled coordinate space.
   *
   * Strategy: `canvasRef.current.getBoundingClientRect()` gives us the
   * canvas div's on-screen bounding box, which already incorporates the
   * CSS translate+scale transform applied by Canvas.tsx. Subtracting that
   * origin and dividing by `scale` lands us in canvas space.
   */
  const toCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
      };
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [canvasRef, scale]
  );

  // ── Root pointer-down: bring to front + start drag (if on handle) ─────────

  const handleRootPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Always stop propagation — prevents the canvas viewport's Space+drag
      // pan handler from firing when the user clicks/drags a note.
      e.stopPropagation();

      // Raise this note above its neighbors immediately.
      onBringToFront(note.id);

      // Determine if the pointer landed on the drag handle (or a child of it).
      const handle = rootRef.current?.querySelector("[data-drag-handle]");
      const onHandle = handle?.contains(e.target as Node) ?? false;

      if (!onHandle) {
        // Not a drag — just a click to select/focus. Let the event bubble
        // naturally so the textarea receives focus if the user clicked it.
        return;
      }

      // ── Begin drag ────────────────────────────────────────────────────────
      e.preventDefault();

      // Capture pointer to the root so pointermove/pointerup keep firing here
      // even if the cursor moves outside the note at high velocity.
      rootRef.current?.setPointerCapture(e.pointerId);

      const canvasPos = toCanvasCoords(e.clientX, e.clientY);
      dragAnchor.current = {
        pointerCanvasX: canvasPos.x,
        pointerCanvasY: canvasPos.y,
        noteStartX: note.x,
        noteStartY: note.y,
      };
      currentXRef.current = note.x;
      isDraggingRef.current = true;
      setIsDragging(true);
    },
    [note.id, note.x, note.y, onBringToFront, toCanvasCoords]
  );

  // ── Pointer-move: translate note in canvas space ──────────────────────────

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !dragAnchor.current) return;

      // Convert current pointer position to canvas space.
      const canvasPos = toCanvasCoords(e.clientX, e.clientY);

      // Delta from anchor in canvas space.
      const dx = canvasPos.x - dragAnchor.current.pointerCanvasX;
      const dy = canvasPos.y - dragAnchor.current.pointerCanvasY;

      // New note position, clamped to canvas bounds.
      const newX = Math.max(0, dragAnchor.current.noteStartX + dx);
      const newY = Math.max(0, dragAnchor.current.noteStartY + dy);

      currentXRef.current = newX;

      // Write position into Yjs on every move — propagates to all peers
      // in real time, creating the collaborative drag experience.
      onUpdate(note.id, { x: newX, y: newY });
    },
    [note.id, toCanvasCoords, onUpdate]
  );

  // ── Pointer-up: commit category and end drag ──────────────────────────────

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;

      rootRef.current?.releasePointerCapture(e.pointerId);
      dragAnchor.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);

      // Notify Canvas to recalculate which column this note belongs to.
      onDragEnd(note.id, currentXRef.current);
    },
    [note.id, onDragEnd]
  );

  // ── Text handlers ─────────────────────────────────────────────────────────

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalText(e.target.value);
  };

  const handleTextFocus = () => {
    isEditingRef.current = true;
  };

  const handleTextBlur = () => {
    isEditingRef.current = false;
    if (localText !== note.text) {
      onUpdate(note.id, { text: localText });
    }
  };

  // ── Blur / reveal logic ───────────────────────────────────────────────────
  // A note is "own" if the local user was the last person to update it.
  // Own notes are always fully visible; other users' notes are blurred until
  // the facilitator calls Reveal.
  const isOwnNote = note.lastUpdatedBy === localUserName;
  const shouldBlur = !isRevealed && !isOwnNote;

  // ── Z-index ───────────────────────────────────────────────────────────────
  // While dragging: force 9999 locally so the note appears on top immediately,
  // before the `onBringToFront` Yjs write round-trips back through the observer.
  // When idle: use the persisted stacking order from Yjs (fallback to 1 for
  // notes created before zIndex was added to the schema).
  const stackZIndex = isDragging ? 9999 : note.zIndex ?? 1;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      data-note-root
      onPointerDown={handleRootPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: "absolute",
        left: note.x,
        top: note.y,
        width: 220,
        zIndex: stackZIndex,
        // Only hint GPU compositing while actually moving to avoid promoting
        // every note to its own layer at all times.
        willChange: isDragging ? "transform" : "auto",
      }}
      className={`
        sticky-note rounded-lg border-2
        ${colors.bg} ${colors.border}
        ${
          isDragging
            ? "shadow-2xl scale-[1.03] rotate-1 cursor-grabbing transition-none"
            : "shadow-md scale-100 rotate-0 cursor-default transition-shadow duration-150"
        }
        select-none
      `}
    >
      {/* ── Drag handle + controls ────────────────────────────────────────── */}
      <div
        className={`
          flex items-center justify-between px-2 py-1 rounded-t-lg
          ${colors.header}
          ${isDragging ? "cursor-grabbing" : "cursor-grab"}
        `}
        data-drag-handle
        // No separate onPointerDown here — it's handled on the root so that
        // pointer capture is always set on the element that owns the ref.
      >
        <GripVertical size={14} className="text-gray-400 pointer-events-none" />

        {/* Color picker dots */}
        <div
          className="flex items-center gap-1"
          // Stop propagation so clicking a color dot doesn't trigger a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(note.id, { color: c });
              }}
              aria-label={`Set color to ${c}`}
              className={`
                w-3 h-3 rounded-full border-2 transition-transform hover:scale-125
                ${COLOR_MAP[c].dot}
                ${
                  note.color === c
                    ? "border-gray-700 scale-125"
                    : "border-transparent"
                }
              `}
            />
          ))}
        </div>

        {/* Delete button */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          aria-label="Delete note"
          className="text-gray-400 hover:text-red-500 transition-colors rounded p-0.5 hover:bg-red-50"
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Note body ─────────────────────────────────────────────────────── */}
      <div className="p-2 relative">
        {/*
          Blur wrapper: when shouldBlur is true we apply blur-md + select-none
          so the text is visually obscured. The textarea stays in the DOM so
          the note's own author can always edit it without re-mounting.
        */}
        <div
          className={
            shouldBlur ? "blur-md select-none pointer-events-none" : ""
          }
        >
          <textarea
            ref={textareaRef}
            value={localText}
            onChange={handleTextChange}
            onFocus={handleTextFocus}
            onBlur={handleTextBlur}
            // Prevent textarea clicks from bubbling to the root and starting
            // a drag-on-handle path check, while still letting the textarea
            // receive focus naturally.
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="Type something…"
            rows={4}
            className={`
              w-full resize-none text-sm text-gray-800 rounded p-1.5
              focus:outline-none focus:ring-2 focus:ring-offset-1
              placeholder-gray-400 leading-snug
              ${colors.textarea}
              ${colors.border.replace("border-", "focus:ring-")}
            `}
          />
        </div>

        {/* "Hidden" badge — only shown when blurred */}
        {shouldBlur && (
          <div className="absolute inset-x-2 top-9 flex items-center justify-center pointer-events-none">
            <span className="text-[11px] text-slate-500 font-medium bg-white/80 px-2 py-0.5 rounded-full shadow-sm">
              🔒 Hidden until reveal
            </span>
          </div>
        )}

        {/* Footer: author name + upvote */}
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-gray-400 truncate max-w-[120px]">
            {note.lastUpdatedBy}
          </p>

          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onUpvote(note.id);
            }}
            aria-label={`Upvote — ${note.votes ?? 0} votes`}
            className={`
              flex items-center gap-1 px-1.5 py-0.5 rounded-full
              text-[11px] font-semibold
              transition-all duration-150 active:scale-90
              ${
                (note.votes ?? 0) > 0
                  ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }
            `}
          >
            <ThumbsUp size={11} />
            <span>{note.votes ?? 0}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
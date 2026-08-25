import React, { useRef, useState, useCallback, useEffect } from "react";
import { X, ThumbsUp } from "lucide-react";
import type { NoteData, NoteColor } from "../hooks/useMultiplayerRoom";
import { NOTE_WIDTH } from "./Canvas";

// ─── Color palette ────────────────────────────────────────────────────────────
// Warm-toned note surfaces that sit naturally on the linen canvas.

interface ColorDef {
  /** Card surface */
  bg: string;
  /** Swatch dot */
  dot: string;
  /** Card border + swatch ring-when-selected */
  border: string;
  /** Drag-handle header strip */
  header: string;
  /** Textarea fill */
  textarea: string;
  /** Text accent used for focus ring */
  accent: string;
}

const COLOR_MAP: Record<NoteColor, ColorDef> = {
  yellow: {
    bg:       "#FEF9C3",
    dot:      "#EAB308",
    border:   "#FDE047",
    header:   "#FEF08A",
    textarea: "#FEFCE8",
    accent:   "#CA8A04",
  },
  blue: {
    bg:       "#DBEAFE",
    dot:      "#3B82F6",
    border:   "#93C5FD",
    header:   "#BFDBFE",
    textarea: "#EFF6FF",
    accent:   "#2563EB",
  },
  pink: {
    bg:       "#FCE7F3",
    dot:      "#EC4899",
    border:   "#F9A8D4",
    header:   "#FBCFE8",
    textarea: "#FDF2F8",
    accent:   "#DB2777",
  },
  green: {
    bg:       "#D1FAE5",
    dot:      "#10B981",
    border:   "#6EE7B7",
    header:   "#A7F3D0",
    textarea: "#ECFDF5",
    accent:   "#059669",
  },
};

const NOTE_COLORS: NoteColor[] = ["yellow", "blue", "pink", "green"];

// ─── Props ────────────────────────────────────────────────────────────────────

interface StickyNoteProps {
  note: NoteData;
  canvasRef: React.RefObject<HTMLDivElement>;
  localUserName: string;
  isRevealed: boolean;
  scale: number;
  onUpdate: (id: string, patch: Partial<Omit<NoteData, "id">>) => void;
  onDelete: (id: string) => void;
  onUpvote: (id: string) => void;
  onBringToFront: (id: string) => void;
  onDragEnd: (id: string, finalX: number) => void;
  /** When true, textarea is focused on first mount (new-note auto-focus). */
  focusOnMount?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

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
  focusOnMount = false,
}) => {
  const colors     = COLOR_MAP[note.color];
  const rootRef    = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Text buffering ────────────────────────────────────────────────────────
  const [localText, setLocalText] = useState(note.text);
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) setLocalText(note.text);
  }, [note.text]);

  // Auto-focus on mount for freshly-created notes
  useEffect(() => {
    if (focusOnMount && textareaRef.current) textareaRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Entrance animation ────────────────────────────────────────────────────
  // Applied only once on mount via a class that CSS (index.css) defines.
  // We flip `isNew` off after the animation completes so the class doesn't
  // fight with the drag-scale transform on subsequent interactions.
  const [isNew, setIsNew] = useState(focusOnMount);
  useEffect(() => {
    if (!isNew) return;
    const id = setTimeout(() => setIsNew(false), 280); // slightly > 220ms anim
    return () => clearTimeout(id);
  }, [isNew]);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const dragAnchor = useRef<{
    pointerCanvasX: number;
    pointerCanvasY: number;
    noteStartX: number;
    noteStartY: number;
    pointerId: number;
  } | null>(null);

  const currentXRef = useRef<number>(note.x);

  const toCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [canvasRef, scale]
  );

  // ── Pointer down — bring to front + start drag ────────────────────────────
  const handleRootPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onBringToFront(note.id);

      const target = e.target as HTMLElement;
      if (
        target.closest("textarea") ||
        target.closest("button")
      ) return;

      e.preventDefault();
      rootRef.current?.setPointerCapture(e.pointerId);

      const canvasPos = toCanvasCoords(e.clientX, e.clientY);
      dragAnchor.current = {
        pointerCanvasX: canvasPos.x,
        pointerCanvasY: canvasPos.y,
        noteStartX: note.x,
        noteStartY: note.y,
        pointerId: e.pointerId,
      };
      currentXRef.current = note.x;
      isDraggingRef.current = true;
      setIsDragging(true);
    },
    [note.id, note.x, note.y, onBringToFront, toCanvasCoords]
  );

  // ── Pointer move ──────────────────────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !dragAnchor.current) return;
      const pos = toCanvasCoords(e.clientX, e.clientY);
      const newX = Math.max(0, dragAnchor.current.noteStartX + (pos.x - dragAnchor.current.pointerCanvasX));
      const newY = Math.max(0, dragAnchor.current.noteStartY + (pos.y - dragAnchor.current.pointerCanvasY));
      currentXRef.current = newX;
      onUpdate(note.id, { x: newX, y: newY });
    },
    [note.id, toCanvasCoords, onUpdate]
  );

  // ── Pointer up ────────────────────────────────────────────────────────────
  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      rootRef.current?.releasePointerCapture(e.pointerId);
      dragAnchor.current  = null;
      isDraggingRef.current = false;
      setIsDragging(false);
      onDragEnd(note.id, currentXRef.current);
    },
    [note.id, onDragEnd]
  );

  // ── Escape cancels drag ───────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isDraggingRef.current || !dragAnchor.current) return;
      onUpdate(note.id, { x: dragAnchor.current.noteStartX, y: dragAnchor.current.noteStartY });
      rootRef.current?.releasePointerCapture(dragAnchor.current.pointerId);
      dragAnchor.current  = null;
      isDraggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [note.id, onUpdate]);

  // ── Text handlers ─────────────────────────────────────────────────────────
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => setLocalText(e.target.value);
  const handleTextFocus  = () => { isEditingRef.current = true; };
  const handleTextBlur   = () => {
    isEditingRef.current = false;
    if (localText !== note.text) onUpdate(note.id, { text: localText });
  };

  // ── Reveal / blur logic ───────────────────────────────────────────────────
  const isOwnNote  = note.lastUpdatedBy === localUserName;
  const shouldBlur = !isRevealed && !isOwnNote;

  // ── Z-index ───────────────────────────────────────────────────────────────
  const stackZ = isDragging ? 9999 : (note.zIndex ?? 1);

  // ── Drag-state visual transforms ──────────────────────────────────────────
  // Kept subtle: a slight lift (bigger shadow) and a 1° rotation. No scale —
  // scaling fights with the canvas zoom transform and can feel queasy.
  const dragStyle: React.CSSProperties = isDragging
    ? {
        boxShadow: "0 16px 40px 0 rgba(60,45,20,0.20), 0 2px 8px 0 rgba(60,45,20,0.12)",
        transform: `rotate(1.2deg)`,
        cursor: "grabbing",
      }
    : {
        boxShadow: "0 2px 8px 0 rgba(60,45,20,0.09), 0 1px 2px 0 rgba(60,45,20,0.06)",
        transform: "rotate(0deg)",
        cursor: "default",
      };

  return (
    <div
      ref={rootRef}
      data-note-root
      onPointerDown={handleRootPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      // Entrance animation class applied only while `isNew` is true
      className={isNew ? "note-pop" : undefined}
      style={{
        position: "absolute",
        left: note.x,
        top:  note.y,
        width: NOTE_WIDTH,
        zIndex: stackZ,
        willChange: isDragging ? "transform, box-shadow" : "auto",
        borderRadius: 10,
        border: `1.5px solid ${colors.border}`,
        backgroundColor: colors.bg,
        overflow: "hidden",
        // Smooth shadow + rotation transition when picking up / putting down,
        // but instant while actually dragging (no lag on move).
        transition: isDragging
          ? "none"
          : "box-shadow 180ms ease, transform 180ms ease",
        ...dragStyle,
      }}
    >
      {/* ── Drag handle strip ─────────────────────────────────────────────── */}
      {/*
          The entire header bar is the drag target. Removing the GripVertical
          icon keeps it clean — the cursor change communicates affordance.
          Color swatches + delete live here so they're always accessible.
      */}
      <div
        style={{
          background: colors.header,
          borderBottom: `1px solid ${colors.border}`,
          cursor: isDragging ? "grabbing" : "grab",
        }}
        className="flex items-center justify-between px-2.5 py-1.5"
      >
        {/* Color picker */}
        <div
          className="flex items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              onClick={(e) => { e.stopPropagation(); onUpdate(note.id, { color: c }); }}
              aria-label={`Set color to ${c}`}
              style={{ backgroundColor: COLOR_MAP[c].dot }}
              className={`
                w-3 h-3 rounded-full border-2 transition-transform hover:scale-125
                ${note.color === c ? "border-gray-700 scale-125" : "border-transparent"}
              `}
            />
          ))}
        </div>

        {/* Delete */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
          aria-label="Delete note"
          className="text-stone-400 hover:text-red-500 transition-colors rounded p-0.5 hover:bg-red-50"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Note body ─────────────────────────────────────────────────────── */}
      <div className="p-2.5 relative">
        {/* Blur wrapper */}
        <div className={shouldBlur ? "blur-md select-none pointer-events-none" : ""}>
          <textarea
            ref={textareaRef}
            value={localText}
            onChange={handleTextChange}
            onFocus={handleTextFocus}
            onBlur={handleTextBlur}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="Type something…"
            rows={5}
            style={{
              backgroundColor: colors.textarea,
              // Accent-coloured focus ring instead of generic blue
              // (CSS focus-visible in index.css handles the global ring;
              //  this shadow gives a softer in-card treatment)
            }}
            className={`
              w-full resize-none text-[13px] leading-snug text-stone-800
              rounded-md px-2 py-1.5
              placeholder-stone-300
              focus:outline-none focus:ring-1
              transition-shadow duration-150
            `}
          />
        </div>

        {shouldBlur && (
          <div className="absolute inset-x-2.5 top-10 flex items-center justify-center pointer-events-none">
            <span className="text-[11px] text-stone-500 font-medium bg-white/80 px-2.5 py-0.5 rounded-full shadow-sm">
              🔒 Hidden until reveal
            </span>
          </div>
        )}

        {/* Footer: author + upvote */}
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-stone-400 truncate max-w-[120px] leading-none">
            {note.lastUpdatedBy}
          </p>

          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onUpvote(note.id); }}
            aria-label={`Upvote — ${note.votes ?? 0} votes`}
            style={
              (note.votes ?? 0) > 0
                ? { background: "#EEF2FF", color: "#4F46E5", border: "1px solid #C7D2FE" }
                : { background: "#F5F5F4", color: "#78716c", border: "1px solid #E7E5E4" }
            }
            className="
              inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
              text-[11px] font-semibold tabular
              transition-all duration-100 active:scale-90
              hover:brightness-95
            "
          >
            <ThumbsUp size={10} strokeWidth={2.5} />
            <span>{note.votes ?? 0}</span>
          </button>
        </div>
      </div>
    </div>
  );
};